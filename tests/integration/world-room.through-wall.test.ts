import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CELL_SIZE_M, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2632);
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
 * Cell (10,10) spans x 40..44 and z 40..44. The wall goes on its z = 40 edge,
 * the crate sits just inside at z = 41, and the raider stands just outside at
 * z = 39 -- close enough to reach if nothing were in the way.
 */
const CELL = { i: 10, k: 10 };
const INSIDE = { x: 42, y: 0, z: 41 };
const OUTSIDE = { x: 42, y: 0, z: 39 };
const WALL: PieceSite = { form: 'wall', storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };
const DOORWAY: PieceSite = { ...WALL, form: 'doorway' };

async function at(room: WorldRoom, accountId: string, position: { x: number; y: number; z: number }) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, position);
  return client;
}

/** Foundation, two pillars and one piece on the cell's z = 40 edge. */
async function wallUp(room: WorldRoom, accountId: string, frame: PieceSite, definitionId: string) {
  const client = await at(room, accountId, { x: 42, y: 0, z: 42 });
  room.grantForTest(accountId, 'wood_foundation', 1);
  room.grantForTest(accountId, 'wood_pillar', 2);
  room.grantForTest(accountId, definitionId, 1);
  const pieces = [
    { definitionId: 'wood_foundation', site: { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null } },
    { definitionId: 'wood_pillar', site: { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null } },
    { definitionId: 'wood_pillar', site: { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k, axis: null } },
    { definitionId, site: frame },
  ];
  for (const piece of pieces) {
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
    const result = await client.waitForMessage('commandResult');
    expect(result.accepted, `${piece.definitionId}: ${result.reasonCode}`).toBe(true);
  }
  return client;
}

/** Puts a stocked crate just inside the wall, owned by the builder. */
async function crateInside(room: WorldRoom, client: Awaited<ReturnType<typeof at>>, accountId: string) {
  room.teleportForTest(accountId, INSIDE);
  room.grantForTest(accountId, 'small_crate', 1);
  room.grantForTest(accountId, 'wood', 50);
  client.send('command', command({ type: 'placeDeployable', definitionId: 'small_crate', ...INSIDE }));
  expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
  const crateId = [...room.state.deployables.keys()][0]!;
  client.send(
    'command',
    command({ type: 'containerInsert', containerId: crateId, definitionId: 'wood', quantity: 50 }),
  );
  expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
  return crateId;
}

/**
 * T11: "through-wall loot denied; accessible open-box loot allowed". GDD
 * section 8: "Boxes are not magically private. Any person who reaches a box
 * can open it; doors supply security" -- so the wall has to be what stops
 * them reaching, or a base's walls are decoration.
 */
describe('WorldRoom reaching through a wall (T11)', () => {
  it('denies a raider the crate on the other side of a wall', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_walled', WALL, 'wood_wall');
    const crateId = await crateInside(room, owner, 'acct_walled');

    const raider = await at(room, 'acct_outside', OUTSIDE);
    raider.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.countForTest('acct_outside', 'wood')).toBe(0);

    owner.leave();
    raider.leave();
  });

  it('still lets the owner inside open their own crate', async () => {
    // The wall must not block a reach that never crosses it, or the base
    // would be as useless to its owner as to a raider.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_in', WALL, 'wood_wall');
    const crateId = await crateInside(room, owner, 'acct_in');

    owner.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await owner.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    expect(room.countForTest('acct_in', 'wood')).toBe(50);

    owner.leave();
  });

  it('lets a raider reach through an empty doorway, which is a hole in the wall', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_gap', DOORWAY, 'wood_doorway');
    const crateId = await crateInside(room, owner, 'acct_gap');

    const raider = await at(room, 'acct_chancer', OUTSIDE);
    raider.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await raider.waitForMessage('commandResult');

    // T11's "accessible open-box loot allowed": a doorway with nothing in it
    // is not security, and section 10 says doors supply that.
    expect(result.accepted, result.reasonCode).toBe(true);
    expect(room.countForTest('acct_chancer', 'wood')).toBe(50);

    owner.leave();
    raider.leave();
  });

  it('shuts that hole again when a door is hung in it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_shut', DOORWAY, 'wood_doorway');
    room.teleportForTest('acct_shut', { x: 42, y: 0, z: 41 });
    room.grantForTest('acct_shut', 'wood_door', 1);
    owner.send('command', command({ type: 'installDoor', definitionId: 'wood_door', ...DOORWAY }));
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);
    const crateId = await crateInside(room, owner, 'acct_shut');

    const raider = await at(room, 'acct_barred', OUTSIDE);
    raider.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');

    owner.leave();
    raider.leave();
  });

  it('opens it again when the owner opens the door', async () => {
    // GDD section 10: "a door left open lets anyone walk through" -- and so
    // reach through.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_ajar', DOORWAY, 'wood_doorway');
    room.teleportForTest('acct_ajar', { x: 42, y: 0, z: 41 });
    room.grantForTest('acct_ajar', 'wood_door', 1);
    owner.send('command', command({ type: 'installDoor', definitionId: 'wood_door', ...DOORWAY }));
    await owner.waitForMessage('commandResult');
    const crateId = await crateInside(room, owner, 'acct_ajar');
    owner.send('command', command({ type: 'operateDoor', open: true, ...DOORWAY }));
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    const raider = await at(room, 'acct_lucky', OUTSIDE);
    raider.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);

    owner.leave();
    raider.leave();
  });

  it('denies even the owner their own door handle through a different wall', async () => {
    // The occlusion rule has to cover the door commands too. Tested against
    // the owner on purpose: a stranger would be refused by the access list
    // whatever the geometry said, so only the owner can show that it was the
    // wall that stopped them.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_handle', DOORWAY, 'wood_doorway');
    room.teleportForTest('acct_handle', { x: 42, y: 0, z: 41 });
    room.grantForTest('acct_handle', 'wood_door', 1);
    owner.send('command', command({ type: 'installDoor', definitionId: 'wood_door', ...DOORWAY }));
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    // A second wall along the cell's x = 40 edge, which needs the pillar at
    // its far corner.
    room.grantForTest('acct_handle', 'wood_pillar', 1);
    room.grantForTest('acct_handle', 'wood_wall', 1);
    owner.send(
      'command',
      command({ type: 'placeBuildingPiece', definitionId: 'wood_pillar', form: 'pillar', storey: 0, i: CELL.i, k: CELL.k + 1, axis: null }),
    );
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);
    owner.send(
      'command',
      command({ type: 'placeBuildingPiece', definitionId: 'wood_wall', form: 'wall', storey: 0, i: CELL.i, k: CELL.k, axis: 'z' }),
    );
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    // West of that wall, close enough to the door to reach it in open ground.
    room.teleportForTest('acct_handle', { x: 39.5, y: 0, z: 41 });
    owner.send('command', command({ type: 'operateDoor', open: true, ...DOORWAY }));
    const result = await owner.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.doorForTest(DOORWAY)!.open).toBe(false);

    owner.leave();
  });
});

/** The same rule protects a body dragged inside a base. */
describe('WorldRoom reaching a corpse through a wall (T11)', () => {
  it('denies a raider a corpse lying behind a wall', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_body', WALL, 'wood_wall');
    room.teleportForTest('acct_body', INSIDE);
    room.grantForTest('acct_body', 'wood', 12);
    room.damageForTest('acct_body', 100);
    const corpseId = room.corpseIdForTest('acct_body')!;

    const raider = await at(room, 'acct_vulture', OUTSIDE);
    raider.send('command', command({ type: 'corpseTake', corpseId }));
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');

    owner.leave();
    raider.leave();
  });
});

/**
 * Occlusion is for reaching *for* things. GDD gives no rule against swinging
 * at what is on the other side of a wall, and T20's "no wall attacks" is a
 * constraint on animals rather than on players -- so the swing commands stay
 * on the plain distance check.
 */
describe('WorldRoom swinging near a wall (D64)', () => {
  it('still lets a player hit a node on the far side of their own wall', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_swing', WALL, 'wood_wall');
    // A wood pile just outside the wall, with the player just inside it.
    room.spawnNode('node_wall', 'wood', 150, 10, { x: 42, y: 0.5, z: 39 });
    room.teleportForTest('acct_swing', { x: 42, y: 0, z: 41 });

    owner.send('command', command({ type: 'hitNode', nodeId: 'node_wall' }));
    const result = await owner.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    expect(room.countForTest('acct_swing', 'wood')).toBeGreaterThan(0);

    owner.leave();
  });
});

/** The wall is 4 m long; past its end there is nothing to stop anyone. */
describe('WorldRoom walking round a wall (T11)', () => {
  it('lets a raider who walks round the end of it open the crate', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_short', WALL, 'wood_wall');
    const crateId = await crateInside(room, owner, 'acct_short');

    // The crate is at x 42, z 41; the wall spans x 40..44 at z 40. Standing
    // east of the wall's end and level with the crate crosses nothing.
    const raider = await at(room, 'acct_flank', { x: 44.8, y: 0, z: 41 });
    raider.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    expect(room.countForTest('acct_flank', 'wood')).toBe(50);

    owner.leave();
    raider.leave();
  });

  it('keeps the crate a wall away from being reachable at all', async () => {
    // Sanity: the same raider one cell further out is simply too far, which
    // is the ordinary reach rule and not the wall doing the work.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await wallUp(room, 'acct_far', WALL, 'wood_wall');
    const crateId = await crateInside(room, owner, 'acct_far');

    const raider = await at(room, 'acct_distant', { x: 42, y: 0, z: 41 + CELL_SIZE_M * 2 });
    raider.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');

    owner.leave();
    raider.leave();
  });
});
