import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2608);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function craftCommand(sessionEpoch: number, recipeId: string, quantity: number, sequence = 1) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'craft', recipeId, quantity },
  };
}

describe('WorldRoom crafting (GDD section 9)', () => {
  it('rejects crafting when the player lacks the required materials, escrowing nothing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });
    await client.waitForMessage('session');

    client.send('command', craftCommand(1, 'stone_hatchet', 1));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');
  });

  it('escrows materials on accept and delivers the output after the recipe duration elapses', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.grantForTest('acct_a', 'wood', 15);
    room.grantForTest('acct_a', 'stone', 10);
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });
    await client.waitForMessage('session');

    let latestInventory: { slots: Array<{ definitionId: string; quantity: number } | null> } | undefined;
    client.onMessage('inventory', (payload: typeof latestInventory) => {
      latestInventory = payload;
    });

    client.send('command', craftCommand(1, 'stone_hatchet', 1));
    const accepted = await client.waitForMessage('commandResult');
    expect(accepted.accepted).toBe(true);

    // Materials are escrowed immediately: gone from the inventory before
    // the recipe finishes (GDD section 9: "Ingredients ... escrowed when
    // accepted").
    const afterEscrow = latestInventory!.slots.find((s) => s?.definitionId === 'wood');
    expect(afterEscrow).toBeUndefined();

    room.advanceCraftingForTest(10); // the stone_hatchet recipe's durationS
    // The resulting send() travels a real WebSocket; wait for it to
    // actually arrive rather than asserting synchronously right after
    // the call.
    await client.waitForMessage('inventory');

    const hatchet = latestInventory!.slots.find((s) => s?.definitionId === 'stone_hatchet');
    expect(hatchet).toEqual({ definitionId: 'stone_hatchet', quantity: 1 });
  });
});
