import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
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
