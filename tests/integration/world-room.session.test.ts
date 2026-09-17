import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2602);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

describe('WorldRoom session epoch handshake', () => {
  it('tells a freshly joined client its assigned session epoch', async () => {
    const room = await colyseus.createRoom('world', {});
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });

    const session = await client.waitForMessage('session');

    expect(session.sessionEpoch).toBe(1);
    client.leave();
  });

  it('gives a reconnecting account a strictly greater session epoch than before', async () => {
    const room = await colyseus.createRoom('world', {});

    const first = await colyseus.connectTo(room, { accountId: 'acct_a' });
    const firstSession = await first.waitForMessage('session');
    first.leave();

    const second = await colyseus.connectTo(room, { accountId: 'acct_a' });
    const secondSession = await second.waitForMessage('session');

    expect(secondSession.sessionEpoch).toBeGreaterThan(firstSession.sessionEpoch);
    second.leave();
  });
});
