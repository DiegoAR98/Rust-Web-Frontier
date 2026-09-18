import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CELL_SIZE_M, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2641);
});

beforeEach(() => {
  // A real file, because the whole point is that a restart reads it back.
  dir = mkdtempSync(join(tmpdir(), 'rwf-locks-'));
  process.env.RWF_DB_PATH = join(dir, 'world.sqlite');
});

afterEach(async () => {
  await colyseus.cleanup();
  process.env.RWF_DB_PATH = ':memory:';
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

const CELL = { i: 30, k: 30 };
const INSIDE = { x: (CELL.i + 0.5) * CELL_SIZE_M, y: 0, z: CELL.k * CELL_SIZE_M + 0.5 };
const FOUNDATION: PieceSite = { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_A: PieceSite = { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_B: PieceSite = { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k, axis: null };
const WALL: PieceSite = { form: 'wall', storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };

async function raidedWall(room: WorldRoom, accountId: string, sessionEpoch = 1) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, INSIDE);
  room.grantForTest(accountId, 'wood_foundation', 1);
  room.grantForTest(accountId, 'wood_pillar', 2);
  room.grantForTest(accountId, 'wood_wall', 1);
  for (const piece of [
    { definitionId: 'wood_foundation', site: FOUNDATION },
    { definitionId: 'wood_pillar', site: PILLAR_A },
    { definitionId: 'wood_pillar', site: PILLAR_B },
    { definitionId: 'wood_wall', site: WALL },
  ]) {
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }, sessionEpoch));
    const result = await client.waitForMessage('commandResult');
    expect(result.accepted, `${piece.definitionId}: ${result.reasonCode}`).toBe(true);
  }
  return client;
}

/**
 * GDD section 11's raid lock and section 10's broken-socket lockout are both
 * timers, and T17 requires that "no decay, fuel, crafting, cooldown, bag expiry
 * or explosive time advances while stopped". Held only in memory, they did the
 * opposite of advancing: they vanished. A host restart inside the window --
 * a crash under a supervisor, or a dev reload -- handed the defender back a
 * building they could repair immediately, after the raider had paid to lock it.
 */
describe('WorldRoom raid locks across a restart (T17, GDD section 11)', () => {
  it('keeps a raid lock over a restart', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await raidedWall(room, 'acct_raided');
    client.send('command', command({ type: 'attackStructure', door: false, ...WALL }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.raidLockedForTest(WALL)).toBe(true);
    client.leave();

    await colyseus.cleanup();
    const restarted = (await colyseus.createRoom('world', {})) as WorldRoom;

    expect(restarted.raidLockedForTest(WALL), 'the restart lifted the raid lock').toBe(true);
  });

  it('lets the lock expire on schedule after the restart, rather than never', async () => {
    // The other half: a persisted lock must still be a timer, not a brick.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await raidedWall(room, 'acct_expiry');
    client.send('command', command({ type: 'attackStructure', door: false, ...WALL }));
    await client.waitForMessage('commandResult');
    client.leave();

    await colyseus.cleanup();
    const restarted = (await colyseus.createRoom('world', {})) as WorldRoom;
    restarted.setTickForTest(restarted.tickForTest() + 60 * 20 + 1);

    expect(restarted.raidLockedForTest(WALL)).toBe(false);
  });
});
