import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2616);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

interface CraftingPayload {
  recipeId: string | null;
  completedUnits: number;
  totalUnits: number;
  progressS: number;
}

function craftCommand(sequence: number, quantity = 1) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence,
    clientTick: 0,
    action: { type: 'craft', recipeId: 'stone_hatchet', quantity },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crafting state is private to its owner (TECHNICAL section 3: it never rides
 * the shared replicated schema), so it travels as a targeted message. Without
 * it the client has no way to show a queue at all -- the player would press
 * craft and see nothing happen for ten seconds.
 */
describe('WorldRoom crafting replication', () => {
  it('tells the owner about their queue when a craft is accepted', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.grantForTest('acct_r', 'wood', 15);
    room.grantForTest('acct_r', 'stone', 10);
    const client = await colyseus.connectTo(room, { accountId: 'acct_r' });

    const updates: CraftingPayload[] = [];
    client.onMessage('crafting', (p: CraftingPayload) => updates.push(p));
    await client.waitForMessage('session');

    client.send('command', craftCommand(1));
    await client.waitForMessage('commandResult');
    await sleep(150);

    const latest = updates.at(-1);
    expect(latest).toBeDefined();
    expect(latest!.recipeId).toBe('stone_hatchet');
    expect(latest!.totalUnits).toBe(1);
    expect(latest!.completedUnits).toBe(0);
  });

  it('reports the queue as empty once the last unit is delivered', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.grantForTest('acct_s', 'wood', 15);
    room.grantForTest('acct_s', 'stone', 10);
    const client = await colyseus.connectTo(room, { accountId: 'acct_s' });

    const updates: CraftingPayload[] = [];
    client.onMessage('crafting', (p: CraftingPayload) => updates.push(p));
    await client.waitForMessage('session');

    client.send('command', craftCommand(1));
    await client.waitForMessage('commandResult');

    room.advanceCraftingForTest(10); // the recipe's full durationS
    await sleep(150);

    // A finished queue must be announced, or the UI shows a craft in progress
    // forever with nothing left to deliver.
    expect(updates.at(-1)!.recipeId).toBeNull();
  });

  it('restores the queue to a client that reconnects mid-craft', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.grantForTest('acct_t', 'wood', 30);
    room.grantForTest('acct_t', 'stone', 20);
    const first = await colyseus.connectTo(room, { accountId: 'acct_t' });
    await first.waitForMessage('session');
    first.send('command', craftCommand(1, 2));
    await first.waitForMessage('commandResult');

    const second = await colyseus.connectTo(room, { accountId: 'acct_t' });
    const updates: CraftingPayload[] = [];
    second.onMessage('crafting', (p: CraftingPayload) => updates.push(p));
    await second.waitForMessage('session');
    await sleep(150);

    // Rejoining must not present an empty queue while escrow is still held.
    expect(updates.at(-1)?.recipeId).toBe('stone_hatchet');
    expect(updates.at(-1)?.totalUnits).toBe(2);
  });
});
