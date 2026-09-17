import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2624);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-status-'));
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
 * Health is checkpointed, so if the wound draining it is not, stopping the
 * host is a free heal. GDD section 12 also has a sleeper's "existing bleeding,
 * poison and exposure finish under normal rules", which a wipe-on-restart is
 * not.
 */
describe('WorldRoom status effects across a restart (T17, GDD section 12)', () => {
  it('still owes the player their bleeding and poisoning afterwards', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_wounded' });
    await client.waitForMessage('session');
    first.woundForTestSet('acct_wounded', { ratePerS: 0.5, remainingS: 7 });
    first.poisonForTestSet('acct_wounded', { ratePerS: 0.5, remainingS: 13 });
    first.checkpoint();

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;

    expect(second.woundForTest('acct_wounded')).toEqual({ ratePerS: 0.5, remainingS: 7 });
    expect(second.poisonForTest('acct_wounded')).toEqual({ ratePerS: 0.5, remainingS: 13 });
  });

  it('does not resurrect a wound that had already closed', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_healed' });
    await client.waitForMessage('session');
    first.woundForTestSet('acct_healed', { ratePerS: 0.5, remainingS: 1 });
    first.checkpoint();
    first.advanceBleedForTest(2); // it runs out
    first.checkpoint();

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    expect(second.woundForTest('acct_healed')).toBeNull();
  });
});
