import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Slot, TransactionKey } from '@rwf/sim';

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

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ItemClaim {
  definitionId: string;
  claimedBy: string | null;
  position: Vec3;
}

interface ItemClaimRow {
  instance_id: string;
  definition_id: string;
  claimed_by: string | null;
  x: number;
  y: number;
  z: number;
}

export interface NodeState {
  definitionId: string;
  remaining: number;
  yieldPerHit: number;
  position: Vec3;
}

interface ResourceNodeRow {
  node_id: string;
  definition_id: string;
  remaining: number;
  yield_per_hit: number;
  x: number;
  y: number;
  z: number;
}

interface PlayerSlotRow {
  slot_index: number;
  definition_id: string;
  quantity: number;
}

export interface CraftingEntryRecord {
  recipeId: string;
  totalUnits: number;
  completedUnits: number;
  progressS: number;
}

interface CraftingQueueRow {
  account_id: string;
  recipe_id: string;
  total_units: number;
  completed_units: number;
  progress_s: number;
}

export interface PlayerVitals {
  calories: number;
  health: number;
  exposure: number;
}

interface PlayerVitalsRow {
  account_id: string;
  calories: number;
  health: number;
  exposure: number;
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
    // WAL defaults to synchronous = NORMAL, which survives a process crash but
    // not an OS crash or power loss -- weaker than what this class promises
    // below and what TECHNICAL section 7 requires of a committed transaction.
    // FULL costs an fsync per commit; at 20Hz with checkpoints every 5s that
    // is well within budget for a single-host world.
    this.db.pragma('synchronous = FULL');
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
        claimed_by TEXT,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        z REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS resource_nodes (
        node_id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        remaining INTEGER NOT NULL,
        yield_per_hit REAL NOT NULL DEFAULT 0,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        z REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS player_slots (
        account_id TEXT NOT NULL,
        slot_index INTEGER NOT NULL,
        definition_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (account_id, slot_index)
      );
      CREATE TABLE IF NOT EXISTS crafting_queue (
        account_id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        total_units INTEGER NOT NULL,
        completed_units INTEGER NOT NULL,
        progress_s REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_vitals (
        account_id TEXT PRIMARY KEY,
        calories REAL NOT NULL,
        health REAL NOT NULL,
        exposure REAL NOT NULL DEFAULT 0
      );
    `);

    // World files created before items and nodes had authoritative positions
    // predate those columns. CREATE TABLE IF NOT EXISTS won't add them, so
    // top up in place; the DEFAULTs give existing rows spawn-origin values.
    this.addColumnIfMissing('item_claims', 'x', 'REAL NOT NULL DEFAULT 0');
    this.addColumnIfMissing('item_claims', 'y', 'REAL NOT NULL DEFAULT 0');
    this.addColumnIfMissing('item_claims', 'z', 'REAL NOT NULL DEFAULT 0');
    this.addColumnIfMissing('resource_nodes', 'yield_per_hit', 'REAL NOT NULL DEFAULT 0');
    this.addColumnIfMissing('resource_nodes', 'x', 'REAL NOT NULL DEFAULT 0');
    this.addColumnIfMissing('resource_nodes', 'y', 'REAL NOT NULL DEFAULT 0');
    this.addColumnIfMissing('resource_nodes', 'z', 'REAL NOT NULL DEFAULT 0');
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    // Table and column names are compile-time literals from this file only --
    // never user or client input -- so the unavoidable interpolation here
    // (PRAGMA and ALTER TABLE cannot bind identifiers) has no injection path.
    const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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
   *
   * The resolver and the log row share one SQLite transaction. Without that
   * they are separate commits, and a resolver like resolveHitNode makes
   * several of its own: a crash between them leaves the node's budget spent
   * with nothing granted, or the effect applied but unlogged so a same-epoch
   * retry runs it again. Either outcome breaks the exactly-once guarantee the
   * transaction key exists to provide, so the whole thing commits or none of
   * it does.
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
    const commit = this.db.transaction(() => {
      const outcome = computeOutcome();
      this.db
        .prepare(
          'INSERT INTO transactions (account_id, session_epoch, sequence, outcome) VALUES (?, ?, ?, ?)',
        )
        .run(key.accountId, key.sessionEpoch, key.sequence, outcome);
      return outcome;
    });
    return commit();
  }

  /**
   * Persists an account's active crafting entry. Accepting a craft debits the
   * inputs immediately and durably, so the entry that owes the output has to
   * be just as durable -- otherwise a restart keeps the materials and delivers
   * nothing (GDD section 9 requires escrow to be retained, never voided).
   */
  saveCraftingEntry(accountId: string, entry: CraftingEntryRecord): void {
    this.db
      .prepare(
        `INSERT INTO crafting_queue (account_id, recipe_id, total_units, completed_units, progress_s)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           recipe_id = excluded.recipe_id, total_units = excluded.total_units,
           completed_units = excluded.completed_units, progress_s = excluded.progress_s`,
      )
      .run(accountId, entry.recipeId, entry.totalUnits, entry.completedUnits, entry.progressS);
  }

  deleteCraftingEntry(accountId: string): void {
    this.db.prepare('DELETE FROM crafting_queue WHERE account_id = ?').run(accountId);
  }

  loadCraftingEntries(): Map<string, CraftingEntryRecord> {
    const rows = this.db
      .prepare('SELECT account_id, recipe_id, total_units, completed_units, progress_s FROM crafting_queue')
      .all() as CraftingQueueRow[];
    const result = new Map<string, CraftingEntryRecord>();
    for (const row of rows) {
      result.set(row.account_id, {
        recipeId: row.recipe_id,
        totalUnits: row.total_units,
        completedUnits: row.completed_units,
        progressS: row.progress_s,
      });
    }
    return result;
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
  saveItemClaim(
    instanceId: string,
    definitionId: string,
    claimedBy: string | null,
    position: Vec3,
  ): void {
    this.db
      .prepare(
        `INSERT INTO item_claims (instance_id, definition_id, claimed_by, x, y, z) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(instance_id) DO UPDATE SET
           definition_id = excluded.definition_id, claimed_by = excluded.claimed_by,
           x = excluded.x, y = excluded.y, z = excluded.z`,
      )
      .run(instanceId, definitionId, claimedBy, position.x, position.y, position.z);
  }

  loadItemClaims(): Map<string, ItemClaim> {
    const rows = this.db
      .prepare('SELECT instance_id, definition_id, claimed_by, x, y, z FROM item_claims')
      .all() as ItemClaimRow[];
    const result = new Map<string, ItemClaim>();
    for (const row of rows) {
      result.set(row.instance_id, {
        definitionId: row.definition_id,
        claimedBy: row.claimed_by,
        position: { x: row.x, y: row.y, z: row.z },
      });
    }
    return result;
  }

  /**
   * Persists a resource node's remaining budget (T03 conservation across a
   * restart) along with the identity it was spawned with. yieldPerHit is
   * stored rather than re-derived on load: a node whose rate came from
   * anywhere but the default table would otherwise restore with a different
   * (possibly zero) rate and be silently dead.
   */
  saveNodeState(
    nodeId: string,
    definitionId: string,
    remaining: number,
    yieldPerHit: number,
    position: Vec3,
  ): void {
    this.db
      .prepare(
        `INSERT INTO resource_nodes (node_id, definition_id, remaining, yield_per_hit, x, y, z)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
           definition_id = excluded.definition_id, remaining = excluded.remaining,
           yield_per_hit = excluded.yield_per_hit,
           x = excluded.x, y = excluded.y, z = excluded.z`,
      )
      .run(nodeId, definitionId, remaining, yieldPerHit, position.x, position.y, position.z);
  }

  loadNodeStates(): Map<string, NodeState> {
    const rows = this.db
      .prepare('SELECT node_id, definition_id, remaining, yield_per_hit, x, y, z FROM resource_nodes')
      .all() as ResourceNodeRow[];
    const result = new Map<string, NodeState>();
    for (const row of rows) {
      result.set(row.node_id, {
        definitionId: row.definition_id,
        remaining: row.remaining,
        yieldPerHit: row.yield_per_hit,
        position: { x: row.x, y: row.y, z: row.z },
      });
    }
    return result;
  }

  /**
   * Replaces an account's entire saved inventory in one transaction. Private
   * per TECHNICAL section 3: inventory contents never ride the shared
   * replicated schema, so this is the only durable home for them.
   */
  savePlayerSlots(accountId: string, slots: Slot[]): void {
    const replace = this.db.transaction((items: Slot[]) => {
      this.db.prepare('DELETE FROM player_slots WHERE account_id = ?').run(accountId);
      const insert = this.db.prepare(
        'INSERT INTO player_slots (account_id, slot_index, definition_id, quantity) VALUES (?, ?, ?, ?)',
      );
      items.forEach((slot, index) => {
        if (slot) {
          insert.run(accountId, index, slot.definitionId, slot.quantity);
        }
      });
    });
    replace(slots);
  }

  loadPlayerSlots(accountId: string, size: number): Slot[] {
    const rows = this.db
      .prepare('SELECT slot_index, definition_id, quantity FROM player_slots WHERE account_id = ?')
      .all(accountId) as PlayerSlotRow[];
    const slots: Slot[] = new Array(size).fill(null);
    for (const row of rows) {
      if (row.slot_index >= 0 && row.slot_index < size) {
        slots[row.slot_index] = { definitionId: row.definition_id, quantity: row.quantity };
      }
    }
    return slots;
  }

  /** Continuous-state checkpoint for survival vitals, same class as savePlayerCheckpoint. */
  savePlayerVitals(accountId: string, vitals: PlayerVitals): void {
    this.db
      .prepare(
        `INSERT INTO player_vitals (account_id, calories, health, exposure) VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           calories = excluded.calories, health = excluded.health, exposure = excluded.exposure`,
      )
      .run(accountId, vitals.calories, vitals.health, vitals.exposure);
  }

  loadPlayerVitals(): Map<string, PlayerVitals> {
    const rows = this.db
      .prepare('SELECT account_id, calories, health, exposure FROM player_vitals')
      .all() as PlayerVitalsRow[];
    const result = new Map<string, PlayerVitals>();
    for (const row of rows) {
      result.set(row.account_id, { calories: row.calories, health: row.health, exposure: row.exposure });
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}
