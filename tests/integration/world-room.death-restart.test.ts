import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { HEALTH_MAX } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2626);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-death-'));
  process.env.RWF_DB_PATH = join(dir, 'world.sqlite');
});

afterEach(async () => {
  await colyseus.cleanup();
  delete process.env.RWF_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await colyseus.shutdown();
});

/**
 * T04: "Force-kill process after acknowledged transfer/placement/death ->
 * Restore committed outcomes once; ... no free starter kit." A death is the
 * single largest transfer of items in the game, so a restart that half-applies
 * it either duplicates a player's whole pack or destroys it.
 */
describe('WorldRoom death across a restart (T04, GDD section 12)', () => {
  it('still owes the corpse its contents, and the account its death', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_fallen' });
    await client.waitForMessage('session');
    first.clearInventoryForTest('acct_fallen');
    first.grantForTest('acct_fallen', 'wood', 77);
    first.teleportForTest('acct_fallen', { x: 9, y: 0, z: 9 });
    first.damageForTest('acct_fallen', HEALTH_MAX);
    const corpseId = first.corpseIdForTest('acct_fallen')!;
    // Deliberately no checkpoint(): a death is class-1 and must already be on
    // disk at the commit, not at the next five-second sweep.

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;

    expect(second.isDeadForTest('acct_fallen')).toBe(true);
    expect(second.state.players.has('acct_fallen')).toBe(false);
    const corpse = second.corpseForTest(corpseId)!;
    expect(corpse.position).toEqual({ x: 9, y: 0, z: 9 });
    expect(corpse.inventory.slots.filter((s) => s !== null)).toEqual([
      { definitionId: 'wood', quantity: 77 },
    ]);
    // The pack is not restored alongside the corpse; that would be the
    // duplication T03 and T04 exist to rule out. Checked after a rejoin,
    // because that is when slots are read back off disk -- asserting before
    // it would pass on an empty map whatever the database held.
    const rejoined = await colyseus.connectTo(second, { accountId: 'acct_fallen' });
    await rejoined.waitForMessage('session');
    expect(second.countForTest('acct_fallen', 'wood')).toBe(0);
    // ...and rejoining dead does not quietly resurrect them either.
    expect(second.isDeadForTest('acct_fallen')).toBe(true);
    expect(second.state.players.has('acct_fallen')).toBe(false);

    rejoined.leave();
  });

  it('does not put a looted corpse back in the world', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const victim = await colyseus.connectTo(first, { accountId: 'acct_looted' });
    await victim.waitForMessage('session');
    first.clearInventoryForTest('acct_looted');
    first.grantForTest('acct_looted', 'wood', 40);
    first.damageForTest('acct_looted', HEALTH_MAX);
    const corpseId = first.corpseIdForTest('acct_looted')!;

    const looter = await colyseus.connectTo(first, { accountId: 'acct_taker' });
    await looter.waitForMessage('session');
    first.clearInventoryForTest('acct_taker');
    looter.send('command', {
      protocolVersion: PROTOCOL_VERSION,
      sessionEpoch: 1,
      sequence: 1,
      clientTick: 0,
      action: { type: 'corpseTake', corpseId },
    });
    expect((await looter.waitForMessage('commandResult')).accepted).toBe(true);

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;

    expect(second.corpseForTest(corpseId)).toBeUndefined();
    expect(second.state.corpses.has(corpseId)).toBe(false);

    // The looter keeps what they took, exactly once. Their pack is read back
    // off disk when they rejoin, so the check has to happen after that.
    const rejoined = await colyseus.connectTo(second, { accountId: 'acct_taker' });
    await rejoined.waitForMessage('session');
    expect(second.countForTest('acct_taker', 'wood')).toBe(40);

    rejoined.leave();
  });

  it('gives a respawned player one kit, not one per restart', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_return' });
    await client.waitForMessage('session');
    first.damageForTest('acct_return', HEALTH_MAX);
    client.send('command', {
      protocolVersion: PROTOCOL_VERSION,
      sessionEpoch: 1,
      sequence: 5,
      clientTick: 0,
      action: { type: 'respawn' },
    });
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    expect(first.countForTest('acct_return', 'bandage')).toBe(2);

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    const again = await colyseus.connectTo(second, { accountId: 'acct_return' });
    await again.waitForMessage('session');

    // Alive again, and rejoining a restarted world is not a second kit
    // (T04: "no free starter kit").
    expect(second.isDeadForTest('acct_return')).toBe(false);
    expect(second.countForTest('acct_return', 'bandage')).toBe(2);

    again.leave();
  });
});
