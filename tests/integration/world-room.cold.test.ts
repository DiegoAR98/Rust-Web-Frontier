import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { DAYLIGHT_TICKS } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2617);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

/**
 * T07: "Naked lowland night versus full cloth set -- naked deficit 20 blocks
 * regen / adds 0.25 cal/s". GDD section 6 sets lowland night pressure to 20,
 * and with no clothing yet the player's warmth is 0, so the deficit is exactly
 * the 20 the acceptance case names.
 */
describe('WorldRoom cold (T07, GDD section 6)', () => {
  it('applies no cold by day', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_day' });
    await client.waitForMessage('session');

    expect(room.coldDeficitForTest('acct_day')).toBe(0);
  });

  it('gives a naked lowland player a deficit of 20 at night', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_night' });
    await client.waitForMessage('session');

    room.setTickForTest(DAYLIGHT_TICKS);

    expect(room.coldDeficitForTest('acct_night')).toBe(20);
  });

  it('drains the extra 0.25 calories/s a deficit of 20 costs', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_drain' });
    await client.waitForMessage('session');

    room.setTickForTest(DAYLIGHT_TICKS);
    const before = room.vitalsForTest('acct_drain')!.calories;
    room.advanceSurvivalForTest(10); // ten seconds of night, standing still

    const drained = before - room.vitalsForTest('acct_drain')!.calories;
    // Standing still costs 0.25/s baseline (GDD section 6) and cold adds
    // another 0.25/s at deficit 20, so ten seconds costs 2.5 + 2.5.
    expect(drained).toBeCloseTo(5, 5);
  });

  it('does not cost cold calories by day, isolating the night penalty', async () => {
    // Guards the assertion above against passing for the wrong reason.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_ctrl' });
    await client.waitForMessage('session');

    const before = room.vitalsForTest('acct_ctrl')!.calories;
    room.advanceSurvivalForTest(10);

    expect(before - room.vitalsForTest('acct_ctrl')!.calories).toBeCloseTo(2.5, 5);
  });
});

/**
 * T07's other half, for the fire case: GDD section 6 gives "a fire within 4 m
 * with unobstructed warmth ray ... 40 [warmth]", which clears lowland night's
 * pressure of 20 outright.
 */
describe('WorldRoom fire warmth (T07, GDD section 6)', () => {
  it('clears the cold penalty for a player stood at a lit campfire', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('campfire_w', 'campfire', { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_warm' });
    await client.waitForMessage('session');
    room.setTickForTest(DAYLIGHT_TICKS); // night

    expect(room.coldDeficitForTest('acct_warm')).toBe(20);

    client.send('command', {
      protocolVersion: PROTOCOL_VERSION,
      sessionEpoch: 1,
      sequence: 1,
      clientTick: 0,
      action: { type: 'stationLight', stationId: 'campfire_w', lit: true },
    });
    await client.waitForMessage('commandResult');

    expect(room.coldDeficitForTest('acct_warm')).toBe(0);

    client.leave();
  });

  it('leaves a player out of reach of the fire just as cold', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnStation('campfire_w', 'campfire', { x: 1, y: 0, z: 0 });
    const lighter = await colyseus.connectTo(room, { accountId: 'acct_lighter' });
    await lighter.waitForMessage('session');
    room.setTickForTest(DAYLIGHT_TICKS);

    lighter.send('command', {
      protocolVersion: PROTOCOL_VERSION,
      sessionEpoch: 1,
      sequence: 1,
      clientTick: 0,
      action: { type: 'stationLight', stationId: 'campfire_w', lit: true },
    });
    await lighter.waitForMessage('commandResult');

    // A player who never joined has no body; use one parked far away instead.
    room.teleportForTest('acct_lighter', { x: 100, y: 0, z: 100 });

    expect(room.coldDeficitForTest('acct_lighter')).toBe(20);

    lighter.leave();
  });
});
