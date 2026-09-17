import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Slot, StationKind, TransactionKey } from '@rwf/sim';

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

export type StatusEffectKind = 'bleed' | 'poison';

export interface StatusEffectRecord {
  kind: StatusEffectKind;
  ratePerS: number;
  remainingS: number;
}

interface StatusEffectRow {
  account_id: string;
  kind: string;
  rate_per_s: number;
  remaining_s: number;
}

export interface CorpseRecord {
  ownerAccountId: string;
  position: Vec3;
  diedAtTick: number;
  /** The 40 interactive slots; sparse on disk, only occupied ones are stored. */
  slots: Slot[];
  /** GDD section 12's noninteractive manifest, in order. */
  overflow: Array<{ definitionId: string; quantity: number }>;
}

interface CorpseRow {
  corpse_id: string;
  owner_account_id: string;
  x: number;
  y: number;
  z: number;
  died_at_tick: number;
}

interface CorpseSlotRow {
  corpse_id: string;
  compartment: string;
  slot_index: number;
  definition_id: string;
  quantity: number;
}

interface DeadAccountRow {
  account_id: string;
  died_at_tick: number;
}

export interface DeployableRecord {
  definitionId: string;
  ownerAccountId: string;
  position: Vec3;
  health: number;
  /**
   * GDD section 10's demolition window is "120 seconds after placement", and
   * decay counts from a cluster's activity. Neither is implemented yet, but a
   * row that never recorded when it was placed cannot acquire the fact later
   * without a migration.
   */
  placedAtTick: number;
  slots: Slot[];
}

interface DeployableRow {
  deployable_id: string;
  definition_id: string;
  owner_account_id: string;
  x: number;
  y: number;
  z: number;
  health: number;
  placed_at_tick: number;
}

interface DeployableSlotRow {
  deployable_id: string;
  slot_index: number;
  definition_id: string;
  quantity: number;
}

export interface StationRecord {
  kind: StationKind;
  lit: boolean;
  progressS: number;
  position: Vec3;
  inputs: Slot[];
  fuel: Slot;
  outputs: Slot[];
}

interface StationRow {
  station_id: string;
  kind: string;
  lit: number;
  progress_s: number;
  x: number;
  y: number;
  z: number;
}

interface StationSlotRow {
  station_id: string;
  compartment: string;
  slot_index: number;
  definition_id: string;
  quantity: number;
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
      CREATE TABLE IF NOT EXISTS status_effects (
        account_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        rate_per_s REAL NOT NULL,
        remaining_s REAL NOT NULL,
        PRIMARY KEY (account_id, kind)
      );
      CREATE TABLE IF NOT EXISTS stations (
        station_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        lit INTEGER NOT NULL,
        progress_s REAL NOT NULL,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        z REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS station_slots (
        station_id TEXT NOT NULL,
        compartment TEXT NOT NULL,
        slot_index INTEGER NOT NULL,
        definition_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (station_id, compartment, slot_index)
      );
      CREATE TABLE IF NOT EXISTS corpses (
        corpse_id TEXT PRIMARY KEY,
        owner_account_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        died_at_tick INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS corpse_slots (
        corpse_id TEXT NOT NULL,
        compartment TEXT NOT NULL,
        slot_index INTEGER NOT NULL,
        definition_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (corpse_id, compartment, slot_index)
      );
      CREATE TABLE IF NOT EXISTS dead_accounts (
        account_id TEXT PRIMARY KEY,
        died_at_tick INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deployables (
        deployable_id TEXT PRIMARY KEY,
        definition_id TEXT NOT NULL,
        owner_account_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        z REAL NOT NULL,
        health REAL NOT NULL,
        placed_at_tick INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deployable_slots (
        deployable_id TEXT NOT NULL,
        slot_index INTEGER NOT NULL,
        definition_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        PRIMARY KEY (deployable_id, slot_index)
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

  /**
   * Runs several of this store's writes as one commit. Under synchronous =
   * FULL each bare statement costs an fsync, so a caller writing a row per
   * account (checkpoint) needs them batched rather than serialized.
   */
  runInTransaction(work: () => void): void {
    this.db.transaction(work)();
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

  /**
   * Replaces a station's whole durable state: the row and every occupied slot.
   * Contents changes are class-1 (TECHNICAL section 7) -- an insert or a take
   * is a committed transfer, and a delivered output is a produced item -- so
   * this runs at commit rather than waiting for a checkpoint. The progress
   * toward the next quantum riding along is class-2 and merely convenient;
   * saveStationProgress is what the checkpoint calls.
   */
  saveStation(stationId: string, station: StationRecord): void {
    const replace = this.db.transaction((record: StationRecord) => {
      this.db
        .prepare(
          `INSERT INTO stations (station_id, kind, lit, progress_s, x, y, z) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(station_id) DO UPDATE SET
             kind = excluded.kind, lit = excluded.lit, progress_s = excluded.progress_s,
             x = excluded.x, y = excluded.y, z = excluded.z`,
        )
        .run(
          stationId,
          record.kind,
          record.lit ? 1 : 0,
          record.progressS,
          record.position.x,
          record.position.y,
          record.position.z,
        );
      this.db.prepare('DELETE FROM station_slots WHERE station_id = ?').run(stationId);
      const insert = this.db.prepare(
        'INSERT INTO station_slots (station_id, compartment, slot_index, definition_id, quantity) VALUES (?, ?, ?, ?, ?)',
      );
      const write = (compartment: string, slots: Slot[]): void => {
        slots.forEach((slot, index) => {
          if (slot) insert.run(stationId, compartment, index, slot.definitionId, slot.quantity);
        });
      };
      write('input', record.inputs);
      write('fuel', [record.fuel]);
      write('output', record.outputs);
    });
    replace(station);
  }

  /** Class-2 half only: the partially elapsed quantum and the lit flag. */
  saveStationProgress(stationId: string, progressS: number, lit: boolean): void {
    this.db
      .prepare('UPDATE stations SET progress_s = ?, lit = ? WHERE station_id = ?')
      .run(progressS, lit ? 1 : 0, stationId);
  }

  loadStations(): Map<string, StationRecord> {
    const rows = this.db
      .prepare('SELECT station_id, kind, lit, progress_s, x, y, z FROM stations')
      .all() as StationRow[];
    const slotRows = this.db
      .prepare('SELECT station_id, compartment, slot_index, definition_id, quantity FROM station_slots')
      .all() as StationSlotRow[];

    const result = new Map<string, StationRecord>();
    for (const row of rows) {
      result.set(row.station_id, {
        kind: row.kind as StationKind,
        lit: row.lit !== 0,
        progressS: row.progress_s,
        position: { x: row.x, y: row.y, z: row.z },
        inputs: [],
        fuel: null,
        outputs: [],
      });
    }
    for (const slot of slotRows) {
      const station = result.get(slot.station_id);
      if (!station) continue;
      const stack = { definitionId: slot.definition_id, quantity: slot.quantity };
      if (slot.compartment === 'fuel') {
        station.fuel = stack;
      } else {
        // Sparse on purpose: only occupied slots are stored, so the room pads
        // each compartment out to its spec's size when it restores.
        const target = slot.compartment === 'input' ? station.inputs : station.outputs;
        target[slot.slot_index] = stack;
      }
    }
    return result;
  }

  /**
   * Replaces one account's timed status effects. Continuous state like vitals
   * (TECHNICAL section 7's class 2), and checkpointed with them: health is
   * durable, so the bleeding draining it has to be too, or stopping the host
   * is a free heal.
   */
  saveStatusEffects(accountId: string, effects: StatusEffectRecord[]): void {
    const replace = this.db.transaction((rows: StatusEffectRecord[]) => {
      this.db.prepare('DELETE FROM status_effects WHERE account_id = ?').run(accountId);
      const insert = this.db.prepare(
        'INSERT INTO status_effects (account_id, kind, rate_per_s, remaining_s) VALUES (?, ?, ?, ?)',
      );
      for (const row of rows) insert.run(accountId, row.kind, row.ratePerS, row.remainingS);
    });
    replace(effects);
  }

  loadStatusEffects(): Map<string, StatusEffectRecord[]> {
    const rows = this.db
      .prepare('SELECT account_id, kind, rate_per_s, remaining_s FROM status_effects')
      .all() as StatusEffectRow[];
    const result = new Map<string, StatusEffectRecord[]>();
    for (const row of rows) {
      const list = result.get(row.account_id) ?? [];
      list.push({ kind: row.kind as StatusEffectKind, ratePerS: row.rate_per_s, remainingS: row.remaining_s });
      result.set(row.account_id, list);
    }
    return result;
  }

  /**
   * Replaces a corpse's whole durable state. Class-1 (TECHNICAL section 7):
   * a death is a committed transfer of everything a player owned, so it is
   * written at the commit rather than waiting for a checkpoint -- a force-kill
   * in between must not resurrect the pack on the living body.
   */
  saveCorpse(corpseId: string, corpse: CorpseRecord): void {
    const replace = this.db.transaction((record: CorpseRecord) => {
      this.db
        .prepare(
          `INSERT INTO corpses (corpse_id, owner_account_id, x, y, z, died_at_tick) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(corpse_id) DO UPDATE SET
             owner_account_id = excluded.owner_account_id, x = excluded.x, y = excluded.y,
             z = excluded.z, died_at_tick = excluded.died_at_tick`,
        )
        .run(
          corpseId,
          record.ownerAccountId,
          record.position.x,
          record.position.y,
          record.position.z,
          record.diedAtTick,
        );
      this.db.prepare('DELETE FROM corpse_slots WHERE corpse_id = ?').run(corpseId);
      const insert = this.db.prepare(
        'INSERT INTO corpse_slots (corpse_id, compartment, slot_index, definition_id, quantity) VALUES (?, ?, ?, ?, ?)',
      );
      record.slots.forEach((slot, index) => {
        if (slot) insert.run(corpseId, 'slot', index, slot.definitionId, slot.quantity);
      });
      record.overflow.forEach((stack, index) => {
        insert.run(corpseId, 'overflow', index, stack.definitionId, stack.quantity);
      });
    });
    replace(corpse);
  }

  deleteCorpse(corpseId: string): void {
    const remove = this.db.transaction(() => {
      this.db.prepare('DELETE FROM corpse_slots WHERE corpse_id = ?').run(corpseId);
      this.db.prepare('DELETE FROM corpses WHERE corpse_id = ?').run(corpseId);
    });
    remove();
  }

  loadCorpses(): Map<string, CorpseRecord> {
    const rows = this.db
      .prepare('SELECT corpse_id, owner_account_id, x, y, z, died_at_tick FROM corpses')
      .all() as CorpseRow[];
    const slotRows = this.db
      .prepare('SELECT corpse_id, compartment, slot_index, definition_id, quantity FROM corpse_slots')
      .all() as CorpseSlotRow[];

    const result = new Map<string, CorpseRecord>();
    for (const row of rows) {
      result.set(row.corpse_id, {
        ownerAccountId: row.owner_account_id,
        position: { x: row.x, y: row.y, z: row.z },
        diedAtTick: row.died_at_tick,
        slots: [],
        overflow: [],
      });
    }
    for (const slot of slotRows) {
      const corpse = result.get(slot.corpse_id);
      if (!corpse) continue;
      const stack = { definitionId: slot.definition_id, quantity: slot.quantity };
      if (slot.compartment === 'overflow') {
        corpse.overflow[slot.slot_index] = stack;
      } else {
        corpse.slots[slot.slot_index] = stack;
      }
    }
    // A manifest is an ordered list, not a slot array; SQLite returns rows in
    // no guaranteed order, so compact away the holes the indexed writes left.
    for (const corpse of result.values()) {
      corpse.overflow = corpse.overflow.filter((stack) => stack);
    }
    return result;
  }

  /**
   * Marks or clears an account's dead state. Class-1 alongside the corpse:
   * a restart that forgot a death would hand the player back a body that
   * still had everything the corpse is now holding.
   */
  setAccountDead(accountId: string, diedAtTick: number | null): void {
    if (diedAtTick === null) {
      this.db.prepare('DELETE FROM dead_accounts WHERE account_id = ?').run(accountId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO dead_accounts (account_id, died_at_tick) VALUES (?, ?)
         ON CONFLICT(account_id) DO UPDATE SET died_at_tick = excluded.died_at_tick`,
      )
      .run(accountId, diedAtTick);
  }

  /**
   * Replaces a deployable's whole durable state. Class-1 like a station's
   * (TECHNICAL section 7): a placement consumes an item and an insert is a
   * committed transfer, so both are on disk at the commit rather than at the
   * next checkpoint.
   */
  saveDeployable(deployableId: string, deployable: DeployableRecord): void {
    const replace = this.db.transaction((record: DeployableRecord) => {
      this.db
        .prepare(
          `INSERT INTO deployables
             (deployable_id, definition_id, owner_account_id, x, y, z, health, placed_at_tick)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(deployable_id) DO UPDATE SET
             definition_id = excluded.definition_id, owner_account_id = excluded.owner_account_id,
             x = excluded.x, y = excluded.y, z = excluded.z, health = excluded.health,
             placed_at_tick = excluded.placed_at_tick`,
        )
        .run(
          deployableId,
          record.definitionId,
          record.ownerAccountId,
          record.position.x,
          record.position.y,
          record.position.z,
          record.health,
          record.placedAtTick,
        );
      this.db.prepare('DELETE FROM deployable_slots WHERE deployable_id = ?').run(deployableId);
      const insert = this.db.prepare(
        'INSERT INTO deployable_slots (deployable_id, slot_index, definition_id, quantity) VALUES (?, ?, ?, ?)',
      );
      record.slots.forEach((slot, index) => {
        if (slot) insert.run(deployableId, index, slot.definitionId, slot.quantity);
      });
    });
    replace(deployable);
  }

  deleteDeployable(deployableId: string): void {
    const remove = this.db.transaction(() => {
      this.db.prepare('DELETE FROM deployable_slots WHERE deployable_id = ?').run(deployableId);
      this.db.prepare('DELETE FROM deployables WHERE deployable_id = ?').run(deployableId);
    });
    remove();
  }

  loadDeployables(): Map<string, DeployableRecord> {
    const rows = this.db
      .prepare(
        'SELECT deployable_id, definition_id, owner_account_id, x, y, z, health, placed_at_tick FROM deployables',
      )
      .all() as DeployableRow[];
    const slotRows = this.db
      .prepare('SELECT deployable_id, slot_index, definition_id, quantity FROM deployable_slots')
      .all() as DeployableSlotRow[];

    const result = new Map<string, DeployableRecord>();
    for (const row of rows) {
      result.set(row.deployable_id, {
        definitionId: row.definition_id,
        ownerAccountId: row.owner_account_id,
        position: { x: row.x, y: row.y, z: row.z },
        health: row.health,
        placedAtTick: row.placed_at_tick,
        // Sparse on purpose: only occupied slots are stored, so the room pads
        // back out to the definition's slot count when it restores.
        slots: [],
      });
    }
    for (const slot of slotRows) {
      const deployable = result.get(slot.deployable_id);
      if (!deployable) continue;
      deployable.slots[slot.slot_index] = { definitionId: slot.definition_id, quantity: slot.quantity };
    }
    return result;
  }

  loadDeadAccounts(): Map<string, number> {
    const rows = this.db.prepare('SELECT account_id, died_at_tick FROM dead_accounts').all() as DeadAccountRow[];
    const result = new Map<string, number>();
    for (const row of rows) result.set(row.account_id, row.died_at_tick);
    return result;
  }

  close(): void {
    this.db.close();
  }
}
