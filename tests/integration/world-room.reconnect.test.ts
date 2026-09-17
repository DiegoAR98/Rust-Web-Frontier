import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2613);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A half-dead socket can outlive the reconnect that replaced it: the player
 * reconnects, onJoin rebinds the account to the new client, and only then does
 * the old socket's close finally fire. If onLeave keys purely on accountId it
 * tears down the live session, and the reconnected player silently stops
 * receiving vitals forever while still appearing connected.
 */
describe('WorldRoom reconnect while an old socket is still closing', () => {
  it('keeps the live session when a superseded connection leaves afterwards', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;

    const stale = await colyseus.connectTo(room, { accountId: 'acct_recon' });
    await stale.waitForMessage('session');

    const live = await colyseus.connectTo(room, { accountId: 'acct_recon' });
    await live.waitForMessage('session');

    // The old socket's close lands after the reconnect has already rebound.
    await stale.leave();
    await sleep(100);

    expect(room.isConnectedForTest('acct_recon')).toBe(true);

    let vitalsAfterLeave = 0;
    live.onMessage('vitals', () => {
      vitalsAfterLeave += 1;
    });
    await sleep(300);

    // The reconnected player must still be simulated, not silently dropped.
    expect(vitalsAfterLeave).toBeGreaterThan(0);
  });

  it('still tears the account down when the current connection is the one leaving', async () => {
    // Guards against a check so defensive that a real disconnect never cleans up.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;

    const client = await colyseus.connectTo(room, { accountId: 'acct_gone' });
    await client.waitForMessage('session');
    expect(room.isConnectedForTest('acct_gone')).toBe(true);

    await client.leave();
    await sleep(100);

    expect(room.isConnectedForTest('acct_gone')).toBe(false);
  });
});
