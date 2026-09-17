import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorldStore } from '@rwf/server/persistence';

let dir: string;
let dbFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-world-store-'));
  dbFile = join(dir, 'world.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('WorldStore transaction durability (T04)', () => {
  it('restores a committed outcome once after a simulated crash, never recomputing it', () => {
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };

    const before = new WorldStore(dbFile);
    const first = before.commitOutcome(key, 'granted-wood');
    before.close(); // simulates the process being force-killed right after commit

    const after = new WorldStore(dbFile);
    const replay = after.commitOutcome(key, 'granted-stone');
    after.close();

    expect(first).toBe('granted-wood');
    expect(replay).toBe('granted-wood');
  });
});

describe('WorldStore session durability', () => {
  it('keeps the session epoch counter durable across a restart, so a pre-crash old session stays stale', () => {
    const before = new WorldStore(dbFile);
    const oldEpoch = before.beginSession('acct_1');
    before.close();

    const after = new WorldStore(dbFile);
    const newEpoch = after.beginSession('acct_1'); // reconnect after the crash
    const oldStillActive = after.isSessionActive('acct_1', oldEpoch);
    after.close();

    expect(newEpoch).toBeGreaterThan(oldEpoch);
    expect(oldStillActive).toBe(false);
  });
});

describe('WorldStore world clock freeze (T17)', () => {
  it('resumes from the exact persisted tick after a restart, with no wall-clock catch-up', () => {
    const before = new WorldStore(dbFile);
    before.saveWorldTick(100);
    before.close();

    // A real stopped host could sit here for hours; nothing in WorldStore
    // consults wall-clock time, so no elapsed real time can be converted
    // into simulated ticks.
    const after = new WorldStore(dbFile);
    const resumedTick = after.loadWorldTick();
    after.close();

    expect(resumedTick).toBe(100);
  });

  it('starts a brand-new world at tick zero', () => {
    const store = new WorldStore(dbFile);
    const tick = store.loadWorldTick();
    store.close();

    expect(tick).toBe(0);
  });
});
