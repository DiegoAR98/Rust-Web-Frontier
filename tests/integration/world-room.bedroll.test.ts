import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { HEALTH_MAX } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2635);
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

const CAMP = { x: 70, y: 0, z: 70 };
const BEDROLL_AT = { x: 71, y: 0, z: 70 };

async function camper(room: WorldRoom, accountId: string) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, CAMP);
  return client;
}

async function layBedroll(
  room: WorldRoom,
  client: Awaited<ReturnType<typeof camper>>,
  accountId: string,
  at = BEDROLL_AT,
) {
  room.grantForTest(accountId, 'bedroll', 1);
  room.teleportForTest(accountId, { x: at.x - 1, y: 0, z: at.z });
  client.send('command', command({ type: 'placeDeployable', definitionId: 'bedroll', ...at }));
  const result = await client.waitForMessage('commandResult');
  expect(result.accepted, result.reasonCode).toBe(true);
  return [...room.state.deployables.keys()].at(-1)!;
}

/**
 * GDD section 12: "Bedrolls and cots are personal respawn anchors, maximum
 * five combined per account. Bedroll cooldown is 300 seconds ... A new anchor
 * starts on its full cooldown. Using one starts its timer and applies at least
 * that cooldown to the owner's other anchors within 50 m."
 */
describe('WorldRoom bedrolls (T13, GDD section 12)', () => {
  it('starts a freshly laid bedroll on its full cooldown', async () => {
    // Otherwise laying one is a free teleport home the moment you die.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_fresh');
    const anchorId = await layBedroll(room, client, 'acct_fresh');

    room.damageForTest('acct_fresh', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('busy');
    expect(room.isDeadForTest('acct_fresh')).toBe(true);

    client.leave();
  });

  it('brings a player back to their own bedroll once it is ready', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_home');
    const anchorId = await layBedroll(room, client, 'acct_home');
    room.setTickForTest(room.tickForTest() + 300 * 20 + 1);

    room.damageForTest('acct_home', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    const player = room.state.players.get('acct_home')!;
    expect({ x: player.x, z: player.z }).toEqual({ x: BEDROLL_AT.x, z: BEDROLL_AT.z });

    client.leave();
  });

  it('puts the bedroll back on cooldown after using it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_again');
    const anchorId = await layBedroll(room, client, 'acct_again');
    room.setTickForTest(room.tickForTest() + 300 * 20 + 1);
    room.damageForTest('acct_again', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    room.damageForTest('acct_again', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('busy');

    client.leave();
  });

  it('puts the other bedroll within fifty metres on cooldown too', async () => {
    // "Using one starts its timer and applies at least that cooldown to the
    // owner's other anchors within 50 m" -- otherwise a stack of bedrolls in
    // one room is an unlimited respawn.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_stack');
    const first = await layBedroll(room, client, 'acct_stack');
    const second = await layBedroll(room, client, 'acct_stack', { x: 75, y: 0, z: 70 });
    room.setTickForTest(room.tickForTest() + 300 * 20 + 1);

    room.damageForTest('acct_stack', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId: first }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    room.damageForTest('acct_stack', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId: second }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('busy');

    client.leave();
  });

  it('leaves a bedroll well outside fifty metres alone', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_spread');
    const near = await layBedroll(room, client, 'acct_spread');
    const far = await layBedroll(room, client, 'acct_spread', { x: 200, y: 0, z: 70 });
    room.setTickForTest(room.tickForTest() + 300 * 20 + 1);

    room.damageForTest('acct_spread', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId: near }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    room.damageForTest('acct_spread', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId: far }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    const player = room.state.players.get('acct_spread')!;
    expect(player.x).toBe(200);

    client.leave();
  });

  it('refuses somebody elses bedroll', async () => {
    // CONTENT section 7: "Owner-only spawn".
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await camper(room, 'acct_mine');
    const anchorId = await layBedroll(room, owner, 'acct_mine');
    room.setTickForTest(room.tickForTest() + 300 * 20 + 1);

    const stranger = await camper(room, 'acct_squat');
    room.damageForTest('acct_squat', HEALTH_MAX);
    stranger.send('command', command({ type: 'respawn', anchorId }));
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');

    owner.leave();
    stranger.leave();
  });

  it('refuses a bedroll that has been destroyed, and says so', async () => {
    // T13: "destroyed anchor unavailable".
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_razed');
    const anchorId = await layBedroll(room, client, 'acct_razed');
    room.setTickForTest(room.tickForTest() + 300 * 20 + 1);
    room.setDeployableHealthForTest(anchorId, 10);
    room.teleportForTest('acct_razed', BEDROLL_AT);
    client.send('command', command({ type: 'attackDeployable', deployableId: anchorId }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.state.deployables.has(anchorId)).toBe(false);

    room.damageForTest('acct_razed', HEALTH_MAX);
    client.send('command', command({ type: 'respawn', anchorId }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');
    // Still dead and still able to take the random anchor instead, rather
    // than stranded because their bedroll burned down.
    client.send('command', command({ type: 'respawn', anchorId: null }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    client.leave();
  });

  it('refuses a sixth anchor, before consuming it', async () => {
    // "maximum five combined per account"
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_hoarder');
    for (let n = 0; n < 5; n++) {
      await layBedroll(room, client, 'acct_hoarder', { x: 71 + n * 3, y: 0, z: 70 });
    }

    room.grantForTest('acct_hoarder', 'bedroll', 1);
    room.teleportForTest('acct_hoarder', { x: 89, y: 0, z: 70 });
    client.send('command', command({ type: 'placeDeployable', definitionId: 'bedroll', x: 90, y: 0, z: 70 }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('cap_reached');
    expect(room.countForTest('acct_hoarder', 'bedroll')).toBe(1);

    client.leave();
  });

  it('still takes a random anchor when no bedroll is named', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await camper(room, 'acct_nomad');
    room.damageForTest('acct_nomad', HEALTH_MAX);

    client.send('command', command({ type: 'respawn', anchorId: null }));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted, result.reasonCode).toBe(true);
    const player = room.state.players.get('acct_nomad')!;
    expect(room.respawnAnchorsForTest().some((a) => a.position.x === player.x)).toBe(true);

    client.leave();
  });
});
