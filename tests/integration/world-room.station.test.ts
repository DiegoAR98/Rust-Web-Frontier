import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { Slot } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2619);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

let sequence = 0;
function command(action: Record<string, unknown>) {
  sequence += 1;
  return { protocolVersion: PROTOCOL_VERSION, sessionEpoch: 1, sequence, clientTick: 0, action };
}

/** Players spawn at the origin, so a station here is one they can reach. */
const AT_ARMS_LENGTH = { x: 1, y: 0, z: 0 };

function totalOf(slots: Slot[], definitionId: string): number {
  return slots.reduce((sum, slot) => sum + (slot?.definitionId === definitionId ? slot.quantity : 0), 0);
}

/**
 * PRODUCTION T09: "Furnace inputs/fuel from CONTENT example, then repeat with
 * full outputs -> 48 metal/12 charcoal in 60 s; blocked cycle consumes no
 * inputs/fuel." Driven through real commands rather than by calling the
 * simulation directly, so it covers the routing, reach, capacity and
 * persistence wiring as well as the arithmetic.
 */
describe('WorldRoom furnace (T09, CONTENT section 3)', () => {
  it('turns the CONTENT worked example into 48 metal and 12 charcoal in 60s', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('furnace_t', 'furnace', AT_ARMS_LENGTH);
    room.grantForTest('acct_f', 'metal_ore', 24);
    room.grantForTest('acct_f', 'wood', 12);
    const client = await colyseus.connectTo(room, { accountId: 'acct_f' });
    await client.waitForMessage('session');

    // 24 ore spreads across the furnace's two input slots, 12 each, which is
    // exactly what CONTENT's worked example loads.
    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_t', definitionId: 'metal_ore', quantity: 24 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_t', definitionId: 'wood', quantity: 12 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    client.send('command', command({ type: 'stationLight', stationId: 'furnace_t', lit: true }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    room.advanceStationsForTest(60);

    const station = room.stationForTest('furnace_t')!;
    expect(totalOf(station.outputs, 'metal')).toBe(48);
    expect(totalOf(station.outputs, 'charcoal')).toBe(12);
    expect(station.inputs.every((slot) => slot === null)).toBe(true);
    expect(station.fuel).toBeNull();

    // And the player can actually get it back out.
    client.send('command', command({ type: 'stationTake', stationId: 'furnace_t' }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.countForTest('acct_f', 'metal')).toBe(48);
    expect(room.countForTest('acct_f', 'charcoal')).toBe(12);
    expect(room.stationForTest('furnace_t')!.outputs.every((slot) => slot === null)).toBe(true);

    client.leave();
  });

  it('consumes no inputs or fuel while the outputs are full', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('furnace_t', 'furnace', AT_ARMS_LENGTH);
    room.grantForTest('acct_b', 'metal_ore', 24);
    room.grantForTest('acct_b', 'wood', 12);
    const client = await colyseus.connectTo(room, { accountId: 'acct_b' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_t', definitionId: 'metal_ore', quantity: 24 }));
    await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_t', definitionId: 'wood', quantity: 12 }));
    await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'stationLight', stationId: 'furnace_t', lit: true }));
    await client.waitForMessage('commandResult');

    // Every output slot full: metal stacks to 250, so 3 x 250 leaves nowhere
    // for either the metal or the charcoal to go.
    room.setStationOutputsForTest('furnace_t', [
      { definitionId: 'metal', quantity: 250 },
      { definitionId: 'metal', quantity: 250 },
      { definitionId: 'metal', quantity: 250 },
    ]);

    room.advanceStationsForTest(60);

    const station = room.stationForTest('furnace_t')!;
    expect(totalOf(station.inputs, 'metal_ore')).toBe(24);
    expect(station.fuel).toEqual({ definitionId: 'wood', quantity: 12 });
    expect(station.progressS).toBe(0);

    client.leave();
  });

  it('refuses to load a station from across the map', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('furnace_far', 'furnace', { x: 1000, y: 0, z: 1000 });
    room.grantForTest('acct_far', 'wood', 12);
    const client = await colyseus.connectTo(room, { accountId: 'acct_far' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_far', definitionId: 'wood', quantity: 12 }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.countForTest('acct_far', 'wood')).toBe(12); // nothing left the pack

    client.leave();
  });

  it('refuses an input the station does not smelt, rather than eating it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('furnace_t', 'furnace', AT_ARMS_LENGTH);
    room.grantForTest('acct_bad', 'stone', 10);
    const client = await colyseus.connectTo(room, { accountId: 'acct_bad' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_t', definitionId: 'stone', quantity: 10 }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');
    expect(room.countForTest('acct_bad', 'stone')).toBe(10);

    client.leave();
  });

  it('refuses to insert more than the player actually has', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('furnace_t', 'furnace', AT_ARMS_LENGTH);
    room.grantForTest('acct_short', 'wood', 3);
    const client = await colyseus.connectTo(room, { accountId: 'acct_short' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationInsert', stationId: 'furnace_t', definitionId: 'wood', quantity: 12 }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');
    expect(room.countForTest('acct_short', 'wood')).toBe(3);
    expect(room.stationForTest('furnace_t')!.fuel).toBeNull();

    client.leave();
  });
});

/** The same wiring has to serve CONTENT's other station without changes. */
describe('WorldRoom campfire (CONTENT section 3)', () => {
  it('cooks 6 meat and makes 6 charcoal in 60s', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('campfire_t', 'campfire', AT_ARMS_LENGTH);
    room.grantForTest('acct_c', 'raw_meat', 6);
    room.grantForTest('acct_c', 'wood', 6);
    const client = await colyseus.connectTo(room, { accountId: 'acct_c' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationInsert', stationId: 'campfire_t', definitionId: 'raw_meat', quantity: 6 }));
    await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'stationInsert', stationId: 'campfire_t', definitionId: 'wood', quantity: 6 }));
    await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'stationLight', stationId: 'campfire_t', lit: true }));
    await client.waitForMessage('commandResult');

    room.advanceStationsForTest(60);

    const station = room.stationForTest('campfire_t')!;
    expect(totalOf(station.outputs, 'cooked_meat')).toBe(6);
    expect(totalOf(station.outputs, 'charcoal')).toBe(6);

    client.leave();
  });

  it('stays cold until it is lit', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('campfire_t', 'campfire', AT_ARMS_LENGTH);
    room.grantForTest('acct_cold', 'raw_meat', 6);
    room.grantForTest('acct_cold', 'wood', 6);
    const client = await colyseus.connectTo(room, { accountId: 'acct_cold' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'stationInsert', stationId: 'campfire_t', definitionId: 'raw_meat', quantity: 6 }));
    await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'stationInsert', stationId: 'campfire_t', definitionId: 'wood', quantity: 6 }));
    await client.waitForMessage('commandResult');

    room.advanceStationsForTest(60);

    const station = room.stationForTest('campfire_t')!;
    expect(totalOf(station.outputs, 'cooked_meat')).toBe(0);
    expect(station.fuel).toEqual({ definitionId: 'wood', quantity: 6 });

    client.leave();
  });
});
