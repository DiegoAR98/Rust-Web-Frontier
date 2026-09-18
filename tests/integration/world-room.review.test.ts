import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { WorldStore } from '@rwf/server/persistence';
import type { WorldRoom } from '@rwf/server/world-room';

let server: ColyseusTestServer;
let dir: string;
let sequence = 0;
beforeAll(async () => { server = await boot(appConfig, 2680); });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-review-'));
  process.env.RWF_DB_PATH = join(dir, 'world.sqlite');
});
afterEach(async () => {
  await server.cleanup();
  vi.restoreAllMocks();
  process.env.RWF_DB_PATH = ':memory:';
  rmSync(dir, { recursive: true, force: true });
});
afterAll(async () => { await server.shutdown(); });

async function create(accountId = 'reviewer') {
  const room = await server.createRoom('world', {}) as WorldRoom;
  const client = await server.connectTo(room, { accountId });
  const { sessionEpoch } = await client.waitForMessage('session');
  const command = async (action: Record<string, unknown>) => {
    const packet = { protocolVersion: 1, sessionEpoch, sequence: ++sequence, clientTick: 0, action };
    client.send('command', packet);
    return client.waitForMessage('commandResult');
  };
  return { room, client, command };
}

describe('review: account authentication and restored inventories', () => {
  it('rejects a different token without replacing the existing session', async () => {
    const { room, command } = await create();
    await expect(server.connectTo(room, { accountId: 'reviewer', accountToken: 'f'.repeat(64) })).rejects.toThrow();
    expect((await command({ type: 'useItem', definitionId: 'bandage' })).accepted).toBe(true);
  });
  it('rejects malformed join IDs before mutating player state', async () => {
    const room = await server.createRoom('world', {}) as WorldRoom;
    await expect(server.connectTo(room, { accountId: { malformed: true } })).rejects.toThrow();
    expect(room.state.players.size).toBe(0);
  });
  it('restores the whole pack before offline crafting finishes', async () => {
    const { room, command } = await create();
    room.grantForTest('reviewer', 'wood', 15);
    room.grantForTest('reviewer', 'stone', 10);
    room.grantForTest('reviewer', 'metal', 73);
    expect((await command({ type: 'craft', recipeId: 'stone_hatchet', quantity: 1 })).accepted).toBe(true);
    await server.cleanup();
    const restored = await server.createRoom('world', {}) as WorldRoom;
    restored.advanceCraftingForTest(11);
    expect(restored.countForTest('reviewer', 'metal')).toBe(73);
    expect(restored.countForTest('reviewer', 'rock')).toBe(1);
    expect(restored.countForTest('reviewer', 'stone_hatchet')).toBe(1);
  });
  it('moves a restored sleeper inventory into its corpse before reconnect', async () => {
    const { room } = await create();
    room.grantForTest('reviewer', 'metal', 73);
    await server.cleanup();
    const restored = await server.createRoom('world', {}) as WorldRoom;
    restored.damageForTest('reviewer', 1000);
    const id = [...restored.state.corpses.keys()][0]!;
    expect(restored.corpseForTest(id)?.inventory.slots.find((slot) => slot?.definitionId === 'metal')?.quantity).toBe(73);
  });
  it('refuses a carcass hit when multiple outputs compete for the same empty slot', async () => {
    const { room, command } = await create();
    room.clearInventoryForTest('reviewer');
    room.grantForTest('reviewer', 'rock', 23);
    room.spawnCarcass('test-carcass', 'deer', { x: 0, y: 0, z: 0 });
    const id = [...room.state.carcasses.keys()][0]!;
    expect((await command({ type: 'harvestCarcass', carcassId: id })).reasonCode).toBe('no_space');
    expect(room.carcassForTest(id)?.hitsUsed).toBe(0);
    expect(room.countForTest('reviewer', 'raw_meat')).toBe(0);
  });
  it('commits bandage consumption and wound removal before a checkpoint', async () => {
    const { room, command } = await create();
    room.woundForTestSet('reviewer', { ratePerS: 0.5, remainingS: 10 });
    room.checkpoint();
    expect((await command({ type: 'useItem', definitionId: 'bandage' })).accepted).toBe(true);
    room.advanceChannelsForTest(2);
    const disk = new WorldStore(process.env.RWF_DB_PATH!);
    try {
      expect(disk.loadStatusEffects().get('reviewer') ?? []).toEqual([]);
      expect(disk.loadPlayerSlots('reviewer', 24).find((slot) => slot?.definitionId === 'bandage')?.quantity).toBe(1);
    } finally { disk.close(); }
  });
  it('rolls back delivered craft output when persisting queue progress fails', async () => {
    const { room, command } = await create();
    room.grantForTest('reviewer', 'wood', 30);
    room.grantForTest('reviewer', 'stone', 20);
    expect((await command({ type: 'craft', recipeId: 'stone_hatchet', quantity: 2 })).accepted).toBe(true);
    const write = vi.spyOn(WorldStore.prototype, 'saveCraftingEntry').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => room.advanceCraftingForTest(10)).toThrow('disk full');
    write.mockRestore();
    const disk = new WorldStore(process.env.RWF_DB_PATH!);
    try {
      expect(disk.loadPlayerSlots('reviewer', 24).some((slot) => slot?.definitionId === 'stone_hatchet')).toBe(false);
      expect(disk.loadCraftingEntries().get('reviewer')?.completedUnits).toBe(0);
    } finally { disk.close(); }
    // This test invokes the low-level helper, bypassing the live failure guard.
    vi.spyOn(room, 'checkpoint').mockImplementation(() => {});
  });
  it('keeps generated corpse IDs usable with a maximum-length account ID', async () => {
    const accountId = 'a'.repeat(64);
    const { room, client } = await create(accountId);
    room.damageForTest(accountId, 1000);
    const id = [...room.state.corpses.keys()][0]!;
    expect(id.length).toBeLessThanOrEqual(64);
    client.leave();
  });
});
