import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { getRecipe } from '@rwf/content';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2640);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

let sequence = 0;
function command(action: Record<string, unknown>) {
  sequence += 1;
  return { protocolVersion: PROTOCOL_VERSION, sessionEpoch: 1, sequence, clientTick: 0, action };
}

/**
 * GDD section 5's first five minutes: "Learn movement, hit a pile, craft stone
 * hatchet", with "Spawn resources within a short walk". The world seeded wood
 * and metal ore and nothing else, so `stone` -- half of the hatchet recipe and
 * an input to the campfire, the furnace and arrows -- could not be obtained at
 * all. The whole crafting tree began with a step nobody could take.
 */
describe('WorldRoom crafting the first tool (GDD section 5)', () => {
  it('can gather every input the stone hatchet needs from the world itself', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_first' });
    await client.waitForMessage('session');
    room.clearInventoryForTest('acct_first');

    const recipe = getRecipe('stone_hatchet')!;
    // Read off the recipe rather than hardcoded, so a change to its inputs
    // fails here instead of silently leaving one of them unobtainable again.
    for (const [definitionId, quantity] of Object.entries(recipe.inputs)) {
      const nodeId = room.nodeYieldingForTest(definitionId);
      expect(nodeId, `nothing in the world yields ${definitionId}`).toBeDefined();

      room.teleportForTest('acct_first', room.nodePositionForTest(nodeId!)!);
      while (room.countForTest('acct_first', definitionId) < quantity) {
        room.clearSwingCooldownForTest('acct_first');
        client.send('command', command({ type: 'hitNode', nodeId }));
        const result = await client.waitForMessage('commandResult');
        expect(result.accepted, `${nodeId}: ${result.reasonCode}`).toBe(true);
      }
    }

    client.send('command', command({ type: 'craft', recipeId: 'stone_hatchet', quantity: 1 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    room.advanceCraftingForTest(recipe.durationS + 0.1);

    expect(room.countForTest('acct_first', 'stone_hatchet')).toBe(1);

    client.leave();
  });
});
