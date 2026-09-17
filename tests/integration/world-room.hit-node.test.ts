import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2606);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function hitNodeCommand(sessionEpoch: number, nodeId: string, sequence = 1) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'hitNode', nodeId },
  };
}

describe('WorldRoom hit-node conservation (T03, gathering)', () => {
  it('never dispenses more than the node budget when two clients race for the final yield', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnNode('node_1', 'wood', 10, 10); // exactly one hit's worth

    const clientA = await colyseus.connectTo(room, { accountId: 'acct_a' });
    const clientB = await colyseus.connectTo(room, { accountId: 'acct_b' });
    await Promise.all([clientA.waitForMessage('session'), clientB.waitForMessage('session')]);

    // Register every listener before sending: the server replies with
    // commandResult then inventory back to back, so awaiting the first
    // before registering the second can miss it (waitForMessage only
    // catches messages that arrive after it's called).
    const commandResults = Promise.all([
      clientA.waitForMessage('commandResult'),
      clientB.waitForMessage('commandResult'),
    ]);
    const inventoryUpdates = Promise.all([
      clientA.waitForMessage('inventory'),
      clientB.waitForMessage('inventory'),
    ]);

    clientA.send('command', hitNodeCommand(1, 'node_1'));
    clientB.send('command', hitNodeCommand(1, 'node_1'));

    const [resultA, resultB] = await commandResults;

    const accepted = [resultA, resultB].filter((r) => r.accepted);
    const rejected = [resultA, resultB].filter((r) => !r.accepted);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasonCode).toBe('depleted');

    const [inventoryA, inventoryB] = await inventoryUpdates;
    const woodGranted =
      (inventoryA.slots.find((s: { definitionId: string } | null) => s?.definitionId === 'wood')?.quantity ?? 0) +
      (inventoryB.slots.find((s: { definitionId: string } | null) => s?.definitionId === 'wood')?.quantity ?? 0);
    expect(woodGranted).toBe(10); // the node's entire budget, granted exactly once
  });

  it('a subsequent hit on a depleted node grants nothing further', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnNode('node_1', 'wood', 10, 10);
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });
    await client.waitForMessage('session');

    client.send('command', hitNodeCommand(1, 'node_1', 1));
    await client.waitForMessage('commandResult');

    client.send('command', hitNodeCommand(1, 'node_1', 2));
    const second = await client.waitForMessage('commandResult');

    expect(second.accepted).toBe(false);
    expect(second.reasonCode).toBe('depleted');
  });
});
