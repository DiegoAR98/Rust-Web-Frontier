import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CELL_SIZE_M, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2629);
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

/** Far from the seeded item, nodes, stations and hazard zone at the origin. */
const CELL = { i: 10, k: 10 };
const CENTRE = { x: (CELL.i + 0.5) * CELL_SIZE_M, y: 0, z: (CELL.k + 0.5) * CELL_SIZE_M };

const site = (form: PieceSite['form'], i: number, k: number, axis: PieceSite['axis'] = null, storey = 0) => ({
  form,
  storey,
  i,
  k,
  axis,
});

/** CONTENT section 7's closed 1x1 cabin, in the order it has to be built. */
const CABIN: Array<{ definitionId: string; site: PieceSite }> = [
  { definitionId: 'wood_foundation', site: site('foundation', CELL.i, CELL.k) },
  { definitionId: 'wood_pillar', site: site('pillar', CELL.i, CELL.k) },
  { definitionId: 'wood_pillar', site: site('pillar', CELL.i + 1, CELL.k) },
  { definitionId: 'wood_pillar', site: site('pillar', CELL.i, CELL.k + 1) },
  { definitionId: 'wood_pillar', site: site('pillar', CELL.i + 1, CELL.k + 1) },
  { definitionId: 'wood_wall', site: site('wall', CELL.i, CELL.k, 'x') },
  { definitionId: 'wood_wall', site: site('wall', CELL.i, CELL.k, 'z') },
  { definitionId: 'wood_wall', site: site('wall', CELL.i + 1, CELL.k, 'z') },
  { definitionId: 'wood_doorway', site: site('doorway', CELL.i, CELL.k + 1, 'x') },
  { definitionId: 'wood_ceiling', site: site('ceiling', CELL.i, CELL.k) },
];

function placeCommand(entry: { definitionId: string; site: PieceSite }, sequenceOverride?: number) {
  return command({ type: 'placeBuildingPiece', definitionId: entry.definitionId, ...entry.site }, sequenceOverride);
}

async function builderAt(room: WorldRoom, accountId: string) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, CENTRE);
  return client;
}

/**
 * T10: "Build specified 1x1 cabin -> Exactly 360 wood before stations; legal
 * snapped geometry; no unsupported ceiling."
 */
describe('WorldRoom building the cabin (T10, GDD section 10)', () => {
  it('spends exactly 360 wood crafting the cabin, and not a log more', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_cabin');
    room.grantForTest('acct_cabin', 'wood', 360);

    // CONTENT section 7's piece list, crafted through the real command so the
    // 360 is what a player actually pays rather than a table read back.
    const orders: Array<[string, number, number]> = [
      ['wood_foundation', 1, 15],
      ['wood_pillar', 4, 5],
      ['wood_wall', 3, 10],
      ['wood_doorway', 1, 10],
      ['wood_ceiling', 1, 15],
      ['wood_door', 1, 10],
    ];
    for (const [recipeId, quantity, durationS] of orders) {
      client.send('command', command({ type: 'craft', recipeId, quantity }));
      const result = await client.waitForMessage('commandResult');
      expect(result.accepted, `${recipeId} refused: ${result.reasonCode}`).toBe(true);
      room.advanceCraftingForTest(durationS * quantity + 1);
    }

    expect(room.countForTest('acct_cabin', 'wood')).toBe(0);
    expect(room.countForTest('acct_cabin', 'wood_foundation')).toBe(1);
    expect(room.countForTest('acct_cabin', 'wood_pillar')).toBe(4);
    expect(room.countForTest('acct_cabin', 'wood_wall')).toBe(3);
    expect(room.countForTest('acct_cabin', 'wood_doorway')).toBe(1);
    expect(room.countForTest('acct_cabin', 'wood_ceiling')).toBe(1);
    expect(room.countForTest('acct_cabin', 'wood_door')).toBe(1);

    client.leave();
  });

  it('snaps all ten pieces into a legal cabin', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_snap');
    for (const entry of CABIN) room.grantForTest('acct_snap', entry.definitionId, 1);

    for (const entry of CABIN) {
      client.send('command', placeCommand(entry));
      const result = await client.waitForMessage('commandResult');
      expect(result.accepted, `${entry.definitionId} refused: ${result.reasonCode}`).toBe(true);
    }

    expect(room.state.buildingPieces.size).toBe(CABIN.length);
    // Every piece was consumed; none is still in the pack.
    for (const entry of CABIN) {
      expect(room.countForTest('acct_snap', entry.definitionId)).toBe(0);
    }

    client.leave();
  });

  it('refuses the ceiling until all four pillars are under it', async () => {
    // T10's "no unsupported ceiling", through the real command.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_roof');
    room.grantForTest('acct_roof', 'wood_foundation', 1);
    room.grantForTest('acct_roof', 'wood_pillar', 4);
    room.grantForTest('acct_roof', 'wood_ceiling', 1);

    for (const entry of CABIN.slice(0, 4)) {
      client.send('command', placeCommand(entry));
      await client.waitForMessage('commandResult');
    }

    // Three pillars down, the fourth not yet.
    client.send('command', placeCommand({ definitionId: 'wood_ceiling', site: site('ceiling', CELL.i, CELL.k) }));
    const refused = await client.waitForMessage('commandResult');
    expect(refused.accepted).toBe(false);
    expect(refused.reasonCode).toBe('unsupported');
    expect(room.countForTest('acct_roof', 'wood_ceiling')).toBe(1);

    client.send('command', placeCommand(CABIN[4]!));
    await client.waitForMessage('commandResult');
    client.send('command', placeCommand({ definitionId: 'wood_ceiling', site: site('ceiling', CELL.i, CELL.k) }));
    const accepted = await client.waitForMessage('commandResult');
    expect(accepted.accepted).toBe(true);

    client.leave();
  });

  it('refuses a foundation hanging in the air', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_sky');
    room.grantForTest('acct_sky', 'wood_foundation', 1);

    client.send(
      'command',
      placeCommand({ definitionId: 'wood_foundation', site: site('foundation', CELL.i, CELL.k, null, 1) }),
    );
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('unsupported');
    expect(room.countForTest('acct_sky', 'wood_foundation')).toBe(1);

    client.leave();
  });

  it('refuses a second piece in a site that is already filled', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_again');
    room.grantForTest('acct_again', 'wood_foundation', 2);

    client.send('command', placeCommand(CABIN[0]!));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    client.send('command', placeCommand(CABIN[0]!));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('overlap');
    expect(room.countForTest('acct_again', 'wood_foundation')).toBe(1);

    client.leave();
  });

  it('refuses a piece whose item the player is not actually holding', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_bluff');

    client.send('command', placeCommand(CABIN[0]!));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');
    expect(room.state.buildingPieces.size).toBe(0);

    client.leave();
  });

  it('refuses a wall item aimed at a ceiling site', async () => {
    // The site names a form and so does the item; a mismatch would let one
    // recipe pay for another piece's HP and cost.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_mix');
    room.grantForTest('acct_mix', 'wood_foundation', 1);
    room.grantForTest('acct_mix', 'wood_wall', 1);
    client.send('command', placeCommand(CABIN[0]!));
    await client.waitForMessage('commandResult');

    client.send('command', placeCommand({ definitionId: 'wood_wall', site: site('ceiling', CELL.i, CELL.k) }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');
    expect(room.countForTest('acct_mix', 'wood_wall')).toBe(1);

    client.leave();
  });

  it('refuses a site the builder cannot reach', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_remote');
    room.grantForTest('acct_remote', 'wood_foundation', 1);

    client.send(
      'command',
      placeCommand({ definitionId: 'wood_foundation', site: site('foundation', CELL.i + 20, CELL.k) }),
    );
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');

    client.leave();
  });

  it('replays a duplicate placement instead of raising two pillars', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await builderAt(room, 'acct_twin');
    room.grantForTest('acct_twin', 'wood_foundation', 2);

    client.send('command', placeCommand(CABIN[0]!, 800));
    const first = await client.waitForMessage('commandResult');
    client.send('command', placeCommand(CABIN[0]!, 800));
    const replay = await client.waitForMessage('commandResult');

    expect(first.accepted).toBe(true);
    expect(replay).toEqual(first);
    expect(room.state.buildingPieces.size).toBe(1);
    expect(room.countForTest('acct_twin', 'wood_foundation')).toBe(1);

    client.leave();
  });
});

/**
 * GDD section 10: "Only a building owner or explicit builder can attach to its
 * grid or replace its pieces; enemies may build separate raid towers outside
 * this collision clearance."
 */
describe('WorldRoom building ownership (GDD section 10)', () => {
  it('refuses a stranger attaching to somebody elses building', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await builderAt(room, 'acct_mine');
    room.grantForTest('acct_mine', 'wood_foundation', 1);
    owner.send('command', placeCommand(CABIN[0]!));
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    const stranger = await builderAt(room, 'acct_yours');
    room.grantForTest('acct_yours', 'wood_pillar', 1);
    stranger.send('command', placeCommand(CABIN[1]!));
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');
    expect(room.countForTest('acct_yours', 'wood_pillar')).toBe(1);

    owner.leave();
    stranger.leave();
  });

  it('lets a stranger build their own raid tower one cell clear of it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await builderAt(room, 'acct_base');
    room.grantForTest('acct_base', 'wood_foundation', 1);
    owner.send('command', placeCommand(CABIN[0]!));
    await owner.waitForMessage('commandResult');

    const raider = await colyseus.connectTo(room, { accountId: 'acct_raider' });
    await raider.waitForMessage('session');
    room.clearInventoryForTest('acct_raider');
    room.grantForTest('acct_raider', 'wood_foundation', 1);
    // Two cells over: not adjacent, so a detached foundation, and 4 m clear of
    // the other one's edge -- comfortably past section 10's 1 m.
    const towerCell = { i: CELL.i + 2, k: CELL.k };
    room.teleportForTest('acct_raider', { x: (towerCell.i + 0.5) * CELL_SIZE_M, y: 0, z: CENTRE.z });

    raider.send(
      'command',
      placeCommand({ definitionId: 'wood_foundation', site: site('foundation', towerCell.i, towerCell.k) }),
    );
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.state.buildingPieces.size).toBe(2);

    owner.leave();
    raider.leave();
  });

  it('refuses a stranger a foundation touching theirs, even only at a corner', async () => {
    // Sharing a corner is 0 m apart, which section 10's "at least 1 m from any
    // existing foundation edge" forbids for a detached foundation -- and it is
    // structurally an attachment, so it needs the owner's permission.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await builderAt(room, 'acct_corner');
    room.grantForTest('acct_corner', 'wood_foundation', 1);
    owner.send('command', placeCommand(CABIN[0]!));
    await owner.waitForMessage('commandResult');

    const raider = await colyseus.connectTo(room, { accountId: 'acct_nudge' });
    await raider.waitForMessage('session');
    room.clearInventoryForTest('acct_nudge');
    room.grantForTest('acct_nudge', 'wood_foundation', 1);
    const diagonal = { i: CELL.i + 1, k: CELL.k + 1 };
    room.teleportForTest('acct_nudge', {
      x: (diagonal.i + 0.5) * CELL_SIZE_M,
      y: 0,
      z: (diagonal.k + 0.5) * CELL_SIZE_M,
    });

    raider.send(
      'command',
      placeCommand({ definitionId: 'wood_foundation', site: site('foundation', diagonal.i, diagonal.k) }),
    );
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');

    owner.leave();
    raider.leave();
  });
});


/**
 * Three corrections found by review, all of them in the placement path.
 */
describe('WorldRoom placement corrections', () => {
  it('lets a builder roof a cell somebody else is standing in', async () => {
    // "Reject overlap with players" is measured on the ground plane, and a
    // ceiling's ground position is the cell it roofs -- so a teammate standing
    // anywhere in a 4 m room made the ceiling over their head un-placeable,
    // with the ghost previewing green right up until the refusal.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const builder = await colyseus.connectTo(room, { accountId: 'acct_roofer' });
    await builder.waitForMessage('session');
    const guest = await colyseus.connectTo(room, { accountId: 'acct_guest' });
    await guest.waitForMessage('session');
    room.clearInventoryForTest('acct_roofer');
    room.teleportForTest('acct_roofer', CENTRE);
    for (const piece of CABIN) {
      room.grantForTest('acct_roofer', piece.definitionId, 1);
      builder.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
      const placed = await builder.waitForMessage('commandResult');
      if (piece.site.form === 'ceiling') continue;
      expect(placed.accepted, `${piece.definitionId}: ${placed.reasonCode}`).toBe(true);
    }
    // Stand the guest squarely under the roof and try again.
    room.removePieceForTest(site('ceiling', CELL.i, CELL.k) as PieceSite);
    room.teleportForTest('acct_guest', CENTRE);
    room.grantForTest('acct_roofer', 'wood_ceiling', 1);

    builder.send('command', command({
      type: 'placeBuildingPiece',
      definitionId: 'wood_ceiling',
      ...site('ceiling', CELL.i, CELL.k),
    }));
    const result = await builder.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);

    builder.leave();
    guest.leave();
  });

  it('does not let an upper-floor wall block the ground below it', async () => {
    // wallSegment ignores storey (D78's recorded cost), so a storey-1 wall used
    // to flatten into a barrier at ground level -- an invisible wall across
    // open ground, on a floor nobody can even stand on. The barrier list is
    // ground floor only until it carries height.
    //
    // Deliberately no ground-floor wall on that edge: with one there, the
    // refusal would be the real wall and the test would prove nothing.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_upstairs' });
    await client.waitForMessage('session');
    room.clearInventoryForTest('acct_upstairs');
    room.teleportForTest('acct_upstairs', CENTRE);

    const frame: Array<{ definitionId: string; site: PieceSite }> = [
      { definitionId: 'wood_foundation', site: site('foundation', CELL.i, CELL.k) as PieceSite },
      { definitionId: 'wood_pillar', site: site('pillar', CELL.i, CELL.k) as PieceSite },
      { definitionId: 'wood_pillar', site: site('pillar', CELL.i + 1, CELL.k) as PieceSite },
      { definitionId: 'wood_pillar', site: site('pillar', CELL.i, CELL.k + 1) as PieceSite },
      { definitionId: 'wood_pillar', site: site('pillar', CELL.i + 1, CELL.k + 1) as PieceSite },
      { definitionId: 'wood_ceiling', site: site('ceiling', CELL.i, CELL.k) as PieceSite },
      { definitionId: 'wood_pillar', site: site('pillar', CELL.i, CELL.k, null, 1) as PieceSite },
      { definitionId: 'wood_pillar', site: site('pillar', CELL.i + 1, CELL.k, null, 1) as PieceSite },
      { definitionId: 'wood_wall', site: site('wall', CELL.i, CELL.k, 'x', 1) as PieceSite },
    ];
    for (const piece of frame) {
      room.grantForTest('acct_upstairs', piece.definitionId, 1);
      client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
      const placed = await client.waitForMessage('commandResult');
      expect(placed.accepted, `${piece.definitionId} storey ${piece.site.storey}: ${placed.reasonCode}`).toBe(true);
    }

    const edgeZ = CELL.k * CELL_SIZE_M;
    room.teleportForTest('acct_upstairs', { x: CENTRE.x, y: 0, z: edgeZ + 1 });
    client.send('command', command({
      type: 'move', axisX: 0, axisY: 1, yaw: Math.PI, sprint: true, crouch: false, jump: false,
    }));
    for (let i = 0; i < 40 && !room.isSprintingForTest('acct_upstairs'); i += 1) {
      await room.waitForNextTimestep();
    }
    for (let i = 0; i < 40; i += 1) room.advanceMovementForTest(1 / 20);

    expect(room.state.players.get('acct_upstairs')!.z, 'an upper-floor wall blocked the ground')
      .toBeLessThan(edgeZ);

    client.leave();
  });

  it('lets a sleeper who disconnected in mid-air finish falling', async () => {
    // GDD section 12 stops a sleeper's motion but still has it "fall under
    // authoritative collision" -- both halves. What carries the fall is that
    // tickMovement walks every body and supplies a neutral action where there
    // is no intent; a disconnect drops the intent, so an integrator keyed on
    // the intent map would leave the body hanging in the air instead.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_hanging' });
    await client.waitForMessage('session');
    client.send('command', command({
      type: 'move', axisX: 0, axisY: 1, yaw: 0, sprint: true, crouch: false, jump: false,
    }));
    for (let i = 0; i < 40 && !room.isSprintingForTest('acct_hanging'); i += 1) {
      await room.waitForNextTimestep();
    }
    expect(room.isSprintingForTest('acct_hanging')).toBe(true);

    client.leave();
    for (let i = 0; i < 40 && room.isConnectedForTest('acct_hanging'); i += 1) {
      await room.waitForNextTimestep();
    }
    expect(room.isConnectedForTest('acct_hanging'), 'never actually disconnected').toBe(false);

    // Lifted only AFTER the disconnect, so the fall can only be carried by an
    // intent that survived it. Doing this before leaving proves nothing: the
    // room's own loop lands them while the test is still waiting.
    room.teleportForTest('acct_hanging', { x: 300, y: 8, z: 300 });
    expect(room.positionForTest('acct_hanging')!.y, 'the lift did not take').toBe(8);

    for (let i = 0; i < 60; i += 1) room.advanceMovementForTest(1 / 20);

    // Read off the simulation, not the replicated schema: the schema is only
    // written by a movement tick, so with no intent at all it would keep its
    // stale zero and the assertion would pass without anything having fallen.
    expect(room.positionForTest('acct_hanging')!.y).toBe(0);
  });
});
