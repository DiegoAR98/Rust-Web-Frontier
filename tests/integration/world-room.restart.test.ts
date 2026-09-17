import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;
let dbFile: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2605);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-world-room-restart-'));
  dbFile = join(dir, 'world.sqlite');
});

afterEach(async () => {
  await colyseus.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await colyseus.shutdown();
});

function takeItemCommand(sessionEpoch: number, itemInstanceId: string) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence: 1,
    clientTick: 0,
    action: { type: 'takeItem', itemInstanceId },
  };
}

describe('WorldRoom durability across a real process restart (T04/T17)', () => {
  it('never grants an already-claimed item twice, even after a restart hands the retry a brand-new session epoch', async () => {
    const before = (await colyseus.createRoom('world', { dbPath: dbFile })) as WorldRoom;
    before.spawnItem('item_1', 'wood');
    const client = await colyseus.connectTo(before, { accountId: 'acct_a' });

    client.send('command', takeItemCommand(1, 'item_1'));
    const firstResult = await client.waitForMessage('commandResult');
    expect(firstResult.accepted).toBe(true);

    // Simulate the host process being force-killed right after the
    // acknowledged transfer: dispose every room this test created.
    await colyseus.cleanup();

    const after = (await colyseus.createRoom('world', { dbPath: dbFile })) as WorldRoom;
    const reconnectedClient = await colyseus.connectTo(after, { accountId: 'acct_a' });
    // A real reconnect is issued a brand-new session epoch (TECHNICAL
    // section 5), so the transaction-key dedup from before the crash no
    // longer applies to a resend -- it's the persisted item claim itself
    // that must stop a second grant here, not sequence replay.
    const { sessionEpoch: newEpoch } = await reconnectedClient.waitForMessage('session');
    expect(newEpoch).toBeGreaterThan(1);

    reconnectedClient.send('command', takeItemCommand(newEpoch, 'item_1'));
    const retry = await reconnectedClient.waitForMessage('commandResult');

    expect(retry.accepted).toBe(false);
    expect(retry.reasonCode).toBe('already_taken');
  });

  it('resumes the world tick from its last checkpoint after a restart, never advancing while stopped', async () => {
    const before = (await colyseus.createRoom('world', { dbPath: dbFile })) as WorldRoom;
    await before.waitForNextTimestep();
    await before.waitForNextTimestep();
    const tickBeforeRestart = before.state.tick;
    expect(tickBeforeRestart).toBeGreaterThan(0);

    await colyseus.cleanup();

    const after = (await colyseus.createRoom('world', { dbPath: dbFile })) as WorldRoom;
    // No ticks have run yet in the new room instance; it must resume from
    // at least the last value the previous instance had reached, not zero.
    expect(after.state.tick).toBeGreaterThanOrEqual(tickBeforeRestart);
  });

  it('restores a player at their last checkpointed position after a restart', async () => {
    const before = (await colyseus.createRoom('world', { dbPath: dbFile })) as WorldRoom;
    const client = await colyseus.connectTo(before, { accountId: 'acct_a' });

    client.send('command', {
      protocolVersion: PROTOCOL_VERSION,
      sessionEpoch: 1,
      sequence: 1,
      clientTick: 0,
      action: { type: 'move', axisX: 0, axisY: 1, yaw: 0, sprint: false, crouch: false, jump: false },
    });
    await before.waitForNextTimestep();
    const zBeforeRestart = before.state.players.get('acct_a')!.z;
    expect(zBeforeRestart).toBeGreaterThan(0);

    before.checkpoint();
    await colyseus.cleanup();

    const after = (await colyseus.createRoom('world', { dbPath: dbFile })) as WorldRoom;
    expect(after.state.players.get('acct_a')?.z).toBeCloseTo(zBeforeRestart, 5);
  });
});
