import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { CALORIE_SPAWN } from '@rwf/sim';
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
  it('sends the spawn calorie/health values to a freshly joined player', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });

    const vitals = await client.waitForMessage('vitals');

    expect(vitals).toEqual({ calories: CALORIE_SPAWN, health: 100 });
  });

  it('drains calories over real elapsed ticks at the standing/walking rate', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });

    let latestVitals: { calories: number; health: number } | undefined;
    client.onMessage('vitals', (payload: { calories: number; health: number }) => {
      latestVitals = payload;
    });
    await client.waitForMessage('inventory'); // confirms onJoin's initial batch landed

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
