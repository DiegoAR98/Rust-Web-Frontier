import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { WorldStore } from '@rwf/server/persistence';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;
let dbFile: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2615);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-craft-writes-'));
  dbFile = join(dir, 'world.sqlite');
  process.env.RWF_DB_PATH = dbFile;
});

afterEach(async () => {
  await colyseus.cleanup();
  delete process.env.RWF_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await colyseus.shutdown();
});

function craftCommand(sequence: number) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence,
    clientTick: 0,
    action: { type: 'craft', recipeId: 'stone_hatchet', quantity: 2 },
  };
}

function readProgress(): number | undefined {
  const store = new WorldStore(dbFile);
  const progress = store.loadCraftingEntries().get('acct_w')?.progressS;
  store.close();
  return progress;
}

/**
 * TECHNICAL section 7 splits durable state in two. The escrow debit and each
 * delivered unit are class-1: they persist at commit time. A partially
 * elapsed unit is class-2 continuous state, checkpointed every 5s. Writing
 * progressS on every tick instead would put an fsync (synchronous = FULL) on
 * the 20Hz game-loop thread for every crafting player.
 */
describe('WorldRoom crafting write rate (TECHNICAL section 7)', () => {
  it('does not persist partial progress on every tick', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.grantForTest('acct_w', 'wood', 30);
    room.grantForTest('acct_w', 'stone', 20);
    const client = await colyseus.connectTo(room, { accountId: 'acct_w' });
    await client.waitForMessage('session');

    client.send('command', craftCommand(1));
    await client.waitForMessage('commandResult');

    // Well short of the recipe's 10s duration: progress moves, no unit lands.
    for (let i = 0; i < 40; i++) room.advanceCraftingForTest(0.05);

    expect(readProgress()).toBe(0);
  });

  it('checkpoints the accumulated progress', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.grantForTest('acct_w', 'wood', 30);
    room.grantForTest('acct_w', 'stone', 20);
    const client = await colyseus.connectTo(room, { accountId: 'acct_w' });
    await client.waitForMessage('session');

    client.send('command', craftCommand(1));
    await client.waitForMessage('commandResult');

    for (let i = 0; i < 40; i++) room.advanceCraftingForTest(0.05);
    room.checkpoint();

    // Not per-tick, but never lost either: at most one checkpoint interval.
    expect(readProgress()).toBeGreaterThan(0);
  });

  it('persists a completed unit immediately, without waiting for a checkpoint', async () => {
    // Class-1: a delivered unit is a committed transaction, not continuous state.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.grantForTest('acct_w', 'wood', 30);
    room.grantForTest('acct_w', 'stone', 20);
    const client = await colyseus.connectTo(room, { accountId: 'acct_w' });
    await client.waitForMessage('session');

    client.send('command', craftCommand(1));
    await client.waitForMessage('commandResult');

    room.advanceCraftingForTest(10); // exactly one unit

    const store = new WorldStore(dbFile);
    const entry = store.loadCraftingEntries().get('acct_w');
    store.close();

    expect(entry?.completedUnits).toBe(1);
  });
});
