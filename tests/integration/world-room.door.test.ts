import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CELL_SIZE_M, type PieceSite } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2631);
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
const CENTRE = { x: (CELL.i + 0.5) * CELL_SIZE_M, y: 0, z: (CELL.k + 0.5) * CELL_SIZE_M };
/** The doorway on cell (10,10)'s z = 0 edge. */
const DOORWAY: PieceSite = { form: 'doorway', storey: 0, i: CELL.i, k: CELL.k, axis: 'x' };

async function at(room: WorldRoom, accountId: string) {
  const client = await colyseus.connectTo(room, { accountId });
  await client.waitForMessage('session');
  room.clearInventoryForTest(accountId);
  room.teleportForTest(accountId, CENTRE);
  return client;
}

/** Puts up a foundation, the two pillars the doorway needs, and the doorway. */
async function doorwayFor(room: WorldRoom, accountId: string) {
  const client = await at(room, accountId);
  room.grantForTest(accountId, 'wood_foundation', 1);
  room.grantForTest(accountId, 'wood_pillar', 2);
  room.grantForTest(accountId, 'wood_doorway', 1);
  room.grantForTest(accountId, 'wood_door', 1);

  const pieces = [
    { definitionId: 'wood_foundation', site: { form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null } },
    { definitionId: 'wood_pillar', site: { form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null } },
    { definitionId: 'wood_pillar', site: { form: 'pillar', storey: 0, i: CELL.i + 1, k: CELL.k, axis: null } },
    { definitionId: 'wood_doorway', site: DOORWAY },
  ];
  for (const piece of pieces) {
    client.send('command', command({ type: 'placeBuildingPiece', definitionId: piece.definitionId, ...piece.site }));
    const result = await client.waitForMessage('commandResult');
    expect(result.accepted, `${piece.definitionId}: ${result.reasonCode}`).toBe(true);
  }
  return client;
}

const install = () => command({ type: 'installDoor', definitionId: 'wood_door', ...DOORWAY });
const operate = (open: boolean) => command({ type: 'operateDoor', open, ...DOORWAY });

/**
 * GDD section 10: "Owner doors default closed and private. The owner can grant
 * named player IDs door access and, separately, building permission through a
 * local interaction. Permissions persist and can be revoked immediately."
 */
describe('WorldRoom doors (T11, GDD section 10)', () => {
  it('hangs a door in a doorway, closed and private', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await doorwayFor(room, 'acct_owner');

    client.send('command', install());
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(true);
    expect(room.countForTest('acct_owner', 'wood_door')).toBe(0);
    const door = room.doorForTest(DOORWAY)!;
    expect(door.ownerAccountId).toBe('acct_owner');
    expect(door.open).toBe(false);

    client.leave();
  });

  it('refuses a door with no doorway to hang it in', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await at(room, 'acct_nowhere');
    room.grantForTest('acct_nowhere', 'wood_door', 1);

    client.send('command', install());
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');
    expect(room.countForTest('acct_nowhere', 'wood_door')).toBe(1);

    client.leave();
  });

  it('refuses a second door in an occupied socket', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await doorwayFor(room, 'acct_double');
    room.grantForTest('acct_double', 'wood_door', 1);
    client.send('command', install());
    await client.waitForMessage('commandResult');

    client.send('command', install());
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('overlap');
    expect(room.countForTest('acct_double', 'wood_door')).toBe(1);

    client.leave();
  });

  it('lets only the authorised builder install a door in the frame', async () => {
    // GDD section 10: "Only the authorized builder can install a replacement
    // door."
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await doorwayFor(room, 'acct_frame');
    const stranger = await at(room, 'acct_intruder');
    room.grantForTest('acct_intruder', 'wood_door', 1);

    stranger.send('command', install());
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');
    expect(room.countForTest('acct_intruder', 'wood_door')).toBe(1);

    owner.leave();
    stranger.leave();
  });

  it('opens and closes for its owner', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await doorwayFor(room, 'acct_key');
    client.send('command', install());
    await client.waitForMessage('commandResult');

    client.send('command', operate(true));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.doorForTest(DOORWAY)!.open).toBe(true);

    client.send('command', operate(false));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.doorForTest(DOORWAY)!.open).toBe(false);

    client.leave();
  });

  it('refuses a stranger the door, and leaves it shut', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await doorwayFor(room, 'acct_locked');
    owner.send('command', install());
    await owner.waitForMessage('commandResult');

    const stranger = await at(room, 'acct_thief');
    stranger.send('command', operate(true));
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');
    expect(room.doorForTest(DOORWAY)!.open).toBe(false);

    owner.leave();
    stranger.leave();
  });

  it('opens for a named friend once the owner grants access', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await doorwayFor(room, 'acct_host');
    owner.send('command', install());
    await owner.waitForMessage('commandResult');
    const friend = await at(room, 'acct_guest');

    owner.send(
      'command',
      command({ type: 'setDoorAccess', targetAccountId: 'acct_guest', granted: true, ...DOORWAY }),
    );
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    friend.send('command', operate(true));
    expect((await friend.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.doorForTest(DOORWAY)!.open).toBe(true);

    owner.leave();
    friend.leave();
  });

  it('shuts a friend out again the moment access is revoked', async () => {
    // "Permissions persist and can be revoked immediately."
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await doorwayFor(room, 'acct_host2');
    owner.send('command', install());
    await owner.waitForMessage('commandResult');
    const friend = await at(room, 'acct_exguest');
    owner.send(
      'command',
      command({ type: 'setDoorAccess', targetAccountId: 'acct_exguest', granted: true, ...DOORWAY }),
    );
    await owner.waitForMessage('commandResult');
    owner.send(
      'command',
      command({ type: 'setDoorAccess', targetAccountId: 'acct_exguest', granted: false, ...DOORWAY }),
    );
    await owner.waitForMessage('commandResult');

    friend.send('command', operate(true));
    const result = await friend.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');

    owner.leave();
    friend.leave();
  });

  it('leaves a broken door s socket empty for sixty seconds', async () => {
    // GDD section 10: "Breaking a door leaves its socket unavailable to
    // everyone for 60 seconds." Without it a defender re-hangs a door the
    // instant it breaks, and a breach that cost a satchel closes for free.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await doorwayFor(room, 'acct_breach');
    client.send('command', install());
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);

    room.setDoorHealthForTest(DOORWAY, 1);
    client.send('command', command({ type: 'attackStructure', door: true, ...DOORWAY }));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.doorForTest(DOORWAY)).toBeUndefined();

    room.grantForTest('acct_breach', 'wood_door', 1);
    client.send('command', install());
    const refused = await client.waitForMessage('commandResult');
    expect(refused.accepted).toBe(false);
    expect(refused.reasonCode).toBe('busy');
    expect(room.countForTest('acct_breach', 'wood_door')).toBe(1);

    room.setTickForTest(room.tickForTest() + 60 * 20 + 1);
    client.send('command', install());
    const allowed = await client.waitForMessage('commandResult');
    expect(allowed.accepted, allowed.reasonCode).toBe(true);

    client.leave();
  });

  it('refuses a stranger handing out access to somebody elses door', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await doorwayFor(room, 'acct_real');
    owner.send('command', install());
    await owner.waitForMessage('commandResult');
    const stranger = await at(room, 'acct_forger');

    stranger.send(
      'command',
      command({ type: 'setDoorAccess', targetAccountId: 'acct_forger', granted: true, ...DOORWAY }),
    );
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');

    owner.leave();
    stranger.leave();
  });
});

/**
 * GDD section 10: "The owner can grant named player IDs ... building
 * permission", which is what "only a building owner or explicit builder can
 * attach to its grid" means by explicit builder.
 */
describe('WorldRoom build permission (T11, GDD section 10)', () => {
  it('lets a named builder attach to the owners grid', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await at(room, 'acct_boss');
    room.grantForTest('acct_boss', 'wood_foundation', 1);
    owner.send(
      'command',
      command({ type: 'placeBuildingPiece', definitionId: 'wood_foundation', form: 'foundation', storey: 0, i: CELL.i, k: CELL.k, axis: null }),
    );
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    const hand = await at(room, 'acct_hand');
    room.grantForTest('acct_hand', 'wood_pillar', 1);
    // Refused before the grant...
    hand.send(
      'command',
      command({ type: 'placeBuildingPiece', definitionId: 'wood_pillar', form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null }),
    );
    expect((await hand.waitForMessage('commandResult')).reasonCode).toBe('forbidden');

    owner.send('command', command({ type: 'setBuildAccess', targetAccountId: 'acct_hand', granted: true }));
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    // ...and allowed after it.
    hand.send(
      'command',
      command({ type: 'placeBuildingPiece', definitionId: 'wood_pillar', form: 'pillar', storey: 0, i: CELL.i, k: CELL.k, axis: null }),
    );
    const result = await hand.waitForMessage('commandResult');
    expect(result.accepted, result.reasonCode).toBe(true);
    // The piece belongs to the building, but it is still the hand who put it
    // up -- section 10 grants permission, not ownership.
    expect(room.state.buildingPieces.size).toBe(2);

    owner.leave();
    hand.leave();
  });

  it('does not let build permission open a door', async () => {
    // Section 10 grants door access "and, separately, building permission";
    // one is not the other.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await doorwayFor(room, 'acct_sep');
    owner.send('command', install());
    await owner.waitForMessage('commandResult');
    const hand = await at(room, 'acct_labour');
    owner.send('command', command({ type: 'setBuildAccess', targetAccountId: 'acct_labour', granted: true }));
    await owner.waitForMessage('commandResult');

    hand.send('command', operate(true));
    const result = await hand.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');

    owner.leave();
    hand.leave();
  });
});
