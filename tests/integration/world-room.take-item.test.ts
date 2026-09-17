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

/**
 * GDD section 5: taking a world item puts it in the taker's pack. Claiming it
 * on the replicated state only removes it from the world; without the grant
 * the item is destroyed rather than picked up.
 */
describe('WorldRoom take-item grants the item (GDD section 5)', () => {
  it('puts the taken item in the pack and tells the owner', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_1', 'wood');

    const client = await colyseus.connectTo(room, { accountId: 'acct_take' });
    const inventories: Array<{ slots: Array<{ definitionId: string; quantity: number } | null> }> = [];
    client.onMessage('inventory', (payload) => inventories.push(payload));
    await client.waitForMessage('session');

    expect(room.countForTest('acct_take', 'wood')).toBe(0);

    client.send('command', takeItemCommand(1, 'item_1'));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.countForTest('acct_take', 'wood')).toBe(1);
    // The owner has to be told, the same way an accepted gather tells them.
    const latest = inventories.at(-1)!;
    expect(latest.slots.filter((s) => s?.definitionId === 'wood')).toHaveLength(1);

    client.leave();
  });

  it('refuses a take that will not fit and leaves the item unclaimed', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_1', 'wood');

    const client = await colyseus.connectTo(room, { accountId: 'acct_full' });
    await client.waitForMessage('session');
    // Stone hatchets do not stack, so 24 of them occupy every backpack slot
    // and leave wood nowhere to go. Cleared first: a player now joins with
    // GDD section 5's spawn kit already taking three of those slots.
    room.clearInventoryForTest('acct_full');
    room.grantForTest('acct_full', 'stone_hatchet', 24);

    client.send('command', takeItemCommand(1, 'item_1'));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');
    // GDD section 8: a refused take must not consume the item. Claiming it
    // and then failing to grant it would delete it from the world.
    expect(room.state.items.get('item_1')!.claimedBy).toBe('');
    expect(room.countForTest('acct_full', 'wood')).toBe(0);

    client.leave();
  });
});
