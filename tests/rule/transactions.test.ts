import { describe, expect, it } from 'vitest';
import {
  beginSession,
  commitOutcome,
  isSessionActive,
  type SessionRegistry,
  type TransactionLog,
} from '@rwf/sim';

describe('session epochs', () => {
  it('issues an increasing epoch each time an account starts a new session', () => {
    const registry: SessionRegistry = { currentEpoch: new Map() };

    const first = beginSession(registry, 'acct_1');
    const second = beginSession(registry, 'acct_1');

    expect(second).toBeGreaterThan(first);
  });

  it('tracks epochs independently per account', () => {
    const registry: SessionRegistry = { currentEpoch: new Map() };

    const a = beginSession(registry, 'acct_1');
    const b = beginSession(registry, 'acct_2');

    expect(isSessionActive(registry, 'acct_1', a)).toBe(true);
    expect(isSessionActive(registry, 'acct_2', b)).toBe(true);
  });

  it('rejects a stale epoch after reconnect replaces it, so a delayed old packet cannot act', () => {
    const registry: SessionRegistry = { currentEpoch: new Map() };

    const oldEpoch = beginSession(registry, 'acct_1');
    beginSession(registry, 'acct_1'); // reconnect

    expect(isSessionActive(registry, 'acct_1', oldEpoch)).toBe(false);
  });
});

describe('transaction outcome log', () => {
  it('commits a new outcome for a fresh transaction key', () => {
    const log: TransactionLog<string> = { committed: new Map() };

    const outcome = commitOutcome(log, { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 }, 'granted-wood');

    expect(outcome).toBe('granted-wood');
  });

  it('replays the original outcome on a duplicate sequence instead of recomputing', () => {
    const log: TransactionLog<string> = { committed: new Map() };
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };

    commitOutcome(log, key, 'granted-wood');
    const replay = commitOutcome(log, key, 'granted-stone');

    expect(replay).toBe('granted-wood');
  });

  it('distinguishes transaction keys by sequence, session epoch and account', () => {
    const log: TransactionLog<string> = { committed: new Map() };

    commitOutcome(log, { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 }, 'a');
    const other = commitOutcome(log, { accountId: 'acct_1', sessionEpoch: 2, sequence: 1 }, 'b');

    expect(other).toBe('b');
  });

  it('does not fail open when a legitimately committed outcome is the value undefined', () => {
    const log: TransactionLog<string | undefined> = { committed: new Map() };
    const key = { accountId: 'acct_1', sessionEpoch: 1, sequence: 1 };

    commitOutcome(log, key, undefined);
    const replay = commitOutcome(log, key, 'granted-wood');

    expect(replay).toBeUndefined();
  });

  it('rejects a sessionEpoch or sequence outside the float64 safe-integer range instead of risking a key collision', () => {
    const log: TransactionLog<string> = { committed: new Map() };
    const unsafe = { accountId: 'acct_1', sessionEpoch: 1, sequence: Number.MAX_SAFE_INTEGER + 2 };

    expect(() => commitOutcome(log, unsafe, 'a')).toThrow();
  });
});
