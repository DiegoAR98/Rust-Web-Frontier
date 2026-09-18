import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldStore } from '@rwf/server/persistence';

let dir: string;
let dbFile: string;

/** An arbitrary non-origin position, so a dropped coordinate can't pass as 0. */
const POS = { x: 2, y: 0.5, z: -3 };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-world-store-'));
  dbFile = join(dir, 'world.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('WorldStore fresh deployment', () => {
  it('creates its parent directory when it does not exist yet', () => {
    const nestedPath = join(dir, 'nested', 'does', 'not', 'exist', 'world.sqlite');

    const store = new WorldStore(nestedPath);
    store.saveWorldTick(1);
    store.close();

    const reopened = new WorldStore(nestedPath);
    const tick = reopened.loadWorldTick();
    reopened.close();

    expect(tick).toBe(1);
  });
});

describe('WorldStore transaction durability (T04)', () => {
  it('restores a committed outcome once after a simulated crash, never recomputing it', () => {
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };

    const before = new WorldStore(dbFile);
    const first = before.commitOutcome(key, () => 'granted-wood');
    before.close(); // simulates the process being force-killed right after commit

    const after = new WorldStore(dbFile);
    const replay = after.commitOutcome(key, () => 'granted-stone');
    after.close();

    expect(first).toBe('granted-wood');
    expect(replay).toBe('granted-wood');
  });

  it('never invokes the compute function for a duplicate sequence, even within the same process', () => {
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };
    const store = new WorldStore(dbFile);
    const compute = vi.fn(() => 'granted-wood');

    store.commitOutcome(key, compute);
    store.commitOutcome(key, compute);
    store.close();

    expect(compute).toHaveBeenCalledTimes(1);
  });
});

describe('WorldStore commit atomicity', () => {
  it('rolls back the resolver\'s own writes when it fails partway', () => {
    const store = new WorldStore(dbFile);
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };

    // A real resolver commits several statements: resolveHitNode does
    // saveNodeState then savePlayerSlots. If the process dies between them,
    // the node has permanently lost budget that no player ever received.
    expect(() =>
      store.commitOutcome(key, () => {
        store.saveNodeState('node_1', 'wood', 90, 10, POS);
        throw new Error('host died between the resolver\'s two writes');
      }),
    ).toThrow();

    expect(store.loadNodeStates().size).toBe(0);
    store.close();
  });

  it('leaves no log row behind for a failed commit, so the command can be retried', () => {
    const store = new WorldStore(dbFile);
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };

    expect(() =>
      store.commitOutcome(key, () => {
        throw new Error('resolver failed');
      }),
    ).toThrow();

    // A half-written commit must not masquerade as already done.
    expect(store.commitOutcome(key, () => 'retried')).toBe('retried');
    store.close();
  });

  it('still records a successful commit exactly once', () => {
    // Guards against a rollback so eager it also discards good commits.
    const store = new WorldStore(dbFile);
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };

    expect(store.commitOutcome(key, () => 'first')).toBe('first');
    expect(store.commitOutcome(key, () => 'second')).toBe('first');
    store.close();
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

describe('WorldStore player transform checkpoints (T04/T17 continuous state)', () => {
  it('restores a player at their last checkpointed transform after a restart', () => {
    const before = new WorldStore(dbFile);
    before.savePlayerCheckpoint('acct_1', { x: 1.5, y: 0, z: 9.25, yaw: 1.2, grounded: true });
    before.close();

    const after = new WorldStore(dbFile);
    const checkpoints = after.loadPlayerCheckpoints();
    after.close();

    expect(checkpoints.get('acct_1')).toEqual({ x: 1.5, y: 0, z: 9.25, yaw: 1.2, grounded: true });
  });

  it('overwrites a player\'s prior checkpoint rather than accumulating history', () => {
    const store = new WorldStore(dbFile);
    store.savePlayerCheckpoint('acct_1', { x: 0, y: 0, z: 0, yaw: 0, grounded: true });
    store.savePlayerCheckpoint('acct_1', { x: 10, y: 0, z: 0, yaw: 0, grounded: false });

    const checkpoints = store.loadPlayerCheckpoints();
    store.close();

    expect(checkpoints.size).toBe(1);
    expect(checkpoints.get('acct_1')).toEqual({ x: 10, y: 0, z: 0, yaw: 0, grounded: false });
  });

  it('returns no checkpoints for a brand-new world', () => {
    const store = new WorldStore(dbFile);
    const checkpoints = store.loadPlayerCheckpoints();
    store.close();

    expect(checkpoints.size).toBe(0);
  });
});

describe('WorldStore item claim durability (T04)', () => {
  it('restores an unclaimed spawned item after a restart', () => {
    const before = new WorldStore(dbFile);
    before.saveItemClaim('item_1', 'wood', null, POS);
    before.close();

    const after = new WorldStore(dbFile);
    const items = after.loadItemClaims();
    after.close();

    expect(items.get('item_1')).toEqual({ definitionId: 'wood', claimedBy: null, position: POS });
  });

  it('restores an already-claimed item as claimed, so a retried take cannot grant it twice', () => {
    const before = new WorldStore(dbFile);
    before.saveItemClaim('item_1', 'wood', null, POS);
    before.saveItemClaim('item_1', 'wood', 'acct_a', POS);
    before.close();

    const after = new WorldStore(dbFile);
    const items = after.loadItemClaims();
    after.close();

    expect(items.get('item_1')).toEqual({ definitionId: 'wood', claimedBy: 'acct_a', position: POS });
  });
});

describe('WorldStore resource node durability (T03 conservation across a restart)', () => {
  it('restores a node at its last saved remaining budget', () => {
    const before = new WorldStore(dbFile);
    before.saveNodeState('node_1', 'wood', 40, 10, POS);
    before.close();

    const after = new WorldStore(dbFile);
    const nodes = after.loadNodeStates();
    after.close();

    expect(nodes.get('node_1')).toEqual({ definitionId: 'wood', remaining: 40, yieldPerHit: 10, position: POS });
  });

  it('overwrites the remaining budget rather than accumulating history', () => {
    const store = new WorldStore(dbFile);
    store.saveNodeState('node_1', 'wood', 150, 10, POS);
    store.saveNodeState('node_1', 'wood', 100, 10, POS);

    const nodes = store.loadNodeStates();
    store.close();

    expect(nodes.get('node_1')?.remaining).toBe(100);
  });
});

describe('WorldStore player inventory durability', () => {
  it('restores a private inventory at its last saved contents', () => {
    const before = new WorldStore(dbFile);
    before.savePlayerSlots('acct_a', [{ definitionId: 'wood', quantity: 40 }, null, { definitionId: 'stone', quantity: 5 }]);
    before.close();

    const after = new WorldStore(dbFile);
    const slots = after.loadPlayerSlots('acct_a', 3);
    after.close();

    expect(slots).toEqual([{ definitionId: 'wood', quantity: 40 }, null, { definitionId: 'stone', quantity: 5 }]);
  });

  it('returns an all-empty inventory for an account with no saved slots', () => {
    const store = new WorldStore(dbFile);
    const slots = store.loadPlayerSlots('acct_new', 4);
    store.close();

    expect(slots).toEqual([null, null, null, null]);
  });

  it('replaces the full saved set on each save rather than merging with the previous one', () => {
    const store = new WorldStore(dbFile);
    store.savePlayerSlots('acct_a', [{ definitionId: 'wood', quantity: 10 }, { definitionId: 'stone', quantity: 5 }]);
    store.savePlayerSlots('acct_a', [null, { definitionId: 'stone', quantity: 5 }]);

    const slots = store.loadPlayerSlots('acct_a', 2);
    store.close();

    expect(slots).toEqual([null, { definitionId: 'stone', quantity: 5 }]);
  });
});

describe('WorldStore player vitals checkpoints (survival continuous state)', () => {
  it('restores a player at their last checkpointed calories, health and exposure', () => {
    const before = new WorldStore(dbFile);
    before.savePlayerVitals('acct_a', { calories: 1185, health: 100, exposure: 25 });
    before.close();

    const after = new WorldStore(dbFile);
    const vitals = after.loadPlayerVitals();
    after.close();

    expect(vitals.get('acct_a')).toEqual({ calories: 1185, health: 100, exposure: 25 });
  });

  it('overwrites the prior checkpoint rather than accumulating history', () => {
    const store = new WorldStore(dbFile);
    store.savePlayerVitals('acct_a', { calories: 1200, health: 100, exposure: 0 });
    store.savePlayerVitals('acct_a', { calories: 1185, health: 95, exposure: 10 });

    const vitals = store.loadPlayerVitals();
    store.close();

    expect(vitals.size).toBe(1);
    expect(vitals.get('acct_a')).toEqual({ calories: 1185, health: 95, exposure: 10 });
  });

  it('returns no vitals for a brand-new world', () => {
    const store = new WorldStore(dbFile);
    const vitals = store.loadPlayerVitals();
    store.close();

    expect(vitals.size).toBe(0);
  });
});

/**
 * TECHNICAL section 7 keeps a committed outcome so a duplicate command replays
 * it (T02, T04). Nothing ever removed one, so the table grew for the life of
 * the world -- every command from every session that ever connected, including
 * the refused ones, each of them an fsync on the game loop and a row kept
 * forever.
 */
describe('pruning the replay log', () => {
  it('drops outcomes from sessions that can no longer act, and keeps the live one', () => {
    const store = new WorldStore(':memory:');
    const epochOne = store.beginSession('acct_prune');
    store.commitOutcome({ accountId: 'acct_prune', sessionEpoch: epochOne, sequence: 1 }, () => 'old');
    expect(store.loadOutcome({ accountId: 'acct_prune', sessionEpoch: epochOne, sequence: 1 })).toBe('old');

    // A reconnect. A command carrying the old epoch is refused as stale before
    // it can ever reach its outcome, so that row is unreachable from here on.
    const epochTwo = store.beginSession('acct_prune');
    store.commitOutcome({ accountId: 'acct_prune', sessionEpoch: epochTwo, sequence: 1 }, () => 'new');

    expect(store.loadOutcome({ accountId: 'acct_prune', sessionEpoch: epochOne, sequence: 1 })).toBeUndefined();
    expect(store.loadOutcome({ accountId: 'acct_prune', sessionEpoch: epochTwo, sequence: 1 })).toBe('new');
  });

  it('leaves another account rows alone', () => {
    const store = new WorldStore(':memory:');
    const mine = store.beginSession('acct_mine');
    store.commitOutcome({ accountId: 'acct_mine', sessionEpoch: mine, sequence: 1 }, () => 'mine');
    const theirs = store.beginSession('acct_theirs');
    store.commitOutcome({ accountId: 'acct_theirs', sessionEpoch: theirs, sequence: 1 }, () => 'theirs');

    store.beginSession('acct_theirs');

    expect(store.loadOutcome({ accountId: 'acct_mine', sessionEpoch: mine, sequence: 1 })).toBe('mine');
  });
});
