import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CELL_SIZE_M, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2639);
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

const CELL = { i: 40, k: 40 };
/** The barrier runs along z = 160, spanning x 160..164. */
const WALL_Z = CELL.k * CELL_SIZE_M;
const NORTH_OF_WALL = { x: 162, y: 0, z: WALL_Z + 1 };
const FOUNDATION: PieceSite = { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_A: PieceSite = { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_B: PieceSite = { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k, axis: null };

/**
 * Straight at the wall: yaw PI faces -z, so forward walks south across it.
 * Sprinting so that isSprintingForTest can report when the intent has landed --
 * a move draws no commandResult to await, and guessing at a delivery time is
 * the bet this suite already refuses to make elsewhere.
 */
const WALK_SOUTH = command({ type: 'move', axisX: 0, axisY: 1, yaw: Math.PI, sprint: true, crouch: false, jump: false });

async function builderAt(room: WorldRoom, accountId: string, form: 'wall' | 'doorway') {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, NORTH_OF_WALL);
  room.grantForTest(accountId, 'wood_foundation', 1);
  room.grantForTest(accountId, 'wood_pillar', 2);
  room.grantForTest(accountId, `wood_${form}`, 1);
  const site: PieceSite = { form, storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };
  for (const piece of [
    { definitionId: 'wood_foundation', site: FOUNDATION },
    { definitionId: 'wood_pillar', site: PILLAR_A },
    { definitionId: 'wood_pillar', site: PILLAR_B },
    { definitionId: `wood_${form}`, site },
  ]) {
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
    const result = await client.waitForMessage('commandResult');
    expect(result.accepted, `${piece.definitionId}: ${result.reasonCode}`).toBe(true);
  }
  return { client, site };
}

/**
 * Walks south for three seconds of simulated time and reports where they ended
 * up. The stepping is synchronous once the intent is live, so the room's own
 * loop cannot expire it midway and leave a player who was simply never pushed
 * looking like one a wall stopped.
 */
async function walkSouth(room: WorldRoom, client: Awaited<ReturnType<typeof colyseus.connectTo>>, accountId: string) {
  // Back to the same metre north of the wall each time, so a second walk in
  // the same test starts where the first one did.
  room.teleportForTest(accountId, NORTH_OF_WALL);
  const startedAt = NORTH_OF_WALL.z;
  client.send('command', WALK_SOUTH);
  for (let i = 0; i < 40 && !room.isSprintingForTest(accountId); i += 1) {
    await room.waitForNextTimestep();
  }
  expect(room.isSprintingForTest(accountId), 'the walk never reached the server').toBe(true);

  for (let i = 0; i < 60; i += 1) room.advanceMovementForTest(1 / 20);
  const endedAt = room.state.players.get(accountId)!.z;
  expect(endedAt, 'the player never actually set off').toBeLessThan(startedAt);
  return endedAt;
}

/**
 * GDD section 5: "All collision meshes are shared in meaning between client
 * prediction and server simulation." Everything M2 built on a wall -- door
 * permissions, the broken-socket lockout, what a satchel is worth -- is
 * bypassed by a player who can simply walk through it.
 */
describe('WorldRoom walking into a structure (GDD section 5)', () => {
  it('stops a player at a wall instead of letting them walk through it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client } = await builderAt(room, 'acct_walker', 'wall');

    // Well short of the three seconds of walking they asked for: the wall is
    // one metre away and holds.
    expect(await walkSouth(room, client, 'acct_walker')).toBeGreaterThan(WALL_Z);

    client.leave();
  });

  it('lets a player walk through an empty doorway', async () => {
    // GDD section 10 makes a doorway a hole until somebody hangs a door in it,
    // which is the difference between a base with a way in and a sealed box.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client } = await builderAt(room, 'acct_doorway', 'doorway');

    expect(await walkSouth(room, client, 'acct_doorway')).toBeLessThan(WALL_Z);

    client.leave();
  });

  it('stops a wolf at the wall too, rather than letting it walk into a sealed base', async () => {
    // T20: "no wall attacks/teleports". Giving players collision without
    // giving animals any would be worse than today, because a wall would then
    // stop the raider and wave the wolf through.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client } = await builderAt(room, 'acct_prey', 'wall');
    // Standing back from the wall, so a wolf stopped at it is still out of
    // biting range and stays in chase rather than settling into attack.
    room.teleportForTest('acct_prey', { x: 162, y: 0, z: WALL_Z + 4 });
    room.spawnCreature('wolf_at_the_wall', 'wolf', { x: 162, y: 0, z: WALL_Z - 3 });

    for (let i = 0; i < 60; i += 1) room.advanceCreaturesForTest(1 / 20);

    const wolf = room.creatureForTest('wolf_at_the_wall')!;
    expect(wolf.mode, 'the wolf never noticed the player').toBe('chase');
    expect(wolf.position.z, 'the wolf walked through the wall').toBeLessThan(WALL_Z);
    expect(wolf.position.z, 'the wolf never closed on the wall').toBeGreaterThan(WALL_Z - 3);

    client.leave();
  });

  it('does not let a wolf bite through the wall it is stopped by', async () => {
    // The other half of T20's "no wall attacks". Stopping the wolf's feet is
    // not enough on its own: a wall is 0.2 m thick and a bite reaches 1.8 m,
    // so an animal pressed against one is still in range of whoever is on the
    // far side of it.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client } = await builderAt(room, 'acct_bitten', 'wall');
    room.teleportForTest('acct_bitten', NORTH_OF_WALL);
    const before = room.vitalsForTest('acct_bitten')!.health;
    room.spawnCreature('wolf_through_wall', 'wolf', { x: 162, y: 0, z: WALL_Z - 3 });

    for (let i = 0; i < 100; i += 1) room.advanceCreaturesForTest(1 / 20);

    expect(room.creatureForTest('wolf_through_wall')!.mode, 'the wolf never got into biting range').toBe('attack');
    expect(room.vitalsForTest('acct_bitten')!.health).toBe(before);

    client.leave();
  });

  it('shuts a player out with a door, and lets them through once it opens', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, site } = await builderAt(room, 'acct_door', 'doorway');
    room.grantForTest('acct_door', 'wood_door', 1);
    client.send('command', command({ type: 'installDoor', definitionId: 'wood_door', ...site }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    expect(await walkSouth(room, client, 'acct_door')).toBeGreaterThan(WALL_Z);

    client.send('command', command({ type: 'operateDoor', open: true, ...site }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    expect(await walkSouth(room, client, 'acct_door')).toBeLessThan(WALL_Z);

    client.leave();
  });
});
