import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2627);
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

/** Somewhere clear of the seeded item, nodes, stations and hazard zone. */
const SPOT = { x: 30, y: 0, z: 30 };
const place = (position = { x: 31, y: 0, z: 30 }) => ({
  type: 'placeDeployable',
  definitionId: 'small_crate',
  ...position,
});

async function standingAt(room: WorldRoom, accountId: string) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, SPOT);
  return client;
}

/**
 * GDD section 10: "Craft each piece into an inventory item, equip it and place
 * its ghost. A server-accepted placement consumes one item."
 */
describe('WorldRoom placing a crate (GDD section 10)', () => {
  it('turns one crate item into a crate in the world', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await standingAt(room, 'acct_builder');
    room.grantForTest('acct_builder', 'small_crate', 2);

    client.send('command', command(place()));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    // Exactly one item consumed, not the stack.
    expect(room.countForTest('acct_builder', 'small_crate')).toBe(1);
    const placed = [...room.state.deployables.entries()];
    expect(placed).toHaveLength(1);
    expect(placed[0]![1].definitionId).toBe('small_crate');
    expect(placed[0]![1].ownerAccountId).toBe('acct_builder');
    expect(placed[0]![1].x).toBe(31);

    client.leave();
  });

  it('refuses a placement with no crate to place, and consumes nothing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await standingAt(room, 'acct_broke');

    client.send('command', command(place()));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');
    expect(room.state.deployables.size).toBe(0);

    client.leave();
  });

  it('refuses a spot out of arms reach and keeps the crate', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await standingAt(room, 'acct_far');
    room.grantForTest('acct_far', 'small_crate', 1);

    client.send('command', command(place({ x: 80, y: 0, z: 30 })));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.countForTest('acct_far', 'small_crate')).toBe(1);
    expect(room.state.deployables.size).toBe(0);

    client.leave();
  });

  it('refuses to stack a second crate on the first, and keeps that one too', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await standingAt(room, 'acct_twice');
    room.grantForTest('acct_twice', 'small_crate', 2);

    client.send('command', command(place()));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    client.send('command', command(place({ x: 31.2, y: 0, z: 30 })));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('overlap');
    // GDD section 10: "Reaching a cap produces an understandable error before
    // consumption" -- and the same has to hold for every other refusal.
    expect(room.countForTest('acct_twice', 'small_crate')).toBe(1);
    expect(room.state.deployables.size).toBe(1);

    client.leave();
  });

  it('refuses to drop a crate on another player', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await standingAt(room, 'acct_rude');
    room.grantForTest('acct_rude', 'small_crate', 1);
    const bystander = await colyseus.connectTo(room, { accountId: 'acct_stood' });
    await bystander.waitForMessage('session');
    room.teleportForTest('acct_stood', { x: 31, y: 0, z: 30 });

    client.send('command', command(place()));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('overlap');

    client.leave();
    bystander.leave();
  });

  it('replays a duplicate placement instead of placing a second crate', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await standingAt(room, 'acct_dup');
    room.grantForTest('acct_dup', 'small_crate', 2);

    client.send('command', command(place(), 700));
    const first = await client.waitForMessage('commandResult');
    client.send('command', command(place(), 700));
    const replay = await client.waitForMessage('commandResult');

    expect(first.accepted).toBe(true);
    expect(replay).toEqual(first);
    expect(room.state.deployables.size).toBe(1);
    expect(room.countForTest('acct_dup', 'small_crate')).toBe(1);

    client.leave();
  });
});

/** GDD section 8: "Any person who reaches a box can open it; doors supply security." */
describe('WorldRoom using a crate (GDD section 8)', () => {
  async function placedCrate(room: WorldRoom, accountId: string) {
    const client = await standingAt(room, accountId);
    room.grantForTest(accountId, 'small_crate', 1);
    client.send('command', command(place()));
    await client.waitForMessage('commandResult');
    return { client, crateId: [...room.state.deployables.keys()][0]! };
  }

  it('stores what the owner puts in and hands it back', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await placedCrate(room, 'acct_store');
    room.grantForTest('acct_store', 'wood', 90);

    client.send('command', command({ type: 'containerInsert', containerId: crateId, definitionId: 'wood', quantity: 90 }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.countForTest('acct_store', 'wood')).toBe(0);
    expect(room.containerForTest(crateId)!.filter((s) => s !== null)).toEqual([
      { definitionId: 'wood', quantity: 90 },
    ]);

    client.send('command', command({ type: 'containerTake', containerId: crateId }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.countForTest('acct_store', 'wood')).toBe(90);
    expect(room.containerForTest(crateId)!.filter((s) => s !== null)).toEqual([]);

    client.leave();
  });

  it('lets a stranger who walks up to it open it', async () => {
    // GDD section 8 is explicit that boxes are not magically private; the door
    // permissions that would protect one are a later vertical.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await placedCrate(room, 'acct_owner');
    room.grantForTest('acct_owner', 'wood', 25);
    client.send('command', command({ type: 'containerInsert', containerId: crateId, definitionId: 'wood', quantity: 25 }));
    await client.waitForMessage('commandResult');

    const stranger = await standingAt(room, 'acct_stranger');
    stranger.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.countForTest('acct_stranger', 'wood')).toBe(25);

    client.leave();
    stranger.leave();
  });

  it('refuses a crate the player cannot reach', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await placedCrate(room, 'acct_here');
    room.grantForTest('acct_here', 'wood', 10);
    room.teleportForTest('acct_here', { x: 200, y: 0, z: 200 });

    client.send('command', command({ type: 'containerInsert', containerId: crateId, definitionId: 'wood', quantity: 10 }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('out_of_range');
    expect(room.countForTest('acct_here', 'wood')).toBe(10);

    client.leave();
  });

  it('will not swallow more than the crate has slots for', async () => {
    // CONTENT section 7: a small crate is 12 slots. Hatchets do not stack, so
    // thirteen of them cannot fit however the crate is filled.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await placedCrate(room, 'acct_hoard');
    room.grantForTest('acct_hoard', 'stone_hatchet', 13);

    client.send(
      'command',
      command({ type: 'containerInsert', containerId: crateId, definitionId: 'stone_hatchet', quantity: 13 }),
    );
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.containerForTest(crateId)!.filter((s) => s !== null)).toHaveLength(12);
    // The thirteenth stayed in the pack rather than evaporating.
    expect(room.countForTest('acct_hoard', 'stone_hatchet')).toBe(1);

    client.leave();
  });

  it('refuses an insert of something the player does not have', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await placedCrate(room, 'acct_empty');

    client.send('command', command({ type: 'containerInsert', containerId: crateId, definitionId: 'metal', quantity: 5 }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');

    client.leave();
  });

  it('says a crate is empty rather than pretending it gave you something', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await placedCrate(room, 'acct_bare');

    client.send('command', command({ type: 'containerTake', containerId: crateId }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('depleted');

    client.leave();
  });
});
