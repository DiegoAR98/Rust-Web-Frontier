import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2604);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function takeItemCommand(sessionEpoch: number, itemInstanceId: string) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence: 1,
    clientTick: 0,
    action: { type: 'takeItem', itemInstanceId },
  };
}

describe('WorldRoom take-item conservation (T03)', () => {
  it('grants a contested item to exactly one of two racing clients, both replicating the same winner', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_1', 'wood');

    const clientA = await colyseus.connectTo(room, { accountId: 'acct_a' });
    const clientB = await colyseus.connectTo(room, { accountId: 'acct_b' });

    clientA.send('command', takeItemCommand(1, 'item_1'));
    clientB.send('command', takeItemCommand(1, 'item_1'));

    const [resultA, resultB] = await Promise.all([
      clientA.waitForMessage('commandResult'),
      clientB.waitForMessage('commandResult'),
    ]);

    const outcomes = [resultA, resultB];
    const accepted = outcomes.filter((r) => r.accepted);
    const rejected = outcomes.filter((r) => !r.accepted);

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasonCode).toBe('already_taken');

    await clientA.waitForNextPatch();
    const claimedByA = clientA.state.items.get('item_1')!.claimedBy;
    const claimedByB = clientB.state.items.get('item_1')!.claimedBy;
    expect(claimedByA).toBe(claimedByB);
    expect(['acct_a', 'acct_b']).toContain(claimedByA);

    clientA.leave();
    clientB.leave();
  });

  it('replays the same outcome for a duplicate sequence instead of granting the item twice', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_1', 'wood');

    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });

    client.send('command', takeItemCommand(1, 'item_1'));
    const first = await client.waitForMessage('commandResult');

    client.send('command', takeItemCommand(1, 'item_1')); // same sequence: 1
    const replay = await client.waitForMessage('commandResult');

    expect(first.accepted).toBe(true);
    expect(replay).toEqual(first);

    client.leave();
  });
});
