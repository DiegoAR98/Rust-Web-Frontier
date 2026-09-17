import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2628);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-crate-'));
  process.env.RWF_DB_PATH = join(dir, 'world.sqlite');
});

afterEach(async () => {
  await colyseus.cleanup();
  delete process.env.RWF_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await colyseus.shutdown();
});

let sequence = 0;
function command(action: Record<string, unknown>, sessionEpoch = 1) {
  sequence += 1;
  return { protocolVersion: PROTOCOL_VERSION, sessionEpoch, sequence, clientTick: 0, action };
}

const SPOT = { x: 30, y: 0, z: 30 };

/**
 * T04: "Force-kill process after acknowledged transfer/placement/death ->
 * Restore committed outcomes once." A placement is the "placement" in that
 * list, and what is inside the crate is a transfer.
 */
describe('WorldRoom crates across a restart (T04, GDD section 10)', () => {
  it('leaves the crate where it was put, still holding what was in it', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_keep' });
    await client.waitForMessage('session');
    first.clearInventoryForTest('acct_keep');
    first.teleportForTest('acct_keep', SPOT);
    first.grantForTest('acct_keep', 'small_crate', 1);
    first.grantForTest('acct_keep', 'wood', 60);

    client.send(
      'command',
      command({ type: 'placeDeployable', definitionId: 'small_crate', x: 31, y: 0, z: 30 }),
    );
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    const crateId = [...first.state.deployables.keys()][0]!;
    client.send(
      'command',
      command({ type: 'containerInsert', containerId: crateId, definitionId: 'wood', quantity: 60 }),
    );
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    // Deliberately no checkpoint(): a placement and a transfer are class-1.

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;

    const restored = second.state.deployables.get(crateId)!;
    expect(restored.definitionId).toBe('small_crate');
    expect(restored.ownerAccountId).toBe('acct_keep');
    expect({ x: restored.x, z: restored.z }).toEqual({ x: 31, z: 30 });
    expect(second.containerForTest(crateId)!.filter((s) => s !== null)).toEqual([
      { definitionId: 'wood', quantity: 60 },
    ]);
    // The wood is in the crate, not also back in the pack.
    const rejoined = await colyseus.connectTo(second, { accountId: 'acct_keep' });
    await rejoined.waitForMessage('session');
    expect(second.countForTest('acct_keep', 'wood')).toBe(0);
    expect(second.countForTest('acct_keep', 'small_crate')).toBe(0);

    rejoined.leave();
  });

  it('still owes a bedroll the rest of its cooldown afterwards', async () => {
    // GDD section 12: "Cooldowns use persisted simulation time." A restart
    // that cleared them would make every bedroll in the world instantly ready,
    // which is a free respawn for every raid victim on the server.
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_sleeper' });
    await client.waitForMessage('session');
    first.clearInventoryForTest('acct_sleeper');
    first.teleportForTest('acct_sleeper', SPOT);
    first.grantForTest('acct_sleeper', 'bedroll', 1);
    client.send('command', command({ type: 'placeDeployable', definitionId: 'bedroll', x: 31, y: 0, z: 30 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    const anchorId = [...first.state.deployables.keys()][0]!;
    first.checkpoint(); // the world clock is class-2 and needed for the comparison

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    const again = await colyseus.connectTo(second, { accountId: 'acct_sleeper' });
    const { sessionEpoch } = await again.waitForMessage('session');
    second.damageForTest('acct_sleeper', 100);

    again.send('command', command({ type: 'respawn', anchorId }, sessionEpoch));
    const result = await again.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('busy');

    again.leave();
  });

  it('does not reuse a restored crate id for the next placement', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_ids' });
    await client.waitForMessage('session');
    first.teleportForTest('acct_ids', SPOT);
    first.grantForTest('acct_ids', 'small_crate', 1);
    client.send(
      'command',
      command({ type: 'placeDeployable', definitionId: 'small_crate', x: 31, y: 0, z: 30 }),
    );
    await client.waitForMessage('commandResult');
    const firstId = [...first.state.deployables.keys()][0]!;

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    const again = await colyseus.connectTo(second, { accountId: 'acct_ids' });
    // Rejoining replaces the session, so the epoch is no longer 1; a command
    // sent with the old one is correctly refused as stale.
    const { sessionEpoch } = await again.waitForMessage('session');
    second.teleportForTest('acct_ids', SPOT);
    second.grantForTest('acct_ids', 'small_crate', 1);

    again.send(
      'command',
      command({ type: 'placeDeployable', definitionId: 'small_crate', x: 29, y: 0, z: 30 }, sessionEpoch),
    );
    expect((await again.waitForMessage('commandResult')).accepted).toBe(true);

    // Two crates, not one crate silently overwritten by the other.
    expect(second.state.deployables.size).toBe(2);
    expect(second.state.deployables.has(firstId)).toBe(true);

    again.leave();
  });
});
