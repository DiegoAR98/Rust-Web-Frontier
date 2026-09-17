import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CALORIE_SPAWN, HEALTH_MAX } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2623);
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

/** CONTENT section 1: "cooked_meat ... +400 calories, +5 health". */
describe('WorldRoom eating (GDD section 6)', () => {
  it('feeds a player who finishes the channel, and spends one', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_eat' });
    await client.waitForMessage('session');
    room.grantForTest('acct_eat', 'cooked_meat', 2);
    room.setVitalsForTest('acct_eat', { calories: 500, health: 50, exposure: 0 });

    client.send('command', use('cooked_meat'));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    room.advanceChannelsForTest(1);

    expect(room.vitalsForTest('acct_eat')!.calories).toBeGreaterThanOrEqual(899);
    expect(room.vitalsForTest('acct_eat')!.health).toBeGreaterThanOrEqual(55);
    expect(room.countForTest('acct_eat', 'cooked_meat')).toBe(1);

    client.leave();
  });

  it('never feeds a player past the calorie ceiling', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_full' });
    await client.waitForMessage('session');
    room.grantForTest('acct_full', 'cooked_meat', 1);
    room.setVitalsForTest('acct_full', { calories: 2900, health: 100, exposure: 0 });

    client.send('command', use('cooked_meat'));
    await client.waitForMessage('commandResult');
    room.advanceChannelsForTest(1);

    expect(room.vitalsForTest('acct_full')!.calories).toBeLessThanOrEqual(3000);
    expect(room.vitalsForTest('acct_full')!.health).toBe(HEALTH_MAX);

    client.leave();
  });

  it('makes raw meat a bad meal rather than an impossible one', async () => {
    // GDD section 6: "Eating raw meat always applies 20 seconds of sickness at
    // 0.5 HP/s, blocks regeneration and gives only 50 calories."
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_raw' });
    await client.waitForMessage('session');
    room.grantForTest('acct_raw', 'raw_meat', 1);
    room.setVitalsForTest('acct_raw', { calories: 500, health: 100, exposure: 0 });

    client.send('command', use('raw_meat'));
    await client.waitForMessage('commandResult');
    room.advanceChannelsForTest(1);

    expect(room.vitalsForTest('acct_raw')!.calories).toBeGreaterThanOrEqual(549);
    expect(room.poisonForTest('acct_raw')).toEqual({ ratePerS: 0.5, remainingS: 20 });

    const before = room.vitalsForTest('acct_raw')!.health;
    room.advanceBleedForTest(4);
    expect(before - room.vitalsForTest('acct_raw')!.health).toBeGreaterThanOrEqual(2);

    client.leave();
  });

  it('refreshes food poisoning instead of stacking it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_raw2' });
    await client.waitForMessage('session');
    room.grantForTest('acct_raw2', 'raw_meat', 2);

    client.send('command', use('raw_meat'));
    await client.waitForMessage('commandResult');
    room.advanceChannelsForTest(1);
    room.advanceBleedForTest(5);
    room.clearUseCooldownForTest('acct_raw2');

    client.send('command', use('raw_meat'));
    await client.waitForMessage('commandResult');
    room.advanceChannelsForTest(1);

    // Refreshed to 20 again, and still one wound at one rate.
    expect(room.poisonForTest('acct_raw2')!.ratePerS).toBe(0.5);
    expect(room.poisonForTest('acct_raw2')!.remainingS).toBeGreaterThan(14);

    client.leave();
  });
});

/** GDD section 6's passive regeneration, wired to real vitals. */
describe('WorldRoom regeneration (GDD section 6)', () => {
  it('heals a fed, unhurt, undisturbed player and charges calories for it', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_rest' });
    await client.waitForMessage('session');
    room.setVitalsForTest('acct_rest', { calories: 1200, health: 50, exposure: 0 });
    room.setLastDamagedTickForTest('acct_rest', -1000); // long undisturbed

    room.advanceSurvivalForTest(10);

    const vitals = room.vitalsForTest('acct_rest')!;
    expect(vitals.health).toBeGreaterThan(50);
    // 0.1 HP/s for ten seconds is 1 HP, costing 2 calories on top of the
    // 0.25/s standing drain.
    expect(vitals.health).toBeLessThanOrEqual(51.5);
    expect(vitals.calories).toBeLessThan(1200 - 2.5);

    client.leave();
  });

  it('does not heal a player who was just bitten', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_hurt' });
    await client.waitForMessage('session');
    room.setVitalsForTest('acct_hurt', { calories: 1200, health: 50, exposure: 0 });
    room.setLastDamagedTickForTest('acct_hurt', room.tickForTest());

    room.advanceSurvivalForTest(5);

    expect(room.vitalsForTest('acct_hurt')!.health).toBeLessThanOrEqual(50);

    client.leave();
  });

  it('does not heal a bleeding player', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_open' });
    await client.waitForMessage('session');
    room.setVitalsForTest('acct_open', { calories: 1200, health: 50, exposure: 0 });
    room.setLastDamagedTickForTest('acct_open', -1000);
    room.woundForTestSet('acct_open', { ratePerS: 0.5, remainingS: 30 });

    room.advanceSurvivalForTest(5);

    expect(room.vitalsForTest('acct_open')!.health).toBeLessThanOrEqual(50);

    client.leave();
  });

  it('never heals past full health', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_hale' });
    await client.waitForMessage('session');
    room.setVitalsForTest('acct_hale', { calories: 1200, health: 100, exposure: 0 });
    room.setLastDamagedTickForTest('acct_hale', -1000);

    room.advanceSurvivalForTest(30);

    expect(room.vitalsForTest('acct_hale')!.health).toBe(HEALTH_MAX);
    // And a player at full health is not quietly paying calories for healing
    // that never happened.
    expect(room.vitalsForTest('acct_hale')!.calories).toBeCloseTo(CALORIE_SPAWN - 30 * 0.25, 1);

    client.leave();
  });
});
