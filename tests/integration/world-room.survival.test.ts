import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { CALORIE_SPAWN, EXPOSURE_ZONE_RATES, HAZARD_ZONE_CENTER } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2607);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe('WorldRoom survival wiring (T05)', () => {
  it('sends vitals close to spawn defaults to a freshly joined player', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });

    const vitals = await client.waitForMessage('vitals');

    // Calories are not an exact match: room creation and the join handshake
    // can themselves take long enough for a few real ticks to elapse before
    // this message is captured, so a little drain by this point is expected.
    expect(vitals.calories).toBeGreaterThan(CALORIE_SPAWN - 1);
    expect(vitals.calories).toBeLessThanOrEqual(CALORIE_SPAWN);
    expect(vitals.health).toBe(100);
    // Exposure is exact, because the spawn point is clear of the hazard zone.
    // This used to be a tolerance window, and the window was the bug: the
    // spawn sat inside the zone, so the assertion was really "how slow was
    // this machine" and it failed on a loaded one.
    expect(vitals.exposure).toBe(0);
  });

  it('drains calories over real elapsed ticks at the standing/walking rate', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });

    let latestVitals: { calories: number; health: number } | undefined;
    client.onMessage('vitals', (payload: { calories: number; health: number }) => {
      latestVitals = payload;
    });
    // Waits for a vitals frame rather than onJoin's one-shot inventory: the
    // join batch may already have landed by the time this line runs (see
    // tests/setup.ts), whereas vitals ship every tick, so a frame after now
    // is guaranteed and proves the same thing -- the room is ticking at us.
    await client.waitForMessage('vitals');

    for (let i = 0; i < 5; i++) {
      await room.waitForNextTimestep();
    }
    // Client-side message delivery can lag a tick or two behind the
    // server's own tick counter; wait for one more update to flush any
    // in-flight message rather than asserting the instant after the loop.
    await client.waitForMessage('vitals');

    // Assert against a tolerant window rather than an exact tick count:
    // the room's own tick counter is authoritative for "how many ticks
    // ran", but exact client-side delivery timing isn't part of the
    // contract this test is proving (the pure drainCalories test already
    // nails the exact formula; this test proves the tick loop is wired).
    const drained = CALORIE_SPAWN - latestVitals!.calories;
    expect(drained).toBeGreaterThan(0);
    expect(drained).toBeLessThanOrEqual(0.25 * 0.05 * (room.state.tick + 1) + 1e-9);
    expect(latestVitals!.health).toBe(100);
  });
});

describe('WorldRoom hazard zone exposure wiring (T06)', () => {
  it('accumulates exposure for a player standing in the hazard zone', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });
    // Walked into it, rather than spawned in it: a new player starts clear.
    room.teleportForTest('acct_a', { x: HAZARD_ZONE_CENTER.x, y: 0, z: HAZARD_ZONE_CENTER.z });

    let latestVitals: { exposure: number } | undefined;
    client.onMessage('vitals', (payload: { exposure: number }) => {
      latestVitals = payload;
    });
    await client.waitForMessage('vitals'); // see the note in the calorie test above

    for (let i = 0; i < 5; i++) {
      await room.waitForNextTimestep();
    }
    await client.waitForMessage('vitals');

    // Standing in the placeholder hazard zone, exposure accumulates at the
    // medium zone rate (tolerant window, same reasoning as the calorie-drain
    // test above).
    expect(latestVitals!.exposure).toBeGreaterThan(0);
    expect(latestVitals!.exposure).toBeLessThanOrEqual(
      EXPOSURE_ZONE_RATES.medium * 0.05 * (room.state.tick + 1) + 1e-9,
    );
  });
});
