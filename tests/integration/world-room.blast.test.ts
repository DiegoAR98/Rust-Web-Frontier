import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { EXPLOSIVES, siteKey, worldPositionOf, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2637);
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
 * Cell (30,30) spans x 120..124, z 120..124. Two walls: the south one on its
 * z = 120 edge, the north one on z = 124, with the cell between them.
 */
const CELL = { i: 30, k: 30 };
const INSIDE = { x: 122, y: 0, z: 122 };
const FOUNDATION: PieceSite = { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const SOUTH_WALL: PieceSite = { form: 'wall', storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };
const NORTH_WALL: PieceSite = { form: 'wall', storey: 0, i: CELL.i, k: CELL.k + 1, axis: 'x' };
const PILLAR_A: PieceSite = { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_B: PieceSite = { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k, axis: null };
const PILLAR_C: PieceSite = { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k + 1, axis: null };
const PILLAR_D: PieceSite = { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k + 1, axis: null };

async function twoWalls(room: WorldRoom, accountId: string) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, INSIDE);
  room.grantForTest(accountId, 'wood_foundation', 1);
  room.grantForTest(accountId, 'wood_pillar', 4);
  room.grantForTest(accountId, 'wood_wall', 2);
  for (const piece of [
    { definitionId: 'wood_foundation', site: FOUNDATION },
    { definitionId: 'wood_pillar', site: PILLAR_A },
    { definitionId: 'wood_pillar', site: PILLAR_B },
    { definitionId: 'wood_pillar', site: PILLAR_C },
    { definitionId: 'wood_pillar', site: PILLAR_D },
    { definitionId: 'wood_wall', site: SOUTH_WALL },
    { definitionId: 'wood_wall', site: NORTH_WALL },
  ]) {
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
    const result = await client.waitForMessage('commandResult');
    expect(result.accepted, `${piece.definitionId}: ${result.reasonCode}`).toBe(true);
  }
  return client;
}

const healthOf = (room: WorldRoom, site: PieceSite) => room.state.buildingPieces.get(siteKey(site))?.health;

/**
 * T12: "Blast full-HP wood door, wood wall, metal door and metal wall ->
 * Minimum contact satchels 1/2/2/4; immune foundation/pillar unaffected; no
 * through-barrier splash."
 *
 * The satchel item and its crafting chain are M3 (PRODUCTION section 1 puts
 * "satchel raid" there); the blast maths and the occlusion rule are structural
 * geometry and belong with the building work, so they are driven here through
 * a test-only detonation rather than a thrown item.
 */
describe('WorldRoom explosions against structures (T12, GDD section 11)', () => {
  it('breaks a full-health wood wall with exactly two contact satchels', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await twoWalls(room, 'acct_blast');
    const at = worldPositionOf(SOUTH_WALL);

    room.detonateForTest(at, 'satchel');
    // 1000 HP wall, 600 contact: one satchel is not enough.
    expect(healthOf(room, SOUTH_WALL)).toBe(400);

    room.detonateForTest(at, 'satchel');
    expect(room.state.buildingPieces.has(siteKey(SOUTH_WALL))).toBe(false);

    client.leave();
  });

  it('leaves the foundation and pillars completely untouched', async () => {
    // CONTENT section 8: "Supports marked combat immune ignore these and all
    // explosions."
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await twoWalls(room, 'acct_immune');

    room.detonateForTest(worldPositionOf(PILLAR_A), 'satchel');

    expect(healthOf(room, FOUNDATION)).toBe(2000);
    expect(healthOf(room, PILLAR_A)).toBe(1000);
    expect(healthOf(room, PILLAR_B)).toBe(1000);

    client.leave();
  });

  it('does not splash through the wall it went off against', async () => {
    // "One intact structural barrier occludes further structural blast
    // damage" -- otherwise one charge on the outside wall damages everything
    // inside the room as well.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await twoWalls(room, 'acct_shield');
    // A crate inside the room, well within the 3 m splash of the south wall.
    room.teleportForTest('acct_shield', { x: 122, y: 0, z: 121 });
    room.grantForTest('acct_shield', 'small_crate', 1);
    client.send('command', command({ type: 'placeDeployable', definitionId: 'small_crate', x: 122, y: 0, z: 121.5 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    const crateId = [...room.state.deployables.keys()][0]!;

    // Detonate just outside the south wall.
    room.detonateForTest({ x: 122, y: 0, z: 119.5 }, 'satchel');

    // The wall took it; the crate behind it did not.
    expect(healthOf(room, SOUTH_WALL)).toBeLessThan(1000);
    expect(room.state.deployables.get(crateId)!.health).toBe(250);

    client.leave();
  });

  it('resolves what blocks what from the world before the blast', async () => {
    // "resolve the blocking set from the pre-explosion world so a single
    // explosion cannot destroy a door and then damage behind it
    // retroactively". The south wall is one hit from gone; it must still
    // shield the far wall in the same detonation that finishes it.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await twoWalls(room, 'acct_chain');
    room.setPieceHealthForTest(SOUTH_WALL, 1);

    room.detonateForTest(worldPositionOf(SOUTH_WALL), 'satchel');

    expect(room.state.buildingPieces.has(siteKey(SOUTH_WALL))).toBe(false);
    // The north wall is 4 m away, outside the satchel's 3 m splash anyway --
    // what this pins is that it took nothing at all, not that it survived.
    expect(healthOf(room, NORTH_WALL)).toBe(1000);

    client.leave();
  });

  it('scales the splash down with distance', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await twoWalls(room, 'acct_fade');
    const at = worldPositionOf(SOUTH_WALL);

    // Half the satchel's splash radius away, on the open side, with nothing
    // between it and the wall.
    room.detonateForTest({ x: at.x, y: at.y, z: at.z - EXPLOSIVES.satchel.splashRadiusM / 2 }, 'satchel');

    expect(healthOf(room, SOUTH_WALL)).toBeCloseTo(1000 - 300, 0);

    client.leave();
  });

  it('does nothing at all beyond the splash radius', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await twoWalls(room, 'acct_miss');
    const at = worldPositionOf(SOUTH_WALL);

    room.detonateForTest({ x: at.x, y: at.y, z: at.z - EXPLOSIVES.satchel.splashRadiusM - 1 }, 'satchel');

    expect(healthOf(room, SOUTH_WALL)).toBe(1000);

    client.leave();
  });
});

/** CONTENT section 8: "Tools deal their base melee damage x0.5 to wood". */
describe('WorldRoom melee against a structure (CONTENT section 8)', () => {
  it('takes half a rock s damage off a wooden wall, not all of it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await twoWalls(room, 'acct_chip');
    room.teleportForTest('acct_chip', { x: 122, y: 0, z: 121 });

    client.send('command', command({ type: 'attackStructure', door: false, ...SOUTH_WALL }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    // The rock's 10, halved against wood: the rule is what makes explosives
    // the way into a base rather than patience.
    expect(healthOf(room, SOUTH_WALL)).toBe(995);

    client.leave();
  });
});
