import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { HEALTH_SPAWN } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2621);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

/**
 * Steps creatures the way the room does, one simulation tick at a time. One
 * big step is not equivalent: a wolf 10 m away closes the distance and bites
 * within the same 3 seconds only if it gets to re-check its range each tick.
 */
function advance(room: WorldRoom, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) room.advanceCreaturesForTest(0.05);
}

let sequence = 0;

/** Players spawn at the origin; this is inside a wolf's 25 m notice range. */
const NEARBY = { x: 10, y: 0, z: 0 };

/**
 * GDD section 7: predators "detect by sight, proximity and loud noise" and
 * close to melee; CONTENT section 4 gives the wolf 15 damage per 1.5 s.
 */
describe('WorldRoom wildlife (T20, GDD section 7)', () => {
  it('sends a wolf after a player and bites them', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCreature('wolf_t', 'wolf', NEARBY);
    const client = await colyseus.connectTo(room, { accountId: 'acct_bit' });
    await client.waitForMessage('session');
    room.setBleedRollForTest(() => 1); // never bleed: isolate the bite itself

    advance(room, 3); // 10 m at 6 m/s, then close to melee

    expect(room.creatureForTest('wolf_t')!.mode).toBe('attack');
    expect(room.vitalsForTest('acct_bit')!.health).toBeLessThan(HEALTH_SPAWN);

    client.leave();
  });

  it('bites for exactly the damage CONTENT gives a wolf', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_dmg' });
    await client.waitForMessage('session');
    room.setBleedRollForTest(() => 1);
    // Spawned only once the roll is forced: the room's own tick would
    // otherwise land the first bite under the real random roll.
    room.spawnCreature('wolf_t', 'wolf', { x: 1, y: 0, z: 0 }); // already in reach

    room.advanceCreaturesForTest(0.05);

    // A second bite cannot land for another 1.5 s, so exactly one has, whether
    // it was this step or the room's own tick a moment earlier.
    expect(room.vitalsForTest('acct_dmg')!.health).toBeCloseTo(HEALTH_SPAWN - 15, 5);

    client.leave();
  });

  it('keeps a deer away from the player instead of attacking', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCreature('deer_t', 'deer', { x: 5, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_deer' });
    await client.waitForMessage('session');

    const before = room.creatureForTest('deer_t')!.position.x;
    room.advanceCreaturesForTest(1);

    expect(room.creatureForTest('deer_t')!.position.x).toBeGreaterThan(before);
    expect(room.vitalsForTest('acct_deer')!.health).toBe(HEALTH_SPAWN);

    client.leave();
  });

  it('replicates creatures to a real client, not just the server', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCreature('wolf_t', 'wolf', NEARBY);
    const client = await colyseus.connectTo(room, { accountId: 'acct_see' });
    await client.waitForMessage('session');

    await client.waitForNextPatch();

    expect(client.state.creatures.get('wolf_t')!.kind).toBe('wolf');

    client.leave();
  });
});

/**
 * GDD section 6: "Melee and animal bites have 20% for 0.5 HP/s for 10
 * seconds... Repeat wounds take the maximum rate and latest expiry."
 */
describe('WorldRoom bleeding (T08, GDD section 6)', () => {
  it('opens a bleed wound when the bite rolls one, and keeps costing health', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_bleed' });
    await client.waitForMessage('session');
    room.setBleedRollForTest(() => 0); // always inside the 20% chance
    // Spawned only once the roll is forced: the room's own tick would
    // otherwise land the first bite under the real random roll.
    room.spawnCreature('wolf_t', 'wolf', { x: 1, y: 0, z: 0 });

    room.advanceCreaturesForTest(0.05); // one bite
    const wound = room.woundForTest('acct_bleed')!;
    expect(wound.ratePerS).toBe(0.5);
    // The room's own tick bleeds it a little between the bite and this line.
    expect(wound.remainingS).toBeGreaterThan(9);

    const afterBite = room.vitalsForTest('acct_bleed')!.health;
    room.advanceBleedForTest(4);

    // 0.5 HP/s for four seconds, on top of the bite itself. Bounded rather
    // than exact: the room's own tick keeps bleeding the player during the
    // wall-clock time this assertion takes.
    const bled = afterBite - room.vitalsForTest('acct_bleed')!.health;
    expect(bled).toBeGreaterThanOrEqual(2);
    expect(bled).toBeLessThan(2.5);

    client.leave();
  });

  it('leaves no wound when the roll misses', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_dry' });
    await client.waitForMessage('session');
    room.setBleedRollForTest(() => 0.9); // outside the 20%
    // Spawned only once the roll is forced: the room's own tick would
    // otherwise land the first bite under the real random roll.
    room.spawnCreature('wolf_t', 'wolf', { x: 1, y: 0, z: 0 });

    room.advanceCreaturesForTest(0.05);

    expect(room.woundForTest('acct_dry')).toBeNull();

    client.leave();
  });

  it('does not stack two bites into double the bleed', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_stack' });
    await client.waitForMessage('session');
    room.setBleedRollForTest(() => 0);
    // Spawned only once the roll is forced: the room's own tick would
    // otherwise land the first bite under the real random roll.
    room.spawnCreature('wolf_t', 'wolf', { x: 1, y: 0, z: 0 });

    advance(room, 2); // long enough for two bites

    // GDD section 6: "Repeat wounds take the maximum rate and latest expiry."
    expect(room.woundForTest('acct_stack')!.ratePerS).toBe(0.5);
    expect(room.woundForTest('acct_stack')!.remainingS).toBeLessThanOrEqual(10);

    client.leave();
  });

  it('stops bleeding when the wound runs out', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_clot' });
    await client.waitForMessage('session');
    room.setBleedRollForTest(() => 0);
    // Spawned only once the roll is forced: the room's own tick would
    // otherwise land the first bite under the real random roll.
    room.spawnCreature('wolf_t', 'wolf', { x: 1, y: 0, z: 0 });

    room.advanceCreaturesForTest(0.05);
    room.advanceBleedForTest(11);

    expect(room.woundForTest('acct_clot')).toBeNull();

    client.leave();
  });
});

function attack(creatureId: string) {
  sequence += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence,
    clientTick: 0,
    action: { type: 'attackCreature', creatureId },
  };
}

function harvest(carcassId: string) {
  sequence += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence,
    clientTick: 0,
    action: { type: 'harvestCarcass', carcassId },
  };
}

/**
 * T20: "Animals detect, chase, lose path and die; two players harvest final
 * hit -> no wall attacks/teleports; finite harvest paid once; wildlife budgets
 * maintained." GDD section 7: "Harvesting consumes the pool over four valid
 * tool hits; each hit grants one quarter with integer remainders assigned to
 * the final hit."
 */
describe('WorldRoom carcasses (T20, GDD section 7)', () => {
  it('leaves a carcass where the animal died, and removes the animal', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCreature('deer_t', 'deer', { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_hunt' });
    await client.waitForMessage('session');

    // A deer has 60 HP and a rock does 10, so six swings.
    for (let i = 0; i < 6; i++) {
      client.send('command', attack('deer_t'));
      await client.waitForMessage('commandResult');
      room.clearSwingCooldownForTest('acct_hunt');
    }

    expect(room.creatureForTest('deer_t')).toBeUndefined();
    expect(room.carcassForTest('deer_t')).toBeDefined();
    expect(room.carcassForTest('deer_t')!.hitsUsed).toBe(0);

    client.leave();
  });

  it('pays a deer out over exactly four hits and no more', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCarcass('carcass_t', 'deer', { x: 1, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_skin' });
    await client.waitForMessage('session');

    for (let i = 0; i < 5; i++) {
      client.send('command', harvest('carcass_t'));
      await client.waitForMessage('commandResult');
      room.clearSwingCooldownForTest('acct_skin');
    }

    // CONTENT section 4's deer pool, paid once in total.
    expect(room.countForTest('acct_skin', 'raw_meat')).toBe(8);
    expect(room.countForTest('acct_skin', 'cloth')).toBe(8);
    expect(room.countForTest('acct_skin', 'hide')).toBe(4);
    expect(room.countForTest('acct_skin', 'fat')).toBe(4);
    // Spent pools do not linger for a fifth hit to find.
    expect(room.carcassForTest('carcass_t')).toBeUndefined();

    client.leave();
  });

  it('cannot pay the same pool twice to two competing players', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCarcass('carcass_t', 'deer', { x: 1, y: 0, z: 0 });
    const a = await colyseus.connectTo(room, { accountId: 'acct_x' });
    await a.waitForMessage('session');
    const b = await colyseus.connectTo(room, { accountId: 'acct_y' });
    await b.waitForMessage('session');

    for (let i = 0; i < 4; i++) {
      const client = i % 2 === 0 ? a : b;
      const accountId = i % 2 === 0 ? 'acct_x' : 'acct_y';
      client.send('command', harvest('carcass_t'));
      await client.waitForMessage('commandResult');
      room.clearSwingCooldownForTest(accountId);
    }

    const meat = room.countForTest('acct_x', 'raw_meat') + room.countForTest('acct_y', 'raw_meat');
    expect(meat).toBe(8); // the pool, split between them, never doubled

    a.leave();
    b.leave();
  });

  it('makes a hurt deer run even though the player is no threat by distance', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCreature('deer_t', 'deer', { x: 2, y: 0, z: 0 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_spook' });
    await client.waitForMessage('session');

    client.send('command', attack('deer_t'));
    await client.waitForMessage('commandResult');

    // GDD section 7: "Prey flee when approached or hurt."
    expect(room.creatureForTest('deer_t')!.alarmS).toBeGreaterThan(0);
    expect(room.creatureForTest('deer_t')!.health).toBe(50);

    client.leave();
  });

  it('refuses a swing at an animal across the map', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCreature('deer_far', 'deer', { x: 1000, y: 0, z: 1000 });
    const client = await colyseus.connectTo(room, { accountId: 'acct_sniper' });
    await client.waitForMessage('session');

    client.send('command', attack('deer_far'));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.creatureForTest('deer_far')!.health).toBe(60);

    client.leave();
  });

  it('clears a carcass nobody came back for', async () => {
    // GDD section 7: "Unharvested carcasses expire after 10 online minutes."
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnCarcass('carcass_t', 'deer', { x: 1, y: 0, z: 0 });

    room.setTickForTest(room.tickForTest() + 10 * 60 * 20 + 1);
    room.expireCarcassesForTest();

    expect(room.carcassForTest('carcass_t')).toBeUndefined();
  });
});
