export interface SessionRegistry {
  currentEpoch: Map<string, number>;
}

/**
 * Starts a new session for an account, replacing any previously active
 * epoch (TECHNICAL section 5: "Reconnect replaces the older session epoch
 * after authentication, so delayed old packets cannot mutate state").
 */
export function beginSession(registry: SessionRegistry, accountId: string): number {
  const next = (registry.currentEpoch.get(accountId) ?? 0) + 1;
  registry.currentEpoch.set(accountId, next);
  return next;
}

export function isSessionActive(registry: SessionRegistry, accountId: string, sessionEpoch: number): boolean {
  return registry.currentEpoch.get(accountId) === sessionEpoch;
}

export interface TransactionKey {
  accountId: string;
  sessionEpoch: number;
  sequence: number;
}

export interface TransactionLog<TOutcome> {
  committed: Map<string, TOutcome>;
}

function transactionKeyString(key: TransactionKey): string {
  return `${key.accountId}:${key.sessionEpoch}:${key.sequence}`;
}

/**
 * Commits an outcome for a transaction key exactly once. A duplicate
 * sequence (retry after a client timeout, or a forced-replay after crash
 * recovery) returns the originally stored outcome instead of recomputing
 * or overwriting it (TECHNICAL section 2: "Retries return the stored
 * outcome, not another item").
 */
export function commitOutcome<TOutcome>(
  log: TransactionLog<TOutcome>,
  key: TransactionKey,
  outcome: TOutcome,
): TOutcome {
  const k = transactionKeyString(key);
  const existing = log.committed.get(k);
  if (existing !== undefined) {
    return existing;
  }
  log.committed.set(k, outcome);
  return outcome;
}
