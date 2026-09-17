import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2634);
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

const SPOT = { x: 60, y: 0, z: 60 };
const CRATE_AT = { x: 61, y: 0, z: 60 };

async function stockedCrate(room: WorldRoom, accountId: string, quantity = 90) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, SPOT);
  room.grantForTest(accountId, 'small_crate', 1);
  room.grantForTest(accountId, 'wood', quantity);

  client.send('command', command({ type: 'placeDeployable', definitionId: 'small_crate', ...CRATE_AT }));
  expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
  const crateId = [...room.state.deployables.keys()][0]!;
  if (quantity > 0) {
    client.send(
      'command',
      command({ type: 'containerInsert', containerId: crateId, definitionId: 'wood', quantity }),
    );
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
  }
  return { client, crateId };
}

/**
 * GDD section 11: "Destroying a box produces its loot." Section 8: "Destroyed
 * containers spill one bounded bag holding the actual remaining items", and
 * "Player-dropped bags have a 10-minute lifetime, player death bags 30
 * minutes".
 */
describe('WorldRoom breaking a crate (GDD sections 8 and 11)', () => {
  it('spills what was inside rather than destroying it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await stockedCrate(room, 'acct_smash');
    room.setDeployableHealthForTest(crateId, 10);

    client.send('command', command({ type: 'attackDeployable', deployableId: crateId }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    expect(room.state.deployables.has(crateId)).toBe(false);

    // One bag, holding exactly what the crate held, where the crate stood.
    const bags = [...room.state.corpses.entries()];
    expect(bags).toHaveLength(1);
    const bag = room.corpseForTest(bags[0]![0])!;
    expect(bag.position).toEqual(CRATE_AT);
    expect(bag.inventory.slots.filter((s) => s !== null)).toEqual([{ definitionId: 'wood', quantity: 90 }]);

    client.leave();
  });

  it('spills once, not once per swing', async () => {
    // "spills container contents once" -- the crate is gone after the first
    // break, so a second swing has nothing to find.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await stockedCrate(room, 'acct_twice');
    room.setDeployableHealthForTest(crateId, 10);
    client.send('command', command({ type: 'attackDeployable', deployableId: crateId }));
    await client.waitForMessage('commandResult');
    room.clearSwingCooldownForTest('acct_twice');

    client.send('command', command({ type: 'attackDeployable', deployableId: crateId }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');
    expect(room.state.corpses.size).toBe(1);

    client.leave();
  });

  it('drops no bag at all for an empty crate', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await stockedCrate(room, 'acct_bare', 0);
    room.setDeployableHealthForTest(crateId, 10);

    client.send('command', command({ type: 'attackDeployable', deployableId: crateId }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    expect(room.state.deployables.has(crateId)).toBe(false);
    // An empty bag is a prop that invites a pointless interaction, the same
    // reasoning as an emptied corpse (D49).
    expect(room.state.corpses.size).toBe(0);

    client.leave();
  });

  it('chips a crate that survives the swing', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await stockedCrate(room, 'acct_chip');

    client.send('command', command({ type: 'attackDeployable', deployableId: crateId }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    // CONTENT section 7's small crate is 250 HP; the rock hits for 10.
    expect(room.state.deployables.get(crateId)!.health).toBe(240);
    expect(room.state.corpses.size).toBe(0);

    client.leave();
  });

  it('lets anyone pick the spilled bag up', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await stockedCrate(room, 'acct_owner');
    room.setDeployableHealthForTest(crateId, 10);
    client.send('command', command({ type: 'attackDeployable', deployableId: crateId }));
    await client.waitForMessage('commandResult');
    const bagId = [...room.state.corpses.keys()][0]!;

    const raider = await colyseus.connectTo(room, { accountId: 'acct_raider' });
    await raider.waitForMessage('session');
    room.clearInventoryForTest('acct_raider');
    room.teleportForTest('acct_raider', CRATE_AT);

    raider.send('command', command({ type: 'corpseTake', corpseId: bagId }));
    const result = await raider.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    expect(room.countForTest('acct_raider', 'wood')).toBe(90);

    client.leave();
    raider.leave();
  });

  it('gives a spilled bag ten minutes, not a corpses thirty', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const { client, crateId } = await stockedCrate(room, 'acct_clock');
    room.setDeployableHealthForTest(crateId, 10);
    client.send('command', command({ type: 'attackDeployable', deployableId: crateId }));
    await client.waitForMessage('commandResult');
    const bagId = [...room.state.corpses.keys()][0]!;

    room.setTickForTest(room.tickForTest() + 10 * 60 * 20 - 1);
    room.expireCorpsesForTest();
    expect(room.state.corpses.has(bagId)).toBe(true);

    room.setTickForTest(room.tickForTest() + 2);
    room.expireCorpsesForTest();
    expect(room.state.corpses.has(bagId)).toBe(false);

    client.leave();
  });
});
