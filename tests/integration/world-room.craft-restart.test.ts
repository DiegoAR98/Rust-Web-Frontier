import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2614);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-craft-restart-'));
  process.env.RWF_DB_PATH = join(dir, 'world.sqlite');
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

/**
 * Accepting a craft debits the inputs immediately and persists that debit, but
 * the queue entry that owes the output lived only in memory. A restart
 * therefore destroyed the materials outright: the slots came back short, the
 * queue was empty, and there was no output and no refund. Every other piece of
 * room state survives a restart; escrow must not be the one-way door.
 */
describe('WorldRoom crafting escrow across a restart (T17)', () => {
  it('still owes the output after a restart, rather than pocketing the escrow', async () => {
    const before = (await colyseus.createRoom('world', {})) as WorldRoom;
    before.grantForTest('acct_c', 'wood', 30);
    before.grantForTest('acct_c', 'stone', 20);
    const client = await colyseus.connectTo(before, { accountId: 'acct_c' });
    await client.waitForMessage('session');

    client.send('command', craftCommand(1));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    // The inputs are gone from the pack and that debit is already durable.
    expect(before.countForTest('acct_c', 'wood')).toBe(0);
    // Force-kill the host: dispose every room this test created.
    await colyseus.cleanup();

    const after = (await colyseus.createRoom('world', {})) as WorldRoom;
    const entry = after.craftingEntryForTest('acct_c');

    expect(entry).toBeDefined();
    expect(entry!.totalUnits).toBe(2);
    expect(entry!.recipe.outputId).toBe('stone_hatchet');
  });

  it('delivers the output the restored entry owes', async () => {
    const before = (await colyseus.createRoom('world', {})) as WorldRoom;
    before.grantForTest('acct_d', 'wood', 30);
    before.grantForTest('acct_d', 'stone', 20);
    const client = await colyseus.connectTo(before, { accountId: 'acct_d' });
    await client.waitForMessage('session');

    client.send('command', craftCommand(1));
    await client.waitForMessage('commandResult');
    // Force-kill the host: dispose every room this test created.
    await colyseus.cleanup();

    const after = (await colyseus.createRoom('world', {})) as WorldRoom;
    after.advanceCraftingForTest(30); // both units' 10s durations, generously

    expect(after.countForTest('acct_d', 'stone_hatchet')).toBe(2);
  });
});
