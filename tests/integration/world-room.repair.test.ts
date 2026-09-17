import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { REPAIR_CHANNEL_S, siteKey, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2638);
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
const INSIDE = { x: 162, y: 0, z: 162 };
const FOUNDATION: PieceSite = { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_A: PieceSite = { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null };
const PILLAR_B: PieceSite = { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k, axis: null };
const WALL: PieceSite = { form: 'wall', storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };

const repair = (site: PieceSite, door = false) => command({ type: 'repairStructure', door, ...site });
const healthOf = (room: WorldRoom, site: PieceSite) => room.state.buildingPieces.get(siteKey(site))!.health;

async function damagedWall(room: WorldRoom, accountId: string) {
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
  room.setPieceHealthForTest(WALL, 500);
  return client;
}

/**
 * GDD section 10: "Hold interact on an owned damaged piece for 2 seconds to
 * restore up to 100 HP, paying ceil(original material cost x restoredHP /
 * maxHP x 0.5) of each resource."
 */
describe('WorldRoom repairing a structure (GDD section 10)', () => {
  it('puts a hundred back and charges for it once the hold finishes', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await damagedWall(room, 'acct_mend');
    room.grantForTest('acct_mend', 'wood', 10);

    client.send('command', repair(WALL));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    // Nothing has been spent or restored yet: it is a hold, not a press.
    expect(healthOf(room, WALL)).toBe(500);
    expect(room.countForTest('acct_mend', 'wood')).toBe(10);

    room.advanceChannelsForTest(REPAIR_CHANNEL_S + 0.1);

    expect(healthOf(room, WALL)).toBe(600);
    // A 40-wood wall over 1000 HP: ceil(40 x 100/1000 x 0.5) = 2.
    expect(room.countForTest('acct_mend', 'wood')).toBe(8);

    client.leave();
  });

  it('refuses a repair the player cannot pay for, and spends nothing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await damagedWall(room, 'acct_broke');

    client.send('command', repair(WALL));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');
    expect(healthOf(room, WALL)).toBe(500);

    client.leave();
  });

  it('refuses to repair a piece that is not damaged', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await damagedWall(room, 'acct_fine');
    room.grantForTest('acct_fine', 'wood', 10);
    room.setPieceHealthForTest(WALL, 1000);

    client.send('command', repair(WALL));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');
    expect(room.countForTest('acct_fine', 'wood')).toBe(10);

    client.leave();
  });

  it('never repairs past full health, and charges only for what it put back', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await damagedWall(room, 'acct_topup');
    room.grantForTest('acct_topup', 'wood', 10);
    room.setPieceHealthForTest(WALL, 990);

    client.send('command', repair(WALL));
    await client.waitForMessage('commandResult');
    room.advanceChannelsForTest(REPAIR_CHANNEL_S + 0.1);

    expect(healthOf(room, WALL)).toBe(1000);
    // Ten HP of a 40-wood, 1000 HP wall: ceil(40 x 0.01 x 0.5) = 1.
    expect(room.countForTest('acct_topup', 'wood')).toBe(9);

    client.leave();
  });

  it('refuses a stranger repairing somebody elses wall', async () => {
    // "on an owned damaged piece" -- the same grid permission attaching uses.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await damagedWall(room, 'acct_keeper');
    const stranger = await colyseus.connectTo(room, { accountId: 'acct_helpful' });
    await stranger.waitForMessage('session');
    room.clearInventoryForTest('acct_helpful');
    room.teleportForTest('acct_helpful', INSIDE);
    room.grantForTest('acct_helpful', 'wood', 10);

    stranger.send('command', repair(WALL));
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');

    owner.leave();
    stranger.leave();
  });

  it('refuses a repair while the building is raid locked', async () => {
    // GDD section 11: the lock "blocks repair, tier swaps, demolition and new
    // attached construction" -- a wall cannot be patched faster than it is
    // being broken.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await damagedWall(room, 'acct_under_fire');
    room.grantForTest('acct_under_fire', 'wood', 10);
    client.send('command', command({ type: 'attackStructure', door: false, ...WALL }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    client.send('command', repair(WALL));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('raid_locked');

    client.leave();
  });

  it('lets the repair happen once the lock lifts', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await damagedWall(room, 'acct_after');
    room.grantForTest('acct_after', 'wood', 10);
    client.send('command', command({ type: 'attackStructure', door: false, ...WALL }));
    await client.waitForMessage('commandResult');
    room.setTickForTest(room.tickForTest() + 60 * 20 + 1);

    client.send('command', repair(WALL));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);

    client.leave();
  });

  it('cancels a repair that is interrupted, spending nothing', async () => {
    // The same rule as a bandage (D36): a hold that does not finish costs
    // nothing at all.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await damagedWall(room, 'acct_jumpy');
    room.grantForTest('acct_jumpy', 'wood', 10);
    client.send('command', repair(WALL));
    await client.waitForMessage('commandResult');

    room.damageForTest('acct_jumpy', 5);
    room.advanceChannelsForTest(REPAIR_CHANNEL_S + 0.1);

    expect(healthOf(room, WALL)).toBe(500);
    expect(room.countForTest('acct_jumpy', 'wood')).toBe(10);

    client.leave();
  });

  it('repairs a door as readily as the frame it hangs in', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_hinge' });
    await client.waitForMessage('session');
    room.clearInventoryForTest('acct_hinge');
    room.teleportForTest('acct_hinge', INSIDE);
    room.grantForTest('acct_hinge', 'wood_foundation', 1);
    room.grantForTest('acct_hinge', 'wood_pillar', 2);
    room.grantForTest('acct_hinge', 'wood_doorway', 1);
    room.grantForTest('acct_hinge', 'wood_door', 1);
    const doorway: PieceSite = { form: 'doorway', storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };
    for (const piece of [
      { definitionId: 'wood_foundation', site: FOUNDATION },
      { definitionId: 'wood_pillar', site: PILLAR_A },
      { definitionId: 'wood_pillar', site: PILLAR_B },
      { definitionId: 'wood_doorway', site: doorway },
    ]) {
      client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
      expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    }
    client.send('command', command({ type: 'installDoor', definitionId: 'wood_door', ...doorway }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    room.setDoorHealthForTest(doorway, 200);
    room.grantForTest('acct_hinge', 'wood', 10);

    client.send('command', repair(doorway, true));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    room.advanceChannelsForTest(REPAIR_CHANNEL_S + 0.1);

    expect(room.state.doors.get(siteKey(doorway))!.health).toBe(300);
    // A 30-wood door over 500 HP: ceil(30 x 100/500 x 0.5) = 3.
    expect(room.countForTest('acct_hinge', 'wood')).toBe(7);

    client.leave();
  });
});
