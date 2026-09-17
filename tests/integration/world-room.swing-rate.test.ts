import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2612);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function hitNode(nodeId: string, sequence: number, sessionEpoch = 1) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'hitNode', nodeId },
  };
}

/**
 * CONTENT.md section 4: "Rock swing interval 1 s". TECHNICAL.md section 3
 * lists action rate and cooldown among the checks the server owes every
 * command. Without one, a scripted client drains a node's entire budget in as
 * many packets as it can write, and each swing costs a synchronous SQLite
 * write on the 20Hz game-loop thread.
 */
describe('WorldRoom swing rate (CONTENT section 4)', () => {
  it('refuses a second swing inside the swing interval', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnNode('node_rate', 'wood', 150, 10, { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_rate' });
    await client.waitForMessage('session');

    client.send('command', hitNode('node_rate', 1));
    const first = await client.waitForMessage('commandResult');
    client.send('command', hitNode('node_rate', 2));
    const second = await client.waitForMessage('commandResult');

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.reasonCode).toBe('rate_limited');
  });

  it('spends the node budget only for the swings it actually accepted', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnNode('node_burst', 'wood', 150, 10, { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_burst' });
    await client.waitForMessage('session');

    // A persistent listener, not repeated waitForMessage: the latter only
    // catches messages arriving after it is called, so replies to the burst
    // land before the loop starts awaiting them.
    let received = 0;
    client.onMessage('commandResult', () => {
      received += 1;
    });

    // The attack: 15 packets would otherwise strip the whole 150 budget.
    for (let i = 1; i <= 15; i++) {
      client.send('command', hitNode('node_burst', i));
    }
    while (received < 15) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(room.nodeRemainingForTest('node_burst')).toBe(140);
  });

  it('allows the next swing once the interval has elapsed', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnNode('node_ok', 'wood', 150, 10, { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_ok' });
    await client.waitForMessage('session');

    client.send('command', hitNode('node_ok', 1));
    await client.waitForMessage('commandResult');

    await new Promise((resolve) => setTimeout(resolve, 1100));

    client.send('command', hitNode('node_ok', 2));
    const second = await client.waitForMessage('commandResult');

    expect(second.accepted).toBe(true);
    expect(room.nodeRemainingForTest('node_ok')).toBe(130);
  });
});
