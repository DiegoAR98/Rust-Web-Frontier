import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CALORIE_SPAWN, HEALTH_MAX } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2625);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

let sequence = 0;
function command(action: Record<string, unknown>, sequenceOverride?: number) {
  sequence += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence: sequenceOverride ?? sequence,
    clientTick: 0,
    action,
  };
}

/**
 * GDD section 12: "Death atomically cancels actions, moves backpack, belt,
 * worn gear, loaded weapons and craft escrow into one corpse inventory,
 * removes the live character, and marks the account dead."
 */
describe('WorldRoom death (GDD section 12)', () => {
  it('moves what the player was carrying into a corpse where they fell', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_dead' });
    await client.waitForMessage('session');
    room.clearInventoryForTest('acct_dead');
    room.grantForTest('acct_dead', 'wood', 137);
    room.teleportForTest('acct_dead', { x: 11, y: 0, z: -4 });

    room.damageForTest('acct_dead', HEALTH_MAX);

    expect(room.isDeadForTest('acct_dead')).toBe(true);
    // The live character is gone from the replicated world.
    expect(room.state.players.has('acct_dead')).toBe(false);
    const corpse = room.corpseForTest(room.corpseIdForTest('acct_dead')!)!;
    expect(corpse.position).toEqual({ x: 11, y: 0, z: -4 });
    expect(corpse.inventory.slots.filter((s) => s !== null)).toEqual([
      { definitionId: 'wood', quantity: 137 },
    ]);
    // And it is no longer in the pack -- the whole point of dying.
    expect(room.countForTest('acct_dead', 'wood')).toBe(0);

    client.leave();
  });

  it('tells the dying player which body is theirs', async () => {
    // GDD section 12 owes a dead player "a death recap and respawn options";
    // neither is possible if they are never told they died.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_told' });
    await client.waitForMessage('session');

    room.damageForTest('acct_told', HEALTH_MAX);
    const death = await client.waitForMessage('death');

    expect(death.corpseId).toBe(room.corpseIdForTest('acct_told'));

    client.leave();
  });

  it('puts the corpse in the shared world so others can find it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_seen' });
    await client.waitForMessage('session');
    room.teleportForTest('acct_seen', { x: 3, y: 0, z: 3 });

    room.damageForTest('acct_seen', HEALTH_MAX);

    const corpses = [...room.state.corpses.entries()];
    expect(corpses).toHaveLength(1);
    expect(corpses[0]![1].x).toBe(3);
    expect(corpses[0]![1].ownerAccountId).toBe('acct_seen');

    client.leave();
  });

  it('returns escrowed craft inputs to the corpse instead of destroying them', async () => {
    // GDD section 12: craft escrow goes into the corpse too, and section 8:
    // "overflow cannot be lost due to queued crafting".
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_smith' });
    await client.waitForMessage('session');
    room.clearInventoryForTest('acct_smith');
    room.grantForTest('acct_smith', 'wood', 15);
    room.grantForTest('acct_smith', 'stone', 10);

    client.send('command', command({ type: 'craft', recipeId: 'stone_hatchet', quantity: 1 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    // The inputs are escrowed: out of the pack, not yet an output.
    expect(room.countForTest('acct_smith', 'wood')).toBe(0);

    room.damageForTest('acct_smith', HEALTH_MAX);

    expect(room.craftingEntryForTest('acct_smith')).toBeUndefined();
    const corpse = room.corpseForTest(room.corpseIdForTest('acct_smith')!)!;
    const held = (id: string) =>
      corpse.inventory.slots.reduce((sum, s) => (s?.definitionId === id ? sum + s.quantity : sum), 0);
    expect(held('wood')).toBe(15);
    expect(held('stone')).toBe(10);

    client.leave();
  });

  it('cancels a use channel on death rather than finishing it on a corpse', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_busy' });
    await client.waitForMessage('session');
    room.setVitalsForTest('acct_busy', { calories: 1000, health: 100, exposure: 0 });

    client.send('command', command({ type: 'useItem', definitionId: 'bandage' }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.channelForTest('acct_busy')).toBeDefined();

    room.damageForTest('acct_busy', HEALTH_MAX);

    expect(room.channelForTest('acct_busy')).toBeUndefined();

    client.leave();
  });

  it('refuses a dead player everything except respawning', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_death', 'wood', { x: 0, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_ghost' });
    await client.waitForMessage('session');

    room.damageForTest('acct_ghost', HEALTH_MAX);

    client.send('command', command({ type: 'takeItem', itemInstanceId: 'item_death' }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('dead');
    expect(room.state.items.get('item_death')!.claimedBy).toBe('');

    client.leave();
  });

  it('refuses to respawn a player who is still alive', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_alive' });
    await client.waitForMessage('session');

    client.send('command', command({ type: 'respawn' }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_dead');

    client.leave();
  });
});

describe('WorldRoom respawn (GDD section 12)', () => {
  it('returns a fresh body with the starter kit, reset stats and no wounds', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_again' });
    await client.waitForMessage('session');
    room.setVitalsForTest('acct_again', { calories: 200, health: 100, exposure: 400 });
    room.woundForTestSet('acct_again', { ratePerS: 0.5, remainingS: 9 });
    room.poisonForTestSet('acct_again', { ratePerS: 0.5, remainingS: 19 });
    room.damageForTest('acct_again', HEALTH_MAX);

    client.send('command', command({ type: 'respawn' }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.isDeadForTest('acct_again')).toBe(false);
    expect(room.state.players.has('acct_again')).toBe(true);
    expect(room.vitalsForTest('acct_again')).toEqual({
      calories: CALORIE_SPAWN,
      health: HEALTH_MAX,
      exposure: 0,
    });
    expect(room.woundForTest('acct_again')).toBeNull();
    expect(room.poisonForTest('acct_again')).toBeNull();
    // GDD section 5's kit, granted again because respawn is a fresh start.
    expect(room.countForTest('acct_again', 'rock')).toBe(1);
    expect(room.countForTest('acct_again', 'bandage')).toBe(2);

    client.leave();
  });

  it('stands the new body on an authored anchor, not where the old one fell', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_moved' });
    await client.waitForMessage('session');
    room.teleportForTest('acct_moved', { x: 400, y: 0, z: 400 });
    room.damageForTest('acct_moved', HEALTH_MAX);

    client.send('command', command({ type: 'respawn' }));
    await client.waitForMessage('commandResult');

    const player = room.state.players.get('acct_moved')!;
    expect({ x: player.x, z: player.z }).not.toEqual({ x: 400, z: 400 });
    expect(room.respawnAnchorsForTest().some((a) => a.position.x === player.x && a.position.z === player.z)).toBe(
      true,
    );

    client.leave();
  });

  it('does not hand out a second kit when the respawn command is replayed', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_replay' });
    await client.waitForMessage('session');
    room.damageForTest('acct_replay', HEALTH_MAX);

    client.send('command', command({ type: 'respawn' }, 900));
    const first = await client.waitForMessage('commandResult');
    client.send('command', command({ type: 'respawn' }, 900));
    const replay = await client.waitForMessage('commandResult');

    expect(first.accepted).toBe(true);
    expect(replay).toEqual(first);
    expect(room.countForTest('acct_replay', 'bandage')).toBe(2);

    client.leave();
  });
});

/** GDD section 8: "player death bags 30 minutes; the timer never refreshes on inspection." */
describe('WorldRoom corpse looting (T13, GDD section 8)', () => {
  it('hands the whole pack to whoever reaches the corpse first', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const victim = await colyseus.connectTo(room, { accountId: 'acct_victim' });
    await victim.waitForMessage('session');
    room.clearInventoryForTest('acct_victim');
    room.grantForTest('acct_victim', 'wood', 60);
    room.damageForTest('acct_victim', HEALTH_MAX);
    const corpseId = room.corpseIdForTest('acct_victim')!;

    const looter = await colyseus.connectTo(room, { accountId: 'acct_looter' });
    await looter.waitForMessage('session');
    room.clearInventoryForTest('acct_looter');

    looter.send('command', command({ type: 'corpseTake', corpseId }));
    const result = await looter.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.countForTest('acct_looter', 'wood')).toBe(60);
    // An emptied corpse is gone from the world rather than left as a prop.
    expect(room.state.corpses.has(corpseId)).toBe(false);

    victim.leave();
    looter.leave();
  });

  it('refuses a corpse the looter cannot reach and takes nothing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const victim = await colyseus.connectTo(room, { accountId: 'acct_far' });
    await victim.waitForMessage('session');
    room.grantForTest('acct_far', 'wood', 10);
    room.teleportForTest('acct_far', { x: 200, y: 0, z: 0 });
    room.damageForTest('acct_far', HEALTH_MAX);

    const looter = await colyseus.connectTo(room, { accountId: 'acct_nearby' });
    await looter.waitForMessage('session');
    room.clearInventoryForTest('acct_nearby');

    looter.send('command', command({ type: 'corpseTake', corpseId: room.corpseIdForTest('acct_far')! }));
    const result = await looter.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.countForTest('acct_nearby', 'wood')).toBe(0);
    expect(room.state.corpses.has(room.corpseIdForTest('acct_far')!)).toBe(true);

    victim.leave();
    looter.leave();
  });

  it('leaves behind whatever the looter had no room for', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const victim = await colyseus.connectTo(room, { accountId: 'acct_rich' });
    await victim.waitForMessage('session');
    room.clearInventoryForTest('acct_rich');
    room.grantForTest('acct_rich', 'stone_hatchet', 20);
    room.damageForTest('acct_rich', HEALTH_MAX);
    const corpseId = room.corpseIdForTest('acct_rich')!;

    const looter = await colyseus.connectTo(room, { accountId: 'acct_small' });
    await looter.waitForMessage('session');
    // Hatchets do not stack, so a pack already holding 20 of them has four
    // free slots for the corpse's twenty.
    room.clearInventoryForTest('acct_small');
    room.grantForTest('acct_small', 'stone_hatchet', 20);

    looter.send('command', command({ type: 'corpseTake', corpseId }));
    const result = await looter.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.countForTest('acct_small', 'stone_hatchet')).toBe(24);
    // The other sixteen are still on the body, not deleted.
    const corpse = room.corpseForTest(corpseId)!;
    expect(corpse.inventory.slots.filter((s) => s !== null)).toHaveLength(16);

    victim.leave();
    looter.leave();
  });

  it('removes a corpse thirty minutes after the death', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_stale' });
    await client.waitForMessage('session');
    room.grantForTest('acct_stale', 'wood', 5);
    room.damageForTest('acct_stale', HEALTH_MAX);
    const corpseId = room.corpseIdForTest('acct_stale')!;

    room.setTickForTest(room.tickForTest() + 30 * 60 * 20 - 1);
    room.expireCorpsesForTest();
    expect(room.state.corpses.has(corpseId)).toBe(true);

    room.setTickForTest(room.tickForTest() + 2);
    room.expireCorpsesForTest();
    expect(room.state.corpses.has(corpseId)).toBe(false);

    client.leave();
  });
});
