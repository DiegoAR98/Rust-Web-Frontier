import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { siteKey, WOOD_DECAY, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2636);
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

const CELL = { i: 20, k: 20 };
const CENTRE = { x: 82, y: 0, z: 82 };
const FAR_AWAY = { x: 1000, y: 0, z: 1000 };
const FOUNDATION: PieceSite = { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR: PieceSite = { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null };

const GRACE_MINUTES = WOOD_DECAY.graceHours * 60;

async function builder(room: WorldRoom, accountId: string) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, CENTRE);
  room.grantForTest(accountId, 'wood_foundation', 1);
  room.grantForTest(accountId, 'wood_pillar', 1);
  for (const piece of [
    { definitionId: 'wood_foundation', site: FOUNDATION },
    { definitionId: 'wood_pillar', site: PILLAR },
  ]) {
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
    const result = await client.waitForMessage('commandResult');
    expect(result.accepted, `${piece.definitionId}: ${result.reasonCode}`).toBe(true);
  }
  return client;
}

/** Runs `minutes` of decay ticks without waiting for them in real time. */
function advanceMinutes(room: WorldRoom, minutes: number): void {
  for (let n = 0; n < minutes; n++) {
    room.setTickForTest(room.tickForTest() + 60 * 20);
    room.decayTickForTest();
  }
}

/**
 * GDD section 10: "Every 60 seconds, awake connected owners or authorized
 * builders within 50 m refresh their building cluster's activity timestamp;
 * sleepers do not ... wood structures/deployables use 24+24 ... Activity
 * refresh pauses future decay without healing."
 */
describe('WorldRoom decay (GDD section 10)', () => {
  it('leaves a building alone while its owner is standing in it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builder(room, 'acct_resident');

    advanceMinutes(room, GRACE_MINUTES + 120);

    expect(room.state.buildingPieces.get(siteKey(FOUNDATION))!.health).toBe(2000);

    client.leave();
  });

  it('leaves it alone through the whole grace period once they leave', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builder(room, 'acct_away');
    room.teleportForTest('acct_away', FAR_AWAY);

    advanceMinutes(room, GRACE_MINUTES - 1);

    expect(room.state.buildingPieces.get(siteKey(FOUNDATION))!.health).toBe(2000);

    client.leave();
  });

  it('starts taking health off after the grace period', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builder(room, 'acct_rot');
    room.teleportForTest('acct_rot', FAR_AWAY);

    advanceMinutes(room, GRACE_MINUTES + 10);

    const health = room.state.buildingPieces.get(siteKey(FOUNDATION))!.health;
    expect(health).toBeLessThan(2000);
    // Ten minutes at 2000/1440 per minute.
    expect(health).toBeCloseTo(2000 - (10 * 2000) / 1440, 2);

    client.leave();
  });

  it('decays a combat-immune foundation just the same', async () => {
    // Section 10's immunity is to *combat*; the same row says "Combat immune;
    // decays". A base nobody could ever remove would be permanent litter.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builder(room, 'acct_immortal');
    room.teleportForTest('acct_immortal', FAR_AWAY);

    advanceMinutes(room, GRACE_MINUTES + 5);

    expect(room.state.buildingPieces.get(siteKey(PILLAR))!.health).toBeLessThan(1000);

    client.leave();
  });

  it('stops the rot when the owner comes back, without healing it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builder(room, 'acct_return');
    room.teleportForTest('acct_return', FAR_AWAY);
    advanceMinutes(room, GRACE_MINUTES + 10);
    const damaged = room.state.buildingPieces.get(siteKey(FOUNDATION))!.health;

    room.teleportForTest('acct_return', CENTRE);
    advanceMinutes(room, 200);

    expect(room.state.buildingPieces.get(siteKey(FOUNDATION))!.health).toBe(damaged);

    client.leave();
  });

  it('does not let a sleeper hold a base up', async () => {
    // "sleepers do not" refresh. A disconnected player standing in their base
    // forever would make decay unreachable.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builder(room, 'acct_asleep');
    client.leave();
    // The body stays where it was; only the connection is gone.
    await new Promise((resolve) => setTimeout(resolve, 50));

    advanceMinutes(room, GRACE_MINUTES + 10);

    expect(room.state.buildingPieces.get(siteKey(FOUNDATION))!.health).toBeLessThan(2000);
  });

  it('takes the whole building down when the foundation finally goes', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builder(room, 'acct_ruin');
    room.teleportForTest('acct_ruin', FAR_AWAY);
    // Both pieces one minute from nothing, so the collapse is reachable
    // without simulating a day and a half.
    room.setPieceHealthForTest(FOUNDATION, 1);
    room.setPieceHealthForTest(PILLAR, 1);

    advanceMinutes(room, GRACE_MINUTES + 1);

    expect(room.state.buildingPieces.has(siteKey(FOUNDATION))).toBe(false);
    expect(room.state.buildingPieces.has(siteKey(PILLAR))).toBe(false);

    client.leave();
  });

  it('spills a decayed crate rather than deleting what was in it', async () => {
    // "Nonempty containers still decay and spill loot; there is no immortal
    // full-box exception."
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_cache' });
    await client.waitForMessage('session');
    room.clearInventoryForTest('acct_cache');
    room.teleportForTest('acct_cache', CENTRE);
    room.grantForTest('acct_cache', 'small_crate', 1);
    room.grantForTest('acct_cache', 'wood', 30);
    client.send('command', command({ type: 'placeDeployable', definitionId: 'small_crate', x: 83, y: 0, z: 82 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    const crateId = [...room.state.deployables.keys()][0]!;
    client.send(
      'command',
      command({ type: 'containerInsert', containerId: crateId, definitionId: 'wood', quantity: 30 }),
    );
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    room.teleportForTest('acct_cache', FAR_AWAY);
    // A 250 HP crate sheds 250/1440 a minute, so "nearly gone" still needs a
    // few of them; ten is comfortably past.
    room.setDeployableHealthForTest(crateId, 1);
    advanceMinutes(room, GRACE_MINUTES + 10);

    expect(room.state.deployables.has(crateId)).toBe(false);
    const bags = [...room.state.corpses.keys()];
    expect(bags).toHaveLength(1);
    expect(room.corpseForTest(bags[0]!)!.inventory.slots.filter((s) => s !== null)).toEqual([
      { definitionId: 'wood', quantity: 30 },
    ]);

    client.leave();
  });

  it('lets an authorised builder hold the base up too', async () => {
    // "awake connected owners or authorized builders within 50 m".
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await builder(room, 'acct_boss');
    const hand = await colyseus.connectTo(room, { accountId: 'acct_hand' });
    await hand.waitForMessage('session');
    owner.send('command', command({ type: 'setBuildAccess', targetAccountId: 'acct_hand', granted: true }));
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);
    room.teleportForTest('acct_boss', FAR_AWAY);
    room.teleportForTest('acct_hand', CENTRE);

    advanceMinutes(room, GRACE_MINUTES + 30);

    expect(room.state.buildingPieces.get(siteKey(FOUNDATION))!.health).toBe(2000);

    owner.leave();
    hand.leave();
  });

  it('ignores a stranger standing in it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await builder(room, 'acct_absent');
    const stranger = await colyseus.connectTo(room, { accountId: 'acct_squatter' });
    await stranger.waitForMessage('session');
    room.teleportForTest('acct_absent', FAR_AWAY);
    room.teleportForTest('acct_squatter', CENTRE);

    advanceMinutes(room, GRACE_MINUTES + 10);

    expect(room.state.buildingPieces.get(siteKey(FOUNDATION))!.health).toBeLessThan(2000);

    owner.leave();
    stranger.leave();
  });
});
