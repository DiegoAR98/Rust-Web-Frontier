import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { WorldStore } from '@rwf/server/persistence';
import type { WorldRoom } from '@rwf/server/world-room';

function moveForwardCommand(sequence: number) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence,
    clientTick: 0,
    action: { type: 'move', axisX: 0, axisY: 1, yaw: 0, sprint: false, crouch: false, jump: false },
  };
}

let colyseus: ColyseusTestServer;
let dir: string;
let dbFile: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2605);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-world-room-restart-'));
  dbFile = join(dir, 'world.sqlite');
  // dbPath is deliberately NOT a room-creation option (see world-room.ts):
  // it must never be reachable from a real client's join/create call, so
  // tests select it the same way the server process does, via env var.
  process.env.RWF_DB_PATH = dbFile;
});

afterEach(async () => {
  await colyseus.cleanup();
  delete process.env.RWF_DB_PATH;
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
    const before = (await colyseus.createRoom('world', {})) as WorldRoom;
    before.spawnItem('item_1', 'wood');
    const client = await colyseus.connectTo(before, { accountId: 'acct_a' });

    client.send('command', takeItemCommand(1, 'item_1'));
    const firstResult = await client.waitForMessage('commandResult');
    expect(firstResult.accepted).toBe(true);

    // Simulate the host process being force-killed right after the
    // acknowledged transfer: dispose every room this test created.
    await colyseus.cleanup();

    const after = (await colyseus.createRoom('world', {})) as WorldRoom;
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
    const before = (await colyseus.createRoom('world', {})) as WorldRoom;
    await before.waitForNextTimestep();
    await before.waitForNextTimestep();
    const tickBeforeRestart = before.state.tick;
    expect(tickBeforeRestart).toBeGreaterThan(0);

    await colyseus.cleanup();

    // Anchor on what was actually persisted, not on the reading above: the old
    // room keeps ticking between that read and its disposal, so
    // tickBeforeRestart is already stale by an unpredictable amount.
    const store = new WorldStore(dbFile);
    const persistedTick = store.loadWorldTick();
    store.close();
    expect(persistedTick).toBeGreaterThanOrEqual(tickBeforeRestart);

    const after = (await colyseus.createRoom('world', {})) as WorldRoom;
    // Resumes from the checkpoint rather than zero...
    expect(after.state.tick).toBeGreaterThanOrEqual(persistedTick);
    // ...and does not catch up the downtime. A lower bound alone cannot prove
    // the "never advancing while stopped" half of this test's name: it stays
    // green even if onCreate derived the tick from wall-clock elapsed time,
    // which is precisely the T17 defect it exists to catch. The small
    // allowance covers ticks the new room runs before this line executes.
    expect(after.state.tick).toBeLessThanOrEqual(persistedTick + 3);
  });

  it('restores a player at their last checkpointed position after a restart', async () => {
    const before = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(before, { accountId: 'acct_a' });

    client.send('command', moveForwardCommand(1));
    await before.waitForNextTimestep();
    const zAtCheckpoint = before.state.players.get('acct_a')!.z;
    expect(zAtCheckpoint).toBeGreaterThan(0);

    before.checkpoint();
    await colyseus.cleanup();

    const after = (await colyseus.createRoom('world', {})) as WorldRoom;
    expect(after.state.players.get('acct_a')?.z).toBeCloseTo(zAtCheckpoint, 5);
  });

  it('tolerates only bounded staleness between checkpoints, never an exact live mirror (TECHNICAL section 7)', async () => {
    // Proves the ACTUAL promise -- "checkpoint every 5 seconds... can roll
    // back up to 5 s on hard failure" -- rather than relying on
    // colyseus.cleanup()'s graceful dispose, which always runs one more
    // checkpoint on its way out and would make an ungraceful crash
    // indistinguishable from a clean shutdown in this test harness.
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(room, { accountId: 'acct_a' });

    client.send('command', moveForwardCommand(1));
    await room.waitForNextTimestep();
    room.checkpoint(); // the periodic 5s checkpoint that already ran
    const zAtCheckpoint = room.state.players.get('acct_a')!.z;

    client.send('command', moveForwardCommand(2));
    await room.waitForNextTimestep(); // moves further, but no checkpoint yet
    const zLive = room.state.players.get('acct_a')!.z;
    expect(zLive).toBeGreaterThan(zAtCheckpoint);

    // Read the durable state through a SEPARATE connection while the room
    // is still running (no dispose involved): this is exactly what a
    // crash-restart would see, since the room process never got to run
    // another checkpoint before the failure.
    const peek = new WorldStore(dbFile);
    const onDisk = peek.loadPlayerCheckpoints().get('acct_a');
    peek.close();

    expect(onDisk?.z).toBeCloseTo(zAtCheckpoint, 5);
    expect(onDisk?.z).not.toBeCloseTo(zLive, 5);
  });
});
