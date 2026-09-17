import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2611);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function command(action: unknown, sequence: number, sessionEpoch = 1) {
  return { protocolVersion: PROTOCOL_VERSION, sessionEpoch, sequence, clientTick: 0, action };
}

/**
 * Reach was enforced only in the client (INTERACT_REACH_M in main.ts), which
 * is no enforcement at all: a modified client simply omits the check. The
 * server is the authority for positions everywhere else, so it must be the
 * authority for who is close enough to touch what.
 */
describe('WorldRoom interaction reach (GDD section 5)', () => {
  it('refuses a take-item claim from across the map', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_far', 'wood', { x: 1000, y: 0, z: 1000 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_reach' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'takeItem', itemInstanceId: 'item_far' }, 1));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
  });

  it('refuses a gather swing from across the map without spending the node', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnNode('node_far', 'wood', 150, 10, { x: 1000, y: 0, z: 1000 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_reach2' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'hitNode', nodeId: 'node_far' }, 1));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.nodeRemainingForTest('node_far')).toBe(150);
  });

  it('still allows interaction the player is genuinely standing next to', async () => {
    // Guards against a check so strict it breaks legitimate play: the whole
    // point is to reject the map-wide claim, not the one at arm's length.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_near', 'wood', { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_reach3' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'takeItem', itemInstanceId: 'item_near' }, 1));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(result.reasonCode).toBe('ok');
  });

  it('keeps the default seeded world content reachable from the spawn point', async () => {
    // item_1 and node_1 sit where the client's placeholder meshes are drawn;
    // a player who walks up to them must be able to use them.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_reach4' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'hitNode', nodeId: 'node_1' }, 1));
    const result = await client.waitForMessage('commandResult');

    expect(result.reasonCode).not.toBe('out_of_range');
  });
});
