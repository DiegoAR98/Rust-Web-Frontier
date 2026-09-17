import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2610);
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
 * Fills all 24 backpack slots with full 250-stacks of wood. Clears first,
 * because a player now joins carrying GDD section 5's spawn kit, and these
 * tests are about exact capacity boundaries.
 */
function fillBackpackWithWood(room: WorldRoom, accountId: string): void {
  room.clearInventoryForTest(accountId);
  room.grantForTest(accountId, 'wood', 24 * 250);
}

describe('WorldRoom inventory overflow (GDD section 8)', () => {
  it('refuses a gather hit that has nowhere to go, leaving the node budget intact', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnNode('node_overflow', 'wood', 150, 10);
    const client = await colyseus.connectTo(room, { accountId: 'acct_full' });
    await client.waitForMessage('session');
    fillBackpackWithWood(room, 'acct_full');

    client.send('command', command({ type: 'hitNode', nodeId: 'node_overflow' }, 1));
    const result = await client.waitForMessage('commandResult');

    // The resource must not be consumed by a hit that grants nothing.
    expect(result.accepted).toBe(false);
    expect(room.nodeRemainingForTest('node_overflow')).toBe(150);
  });

  it('pauses crafting instead of destroying output the backpack cannot hold', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_craft' });
    await client.waitForMessage('session');

    // stone_hatchet is stack:1, so each of the 3 queued units needs its own
    // free slot. Fill all 24: wood and stone take one slot each (both stack to
    // 250) and `rock` is stack:1, so 22 rocks occupy 22 slots. Escrow then
    // empties the wood and stone slots, leaving room for exactly 2 of the 3.
    room.clearInventoryForTest('acct_craft'); // drop the spawn kit; see above
    room.grantForTest('acct_craft', 'wood', 15 * 3);
    room.grantForTest('acct_craft', 'stone', 10 * 3);
    room.grantForTest('acct_craft', 'rock', 22);

    client.send('command', command({ type: 'craft', recipeId: 'stone_hatchet', quantity: 3 }, 1));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    // Far more than the 30s the three units need.
    room.advanceCraftingForTest(60);

    const hatchets = room.countForTest('acct_craft', 'stone_hatchet');
    const entry = room.craftingEntryForTest('acct_craft');

    // Only what fits may be produced, and the third unit must still be owed --
    // not marked complete with its output dropped on the floor.
    expect(hatchets).toBe(2);
    expect(entry).toBeDefined();
    expect(entry!.completedUnits).toBe(2);
    expect(entry!.totalUnits).toBe(3);
  });
});
