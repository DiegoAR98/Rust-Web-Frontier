import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2618);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

/** Blocks the event loop, the way a loaded machine does between two awaits. */
function stallEventLoop(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* busy */
  }
}

/**
 * Guards tests/setup.ts. Every other integration file opens with
 * `connectTo` followed by `waitForMessage('session')`, and that pair is a
 * race: the room sends `session` one clock tick after the join, and
 * waitForMessage only catches messages that arrive after it is called. When
 * the event loop stalls longer than a tick in between -- which it does under
 * a parallel run -- the message is delivered to nobody and the wait blocks
 * until it times out, failing a random file on about one run in five.
 */
describe('test harness: the session handshake survives a stalled event loop', () => {
  it('still delivers session when the message beats the wait', async () => {
    const room = await colyseus.createRoom('world', {});
    const client = await colyseus.connectTo(room, { accountId: 'acct_stall' });

    // Longer than the room's 50ms clock tick, so `session` is guaranteed to
    // have been dispatched before waitForMessage registers anything.
    stallEventLoop(200);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let it be delivered

    const session = await client.waitForMessage('session');

    expect(session.sessionEpoch).toBeGreaterThan(0);

    client.leave();
  });

  it('still delivers the join frames to a handler bound after they arrived', async () => {
    // The same race with a persistent listener instead of a wait: the counter
    // pattern several tests use would silently see nothing at all.
    const room = await colyseus.createRoom('world', {});
    const client = await colyseus.connectTo(room, { accountId: 'acct_late' });

    stallEventLoop(200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const inventories: unknown[] = [];
    client.onMessage('inventory', (payload) => inventories.push(payload));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(inventories).toHaveLength(1);

    client.leave();
  });
});
