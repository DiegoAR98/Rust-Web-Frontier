import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { siteKey, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2633);
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

const CELL = { i: 10, k: 10 };
const INSIDE = { x: 42, y: 0, z: 42 };

const FOUNDATION: PieceSite = { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_A: PieceSite = { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_B: PieceSite = { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k, axis: null };
const WALL: PieceSite = { form: 'wall', storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };

const attack = (site: PieceSite, door = false) => command({ type: 'attackStructure', door, ...site });

async function cabinWall(room: WorldRoom, accountId: string) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, INSIDE);
  room.grantForTest(accountId, 'wood_foundation', 1);
  room.grantForTest(accountId, 'wood_pillar', 2);
  room.grantForTest(accountId, 'wood_wall', 1);
  for (const piece of [
    { definitionId: 'wood_foundation', site: FOUNDATION },
    { definitionId: 'wood_pillar', site: PILLAR_A },
    { definitionId: 'wood_pillar', site: PILLAR_B },
    { definitionId: 'wood_wall', site: WALL },
  ]) {
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
    const result = await client.waitForMessage('commandResult');
    expect(result.accepted, `${piece.definitionId}: ${result.reasonCode}`).toBe(true);
  }
  return client;
}

/**
 * GDD section 10: "Foundation and pillar combat immunity is intentional. Other
 * pieces can be damaged, including ceilings; there is no weak-side damage."
 */
describe('WorldRoom damaging a structure (GDD section 10)', () => {
  it('chips a wall with a swing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_hammer');

    client.send('command', attack(WALL));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    // CONTENT section 7's wood wall is 1000 HP; section 5's rock hits for 10.
    expect(room.state.buildingPieces.get(siteKey(WALL))!.health).toBe(990);

    client.leave();
  });

  it('refuses to damage a foundation or a pillar at all', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_futile');

    for (const site of [FOUNDATION, PILLAR_A]) {
      room.clearSwingCooldownForTest('acct_futile');
      client.send('command', attack(site));
      const result = await client.waitForMessage('commandResult');
      expect(result.accepted, `${site.form} should be immune`).toBe(false);
      expect(result.reasonCode).toBe('forbidden');
      expect(room.state.buildingPieces.get(siteKey(site))!.health).toBeGreaterThan(0);
    }

    client.leave();
  });

  it('brings the wall down when the last of its health goes', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_breaker');
    // One swing from destroyed, rather than a hundred of them.
    room.setPieceHealthForTest(WALL, 10);

    client.send('command', attack(WALL));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    expect(room.state.buildingPieces.has(siteKey(WALL))).toBe(false);
    // The pillars that held it are untouched.
    expect(room.state.buildingPieces.has(siteKey(PILLAR_A))).toBe(true);

    client.leave();
  });

  it('refuses a swing at a piece that is no longer there', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_air');
    room.setPieceHealthForTest(WALL, 10);
    client.send('command', attack(WALL));
    await client.waitForMessage('commandResult');
    room.clearSwingCooldownForTest('acct_air');

    client.send('command', attack(WALL));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');

    client.leave();
  });

  it('holds a swing at a structure to the same rate as any other', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_fast');

    client.send('command', attack(WALL));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    client.send('command', attack(WALL));
    const second = await client.waitForMessage('commandResult');

    expect(second.accepted).toBe(false);
    expect(second.reasonCode).toBe('rate_limited');
    expect(room.state.buildingPieces.get(siteKey(WALL))!.health).toBe(990);

    client.leave();
  });
});

/** GDD section 10's cascade, driven by a real destruction rather than a helper. */
describe('WorldRoom collapsing a structure (GDD section 10)', () => {
  it('takes the wall down with the pillar that held it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_collapse');
    // Pillars are combat immune, so only decay or demolition removes one.
    // This is that removal, exercised directly.
    room.removePieceForTest(PILLAR_A);

    expect(room.state.buildingPieces.has(siteKey(PILLAR_A))).toBe(false);
    expect(room.state.buildingPieces.has(siteKey(WALL))).toBe(false);
    // The other pillar and the foundation still stand.
    expect(room.state.buildingPieces.has(siteKey(PILLAR_B))).toBe(true);
    expect(room.state.buildingPieces.has(siteKey(FOUNDATION))).toBe(true);

    client.leave();
  });

  it('lets someone rebuild on the site a collapse cleared', async () => {
    // The structural links have to be cleaned up with the pieces; a stale
    // link would keep a fallen building's ownership alive over empty ground.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_rebuild');
    room.removePieceForTest(PILLAR_A);
    room.grantForTest('acct_rebuild', 'wood_pillar', 1);

    client.send('command', command({ type: 'placeBuildingPiece', definitionId: 'wood_pillar', ...PILLAR_A }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);

    client.leave();
  });
});

/**
 * GDD section 11: "A building-wide raid lock lasts 60 seconds after any
 * hostile damage and blocks repair, tier swaps, demolition and new attached
 * construction. Owner damage also starts the lock."
 */
describe('WorldRoom raid lock (GDD section 11)', () => {
  it('blocks new attached construction for sixty seconds after a hit', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_locked');
    room.grantForTest('acct_locked', 'wood_ceiling', 1);
    room.grantForTest('acct_locked', 'wood_pillar', 2);

    client.send('command', attack(WALL));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    client.send('command', command({ type: 'placeBuildingPiece', definitionId: 'wood_pillar', form: 'pillar', storey: 0, i: CELL.i, k: CELL.k + 1, axis: null }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('raid_locked');

    client.leave();
  });

  it('starts the lock even when the owner is the one hitting it', async () => {
    // "Owner damage also starts the lock" -- otherwise a defender could hit
    // their own wall to prove it is theirs and keep building through a raid.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_self');

    client.send('command', attack(WALL));
    await client.waitForMessage('commandResult');

    expect(room.raidLockedForTest(FOUNDATION)).toBe(true);

    client.leave();
  });

  it('lets construction resume once the sixty seconds are up', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_patient');
    room.grantForTest('acct_patient', 'wood_pillar', 1);
    client.send('command', attack(WALL));
    await client.waitForMessage('commandResult');

    room.setTickForTest(room.tickForTest() + 60 * 20 + 1);

    client.send('command', command({ type: 'placeBuildingPiece', definitionId: 'wood_pillar', form: 'pillar', storey: 0, i: CELL.i, k: CELL.k + 1, axis: null }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    expect(room.raidLockedForTest(FOUNDATION)).toBe(false);

    client.leave();
  });

  it('leaves an untouched building next door unlocked', async () => {
    // "building-wide", not world-wide: a raid on one base must not freeze
    // everyone else's construction.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await cabinWall(room, 'acct_neighbour');
    const far: PieceSite = { form: 'foundation', storey: 0, i: CELL.i + 3, k: CELL.k, axis: null };
    room.grantForTest('acct_neighbour', 'wood_foundation', 1);
    room.teleportForTest('acct_neighbour', { x: (CELL.i + 3.5) * 4, y: 0, z: 42 });
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: 'wood_foundation', ...far }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    room.teleportForTest('acct_neighbour', INSIDE);
    client.send('command', attack(WALL));
    await client.waitForMessage('commandResult');

    expect(room.raidLockedForTest(FOUNDATION)).toBe(true);
    expect(room.raidLockedForTest(far)).toBe(false);

    client.leave();
  });
});
