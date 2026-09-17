import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2609);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sprintForward(sessionEpoch: number, sequence: number) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'move', axisX: 0, axisY: 1, yaw: 0, sprint: true, crouch: false, jump: false },
  };
}

/**
 * A move intent describes what the player is doing *right now*. Latching it
 * forever means one packet keeps driving the avatar after the client has
 * stopped sending -- a backgrounded tab (whose setInterval browsers throttle
 * to ~1Hz) or any packet-loss gap leaves the player sprinting across the map
 * unattended, burning calories at the sprint rate the whole way.
 */
describe('WorldRoom stale move intents', () => {
  it('stops integrating a move intent the client has stopped refreshing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_stale' });
    await client.waitForMessage('session');

    client.send('command', sprintForward(1, 1));

    // Let the intent apply, then go quiet the way a throttled tab does.
    await sleep(300);
    const zAfterGrace = room.state.players.get('acct_stale')!.z;
    expect(zAfterGrace).toBeGreaterThan(0); // the command really did take effect

    await sleep(500);
    const zLater = room.state.players.get('acct_stale')!.z;

    // Without expiry this drifts a further ~2.75m (0.5s at SPRINT 5.5 m/s).
    expect(zLater - zAfterGrace).toBeLessThan(0.2);
  });

  it('stops draining calories at the sprint rate once the intent goes stale', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_stale_cal' });
    await client.waitForMessage('session');

    client.send('command', sprintForward(1, 1));
    // Comfortably past the grace window rather than just over it: at 20Hz,
    // 300ms is only ~6 ticks against a 5-tick grace, which scheduler jitter
    // can turn into 5.
    await sleep(500);

    // The sprint flag rides the same latched entry as the axes, so an expired
    // intent must stop counting as sprinting too.
    expect(room.isSprintingForTest('acct_stale_cal')).toBe(false);
  });

  it('keeps applying a move intent the client is still refreshing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_fresh' });
    await client.waitForMessage('session');

    // A real client resends at 20Hz; expiry must not interrupt that.
    let sequence = 0;
    const timer = setInterval(() => {
      sequence += 1;
      client.send('command', sprintForward(1, sequence));
    }, 50);

    await sleep(300);
    const zEarly = room.state.players.get('acct_fresh')!.z;
    await sleep(400);
    const zLate = room.state.players.get('acct_fresh')!.z;
    clearInterval(timer);

    expect(zLate - zEarly).toBeGreaterThan(1);
  });
});
