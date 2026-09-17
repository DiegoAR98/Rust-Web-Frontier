import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { TransactionKey } from '@rwf/sim';

interface SessionRow {
  epoch: number;
}

interface TransactionRow {
  outcome: string;
}

interface WorldClockRow {
  tick: number;
}

export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  grounded: boolean;
}

interface PlayerCheckpointRow {
  account_id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  grounded: number;
}

export interface ItemClaim {
  definitionId: string;
  claimedBy: string | null;
}

interface ItemClaimRow {
  instance_id: string;
  definition_id: string;
  claimed_by: string | null;
}

/**
 * Durable backing store for session epochs, committed transaction outcomes
 * and the world tick counter (TECHNICAL section 7). A single writer opens
 * this file; every mutation here is a plain synchronous SQLite statement,
 * so a commit either lands durably or the process never observed success.
 */
export class WorldStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    if (filename !== ':memory:') {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        account_id TEXT PRIMARY KEY,
        epoch INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transactions (
        account_id TEXT NOT NULL,
        session_epoch INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        PRIMARY KEY (account_id, session_epoch, sequence)
      );
      CREATE TABLE IF NOT EXISTS world_clock (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tick INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_checkpoints (
        account_id TEXT PRIMARY KEY,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        yaw REAL NOT NULL,
        grounded INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS item_claims (
        instance_id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        claimed_by TEXT
      );
    `);
  }

  beginSession(accountId: string): number {
    const row = this.db
      .prepare('SELECT epoch FROM sessions WHERE account_id = ?')
      .get(accountId) as SessionRow | undefined;
    const next = (row?.epoch ?? 0) + 1;
    this.db
      .prepare(
        `INSERT INTO sessions (account_id, epoch) VALUES (?, ?)
         ON CONFLICT(account_id) DO UPDATE SET epoch = excluded.epoch`,
      )
      .run(accountId, next);
    return next;
  }

  isSessionActive(accountId: string, sessionEpoch: number): boolean {
    const row = this.db
      .prepare('SELECT epoch FROM sessions WHERE account_id = ?')
      .get(accountId) as SessionRow | undefined;
    return row?.epoch === sessionEpoch;
  }

  /**
   * `computeOutcome` is a lazy factory: on a duplicate sequence it is never
   * invoked, so a side-effecting resolver cannot run twice (mirrors
   * @rwf/sim's commitOutcome contract).
   */
  commitOutcome(key: TransactionKey, computeOutcome: () => string): string {
    if (!Number.isSafeInteger(key.sessionEpoch) || !Number.isSafeInteger(key.sequence)) {
      throw new RangeError('transaction key requires safe-integer sessionEpoch and sequence');
    }
    const existing = this.db
      .prepare(
        'SELECT outcome FROM transactions WHERE account_id = ? AND session_epoch = ? AND sequence = ?',
      )
      .get(key.accountId, key.sessionEpoch, key.sequence) as TransactionRow | undefined;
    if (existing) {
      return existing.outcome;
    }
    const outcome = computeOutcome();
    this.db
      .prepare(
        'INSERT INTO transactions (account_id, session_epoch, sequence, outcome) VALUES (?, ?, ?, ?)',
      )
      .run(key.accountId, key.sessionEpoch, key.sequence, outcome);
    return outcome;
  }

  /** Persists the simulation's own tick counter. Never derived from wall-clock time. */
  saveWorldTick(tick: number): void {
    this.db
      .prepare(
        `INSERT INTO world_clock (id, tick) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET tick = excluded.tick`,
      )
      .run(tick);
  }

  /** Resumes at exactly the last persisted tick; downtime is discarded, never caught up. */
  loadWorldTick(): number {
    const row = this.db.prepare('SELECT tick FROM world_clock WHERE id = 1').get() as
      | WorldClockRow
      | undefined;
    return row?.tick ?? 0;
  }

  /**
   * Continuous-state checkpoint for one player's transform (TECHNICAL
   * section 7: "checkpoint every 5 seconds, without overwriting newer
   * committed transaction state"). Overwrites in place -- this is a
   * rolling checkpoint, not a history log.
   */
  savePlayerCheckpoint(accountId: string, transform: PlayerTransform): void {
    this.db
      .prepare(
        `INSERT INTO player_checkpoints (account_id, x, y, z, yaw, grounded) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           x = excluded.x, y = excluded.y, z = excluded.z,
           yaw = excluded.yaw, grounded = excluded.grounded`,
      )
      .run(accountId, transform.x, transform.y, transform.z, transform.yaw, transform.grounded ? 1 : 0);
  }

  loadPlayerCheckpoints(): Map<string, PlayerTransform> {
    const rows = this.db
      .prepare('SELECT account_id, x, y, z, yaw, grounded FROM player_checkpoints')
      .all() as PlayerCheckpointRow[];
    const result = new Map<string, PlayerTransform>();
    for (const row of rows) {
      result.set(row.account_id, {
        x: row.x,
        y: row.y,
        z: row.z,
        yaw: row.yaw,
        grounded: row.grounded === 1,
      });
    }
    return result;
  }

  /**
   * Persists an item's existence and current claim atomically at commit
   * time (a class-1 committed transaction per TECHNICAL section 7, not a
   * periodic checkpoint): a reconnect issues a new session epoch, so the
   * transaction-key dedup alone cannot catch a resent "take item" command
   * after a restart. The underlying claim state itself must survive.
   */
  saveItemClaim(instanceId: string, definitionId: string, claimedBy: string | null): void {
    this.db
      .prepare(
        `INSERT INTO item_claims (instance_id, definition_id, claimed_by) VALUES (?, ?, ?)
         ON CONFLICT(instance_id) DO UPDATE SET
           definition_id = excluded.definition_id, claimed_by = excluded.claimed_by`,
      )
      .run(instanceId, definitionId, claimedBy);
  }

  loadItemClaims(): Map<string, ItemClaim> {
    const rows = this.db
      .prepare('SELECT instance_id, definition_id, claimed_by FROM item_claims')
      .all() as ItemClaimRow[];
    const result = new Map<string, ItemClaim>();
    for (const row of rows) {
      result.set(row.instance_id, { definitionId: row.definition_id, claimedBy: row.claimed_by });
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}
