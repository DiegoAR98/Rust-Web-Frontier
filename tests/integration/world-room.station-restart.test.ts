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
  colyseus = await boot(appConfig, 2620);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-station-'));
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
function command(action: Record<string, unknown>) {
  sequence += 1;
  return { protocolVersion: PROTOCOL_VERSION, sessionEpoch: 1, sequence, clientTick: 0, action };
}

/**
 * T17: "Stop host for two wall-clock hours with active timers, then resume --
 * no decay, fuel, crafting, cooldown, bag expiry or explosive time advances
 * while stopped." A lit furnace is an active fuel timer, so its contents and
 * its part-elapsed quantum both have to come back exactly as they were.
 */
describe('WorldRoom station across a restart (T17)', () => {
  it('restores a lit furnace with its contents and its part-burned quantum', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    first.spawnStation('furnace_r', 'furnace', { x: 1, y: 0, z: 0 });
    first.grantForTest('acct_r', 'metal_ore', 24);
    first.grantForTest('acct_r', 'wood', 12);
    const client = await colyseus.connectTo(first, { accountId: 'acct_r' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_r', definitionId: 'metal_ore', quantity: 24 }));
    await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_r', definitionId: 'wood', quantity: 12 }));
    await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'stationLight', stationId: 'furnace_r', lit: true }));
    await client.waitForMessage('commandResult');

    // Two whole quanta plus three seconds into the third.
    first.advanceStationsForTest(13);
    // Snuffed before the reading is taken. The room's own 20Hz loop keeps
    // stepping a lit station, so anything measured while it burns drifts by
    // however long the assertions take; an unlit station banks no time.
    client.send('command', command({ type: 'stationLight', stationId: 'furnace_r', lit: false }));
    await client.waitForMessage('commandResult');
    first.checkpoint();
    const before = first.stationForTest('furnace_r')!;
    expect(before.progressS).toBeGreaterThan(2.5); // two quanta burned, part-way through a third

    await colyseus.cleanup(); // the host stops

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    const restored = second.stationForTest('furnace_r')!;

    expect(restored.inputs).toEqual(before.inputs);
    expect(restored.fuel).toEqual(before.fuel);
    expect(restored.outputs).toEqual(before.outputs);
    // Discarding this would quietly refund the player three seconds of fuel
    // every time the host restarted.
    expect(restored.progressS).toBeCloseTo(before.progressS, 5);
  });

  it('comes back still alight', async () => {
    // Separate from the reading above because a lit station cannot be measured
    // without it moving: this one has no fuel, so nothing can advance.
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    first.spawnStation('furnace_l', 'furnace', { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(first, { accountId: 'acct_l' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationLight', stationId: 'furnace_l', lit: true }));
    await client.waitForMessage('commandResult');

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    expect(second.stationForTest('furnace_l')!.lit).toBe(true);
  });

  it('does not re-seed the world stations over restored ones', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    first.grantForTest('acct_s', 'wood', 5);
    const client = await colyseus.connectTo(first, { accountId: 'acct_s' });
    await client.waitForMessage('session');
    // Nobody can reach the seeded furnace from spawn, so load it directly:
    // what matters here is that a restart does not wipe a loaded station.
    first.setStationOutputsForTest('furnace_1', [{ definitionId: 'metal', quantity: 7 }, null, null]);

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    expect(second.stationForTest('furnace_1')!.outputs[0]).toEqual({ definitionId: 'metal', quantity: 7 });
  });
});
