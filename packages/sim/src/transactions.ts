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
  // sessionEpoch/sequence must be safe integers: beyond Number.MAX_SAFE_INTEGER,
  // distinct float64 values can round to the same representation, which would
  // let a forged large sequence collide with a different one under this key.
  if (!Number.isSafeInteger(key.sessionEpoch) || !Number.isSafeInteger(key.sequence)) {
    throw new RangeError('transaction key requires safe-integer sessionEpoch and sequence');
  }
  // JSON-encode rather than delimiter-join so an accountId containing the
  // delimiter itself cannot be crafted to collide with a different tuple.
  return JSON.stringify([key.accountId, key.sessionEpoch, key.sequence]);
}

/**
 * Commits an outcome for a transaction key exactly once. `computeOutcome`
 * is a lazy factory rather than a plain value: on a duplicate sequence
 * (retry after a client timeout, or a forced-replay after crash recovery)
 * it is never invoked, so a side-effecting resolver (granting an item,
 * mutating world state) cannot run twice. The stored outcome is returned
 * instead (TECHNICAL section 2: "Retries return the stored outcome, not
 * another item"). Uses `has` rather than an `undefined` check so a
 * legitimately committed `undefined` outcome cannot fail open into a
 * reprocess.
 */
export function commitOutcome<TOutcome>(
  log: TransactionLog<TOutcome>,
  key: TransactionKey,
  computeOutcome: () => TOutcome,
): TOutcome {
  const k = transactionKeyString(key);
  if (log.committed.has(k)) {
    return log.committed.get(k) as TOutcome;
  }
  const outcome = computeOutcome();
  log.committed.set(k, outcome);
  return outcome;
}
