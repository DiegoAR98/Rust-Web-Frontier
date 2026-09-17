import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2622);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

let sequence = 0;
function use(definitionId: string) {
  sequence += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence,
    clientTick: 0,
    action: { type: 'useItem', definitionId },
  };
}

/** GDD section 5: "A player starts with a rock, a torch and bandages." */
describe('WorldRoom spawn kit (GDD section 5)', () => {
  it('gives a brand new account a rock, a torch and two bandages', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_new' });
    await client.waitForMessage('session');

    expect(room.countForTest('acct_new', 'rock')).toBe(1);
    expect(room.countForTest('acct_new', 'torch')).toBe(1);
    expect(room.countForTest('acct_new', 'bandage')).toBe(2);

    client.leave();
  });

  it('does not hand out a second kit on reconnect', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const first = await colyseus.connectTo(room, { accountId: 'acct_again' });
    await first.waitForMessage('session');
    first.leave();

    const second = await colyseus.connectTo(room, { accountId: 'acct_again' });
    await second.waitForMessage('session');

    expect(room.countForTest('acct_again', 'bandage')).toBe(2);

    second.leave();
  });
});

/**
 * T08: "Bleed, cancel bandage by damage, then complete use -> cancel consumes
 * nothing; successful use consumes one and stops bleed; no additive bleed
 * exploit." GDD section 6: "Use channels: ... bandage 2 [seconds]. Damage,
 * sprint, death or disconnect cancels without consumption; successful
 * completion consumes one unit and applies effects atomically. A shared
 * 2-second post-use cooldown prevents instant stacked medicine."
 */
describe('WorldRoom bandage channel (T08, GDD section 6)', () => {
  it('stops the bleeding and consumes exactly one bandage', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_heal' });
    await client.waitForMessage('session');
    room.woundForTestSet('acct_heal', { ratePerS: 0.5, remainingS: 10 });

    client.send('command', use('bandage'));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(room.countForTest('acct_heal', 'bandage')).toBe(2); // nothing spent yet

    room.advanceChannelsForTest(2);

    expect(room.woundForTest('acct_heal')).toBeNull();
    expect(room.countForTest('acct_heal', 'bandage')).toBe(1);
    expect(room.channelForTest('acct_heal')).toBeUndefined();

    client.leave();
  });

  it('consumes nothing when damage interrupts it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_hit' });
    await client.waitForMessage('session');
    room.woundForTestSet('acct_hit', { ratePerS: 0.5, remainingS: 10 });

    client.send('command', use('bandage'));
    await client.waitForMessage('commandResult');
    room.advanceChannelsForTest(1); // half way

    room.damageForTest('acct_hit', 5);

    expect(room.channelForTest('acct_hit')).toBeUndefined();
    expect(room.countForTest('acct_hit', 'bandage')).toBe(2);
    // Cancelled means cancelled: the wound is still open.
    expect(room.woundForTest('acct_hit')).not.toBeNull();

    // And it is not secretly still running.
    room.advanceChannelsForTest(5);
    expect(room.countForTest('acct_hit', 'bandage')).toBe(2);

    client.leave();
  });

  it('is not cancelled by the bleeding it is meant to treat', async () => {
    // GDD's "damage cancels" has to mean incoming damage: a wound that
    // cancelled its own bandage every tick could never be treated, which is
    // the exact sequence T08 asks for.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_drip' });
    await client.waitForMessage('session');
    room.woundForTestSet('acct_drip', { ratePerS: 0.5, remainingS: 10 });

    client.send('command', use('bandage'));
    await client.waitForMessage('commandResult');
    room.advanceBleedForTest(1);
    room.advanceChannelsForTest(2);

    expect(room.countForTest('acct_drip', 'bandage')).toBe(1);
    expect(room.woundForTest('acct_drip')).toBeNull();

    client.leave();
  });

  it('consumes nothing when the player sprints away mid-use', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_run' });
    await client.waitForMessage('session');

    client.send('command', use('bandage'));
    await client.waitForMessage('commandResult');

    sequence += 1;
    client.send('command', {
      protocolVersion: PROTOCOL_VERSION,
      sessionEpoch: 1,
      sequence,
      clientTick: 0,
      action: { type: 'move', axisX: 0, axisY: 1, yaw: 0, sprint: true, crouch: false, jump: false },
    });
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();

    expect(room.channelForTest('acct_run')).toBeUndefined();
    expect(room.countForTest('acct_run', 'bandage')).toBe(2);

    client.leave();
  });

  it('consumes nothing when the player disconnects mid-use', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_gone' });
    await client.waitForMessage('session');

    client.send('command', use('bandage'));
    await client.waitForMessage('commandResult');
    await client.leave();
    await room.waitForNextTimestep();

    expect(room.channelForTest('acct_gone')).toBeUndefined();
    expect(room.countForTest('acct_gone', 'bandage')).toBe(2);
  });

  it('enforces the shared two-second post-use cooldown', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_stackmed' });
    await client.waitForMessage('session');

    client.send('command', use('bandage'));
    await client.waitForMessage('commandResult');
    room.advanceChannelsForTest(2); // completes, and starts the cooldown

    client.send('command', use('bandage'));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('rate_limited');
    expect(room.countForTest('acct_stackmed', 'bandage')).toBe(1);

    client.leave();
  });

  it('refuses a use with nothing to use', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_empty' });
    await client.waitForMessage('session');
    room.clearInventoryForTest('acct_empty');

    client.send('command', use('bandage'));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('insufficient_resources');

    client.leave();
  });

  it('refuses an item that is not usable at all', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_rock' });
    await client.waitForMessage('session');

    client.send('command', use('rock'));
    const result = await client.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('not_found');
    expect(room.countForTest('acct_rock', 'rock')).toBe(1);

    client.leave();
  });
});
