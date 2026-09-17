import { Room, type Client } from '@colyseus/core';
import { CommandSchema, type Command, type CommandResult } from '@rwf/protocol';
import { getItem, getRecipe } from '@rwf/content';
import {
  addToInventory,
  CALORIE_SPAWN,
  computeExposureDamage,
  computeExposureIntake,
  computeStarvationDamage,
  countFreeCapacity,
  countInInventory,
  decayExposure,
  drainCalories,
  EXPOSURE_MAX,
  EXPOSURE_ZONE_RATES,
  HEALTH_MAX,
  HEALTH_SPAWN,
  harvestNode,
  removeFromInventory,
  startQueueEntry,
  stepMovement,
  takeItem as simTakeItem,
  tickQueueEntry,
  type MovementState,
  type QueueEntry,
  type ResourceNode,
  type Slot,
  type WorldItem,
} from '@rwf/sim';
import { WorldStore, type Vec3 } from './persistence.js';
import { PlayerState, WorldItemState, WorldState } from './world-state.js';

/** Matches TECHNICAL section 3's simulation budget: 20 fixed ticks/s. */
export const TICK_RATE_HZ = 20;
/** TECHNICAL section 7: continuous state checkpoints every 5 seconds. */
export const CHECKPOINT_INTERVAL_TICKS = 5 * TICK_RATE_HZ;
/** GDD section 8: 24 backpack slots per player. */
const BACKPACK_SLOTS = 24;
/**
 * How long a move intent stays live without a refresh. The client resends at
 * 20Hz (one per tick), so 5 ticks absorbs 250ms of jitter or packet loss
 * before the avatar stops. See expireStaleMoveIntents.
 */
export const MOVE_INTENT_GRACE_TICKS = 5;
/**
 * Per-resource gather rate (CONTENT section 4). Keyed by the resource
 * produced rather than a node-type ID: today every node producing a given
 * resource shares one rate. Revisit with a real node-type lookup once a
 * second node type yields the same resource at a different rate (e.g.
 * standing_tree vs wood_pile both yielding wood).
 */
const DEFAULT_YIELD_PER_HIT: Record<string, number> = { wood: 10 };
/**
 * Client-side placeholder hazard zone (GDD section 6's hot-ore exposure),
 * centered on spawn so it's immediately exercisable without needing real
 * authored terrain/zone geometry yet. No worn-armor protection is modeled
 * (0), since armor doesn't exist until M3.
 */
const HAZARD_ZONE_CENTER = { x: 0, z: 0 };
const HAZARD_ZONE_RADIUS_M = 5;
/** GDD section 5: how far a player can reach to take or hit something. */
const INTERACT_REACH_M = 2.5;
/**
 * Slack on the server's reach check. The client decides it is in range from
 * the position it has, which is always a little behind the server's; at
 * SPRINT 5.5 m/s a ~180ms round trip is about a metre of travel. Generous
 * enough never to refuse honest play, far too tight to farm from across the map.
 */
const INTERACT_REACH_TOLERANCE_M = 1;
/** Camera offset above the player's feet; the client measures reach from here. */
const EYE_HEIGHT_M = 1.7;
/**
 * CONTENT section 4: "Rock swing interval 1 s" -- the bare-hands/rock rate.
 * Counted in simulation ticks, not wall-clock: GDD section 20 requires every
 * gameplay timer to freeze while the host is stopped rather than resuming with
 * a backlog of owed swings. Tool-specific intervals (hatchet 0.9s, iron 0.7s)
 * arrive with tool equipping.
 */
const SWING_INTERVAL_TICKS = TICK_RATE_HZ;
/**
 * Blunt backstop on total command volume per client. Colyseus disconnects a
 * client that exceeds this, so it sits well clear of honest traffic: the
 * client sends 20 move commands/s plus occasional actions, and this is 3x
 * that. It bounds what a spammer can force the room to even look at; the
 * per-action cooldowns above are what bound the gameplay effect.
 */
const MAX_MESSAGES_PER_SECOND = 60;

interface ClientUserData {
  accountId: string;
  sessionEpoch: number;
}

interface NodeConfig {
  definitionId: string;
  yieldPerHit: number;
  position: Vec3;
}

type RoomClient = Client<{ userData: ClientUserData }>;
type MoveAction = Extract<Command['action'], { type: 'move' }>;

export class WorldRoom extends Room<{ state: WorldState; client: RoomClient }> {
  private store!: WorldStore;
  private readonly worldItems = new Map<string, WorldItem>();
  private readonly itemPositions = new Map<string, Vec3>();
  private readonly movementByAccount = new Map<string, MovementState>();
  private readonly pendingMove = new Map<string, { action: MoveAction; tick: number }>();
  private readonly resourceNodes = new Map<string, ResourceNode>();
  private readonly nodeConfigs = new Map<string, NodeConfig>();
  private readonly playerSlots = new Map<string, Slot[]>();
  private readonly playerVitals = new Map<string, { calories: number; health: number; exposure: number }>();
  private readonly connectedAccounts = new Set<string>();
  private readonly clientsByAccount = new Map<string, RoomClient>();
  private readonly craftingByAccount = new Map<string, QueueEntry>();
  private readonly lastSwingTick = new Map<string, number>();

  onCreate(): void {
    // TECHNICAL section 17: the world keeps running even when nobody is
    // connected. It is stopped only by stopping the host process.
    this.autoDispose = false;
    this.maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
    // dbPath deliberately never comes from room-creation options: those
    // are reachable from a real client's joinOrCreate() call (see
    // MatchMaker's merge(clientOptions, handler.options)), and TECHNICAL
    // section 10 is explicit: never evaluate a client-supplied filesystem
    // path. Only the server process's own environment controls this.
    this.store = new WorldStore(process.env.RWF_DB_PATH ?? ':memory:');
    this.state = new WorldState();

    // Crash recovery (TECHNICAL section 7): resume from the last
    // checkpoint rather than starting a fresh world.
    this.state.tick = this.store.loadWorldTick();
    for (const [accountId, transform] of this.store.loadPlayerCheckpoints()) {
      const player = new PlayerState();
      player.x = transform.x;
      player.y = transform.y;
      player.z = transform.z;
      player.yaw = transform.yaw;
      player.grounded = transform.grounded;
      this.state.players.set(accountId, player);
      this.movementByAccount.set(accountId, {
        position: { x: transform.x, y: transform.y, z: transform.z },
        velocityY: 0,
        grounded: transform.grounded,
      });
    }
    for (const [instanceId, claim] of this.store.loadItemClaims()) {
      this.worldItems.set(instanceId, {
        instanceId,
        definitionId: claim.definitionId,
        claimedBy: claim.claimedBy,
      });
      this.itemPositions.set(instanceId, claim.position);
      const item = new WorldItemState();
      item.definitionId = claim.definitionId;
      item.claimedBy = claim.claimedBy ?? '';
      this.state.items.set(instanceId, item);
    }
    for (const [nodeId, node] of this.store.loadNodeStates()) {
      this.resourceNodes.set(nodeId, { nodeId, remaining: node.remaining });
      this.nodeConfigs.set(nodeId, {
        definitionId: node.definitionId,
        // Prefer the rate the node was actually spawned with. Falling back to
        // the default table is only for rows written before the column
        // existed, where it is stored as 0.
        yieldPerHit: node.yieldPerHit > 0 ? node.yieldPerHit : DEFAULT_YIELD_PER_HIT[node.definitionId] ?? 0,
        position: node.position,
      });
    }
    for (const [accountId, vitals] of this.store.loadPlayerVitals()) {
      this.playerVitals.set(accountId, vitals);
    }
    for (const [accountId, record] of this.store.loadCraftingEntries()) {
      const recipe = getRecipe(record.recipeId);
      if (!recipe) {
        // The recipe left CONTENT while this entry was owed. The row is left
        // in place rather than dropped: deleting it would silently keep the
        // player's escrow, and only the recipe knows what the inputs were, so
        // it cannot be refunded from here either. Restoring the recipe makes
        // the entry live again.
        continue;
      }
      this.craftingByAccount.set(accountId, {
        recipe,
        totalUnits: record.totalUnits,
        completedUnits: record.completedUnits,
        progressS: record.progressS,
      });
    }

    // Seed the M0/M1 proof-of-mechanism content on a genuinely fresh world
    // only -- never re-seed over a restored (possibly claimed/depleted)
    // item or node, which the restore loops above already populated.
    // Positions match where the client draws its placeholder meshes, so a
    // player who walks up to one is genuinely within the server's reach check.
    if (!this.worldItems.has('item_1')) {
      this.spawnItem('item_1', 'wood', { x: 2, y: 0.5, z: 2 });
    }
    if (!this.resourceNodes.has('node_1')) {
      // CONTENT section 4: wood pile
      this.spawnNode('node_1', 'wood', 150, 10, { x: -2, y: 0.5, z: 2 });
    }

    this.onMessage('command', CommandSchema, (client, command) => {
      this.handleCommand(client, command);
    });

    this.setFixedTimestep((ctx) => this.tick(ctx.dt), TICK_RATE_HZ);
  }

  onDispose(): void {
    this.checkpoint();
    this.store.close();
  }

  /**
   * Persists the tick counter, every known player's transform and vitals, and
   * in-flight crafting progress -- TECHNICAL section 7's class-2 continuous
   * state, checkpointed rather than written per tick. Public for tests/ops.
   *
   * One transaction rather than 1 + 2N bare statements: under synchronous =
   * FULL each statement is its own fsync, so a per-account loop would put a
   * growing stall on the game-loop thread every 5 seconds.
   */
  checkpoint(): void {
    this.store.runInTransaction(() => {
      this.store.saveWorldTick(this.state.tick);
      for (const [accountId, movement] of this.movementByAccount) {
        this.store.savePlayerCheckpoint(accountId, {
          x: movement.position.x,
          y: movement.position.y,
          z: movement.position.z,
          yaw: this.state.players.get(accountId)?.yaw ?? 0,
          grounded: movement.grounded,
        });
      }
      for (const [accountId, vitals] of this.playerVitals) {
        this.store.savePlayerVitals(accountId, vitals);
      }
      for (const [accountId, entry] of this.craftingByAccount) {
        this.persistCrafting(accountId, entry);
      }
    });
  }

  /** Seeds a world item for tests/tools; not a player-facing command. */
  spawnItem(instanceId: string, definitionId: string, position: Vec3 = { x: 0, y: 0, z: 0 }): void {
    this.worldItems.set(instanceId, { instanceId, definitionId, claimedBy: null });
    this.itemPositions.set(instanceId, position);
    this.store.saveItemClaim(instanceId, definitionId, null, position);
    const item = new WorldItemState();
    item.definitionId = definitionId;
    this.state.items.set(instanceId, item);
  }

  /** Seeds a gatherable resource node for tests/tools; not a player-facing command. */
  spawnNode(
    nodeId: string,
    definitionId: string,
    totalBudget: number,
    yieldPerHit: number,
    position: Vec3 = { x: 0, y: 0, z: 0 },
  ): void {
    this.resourceNodes.set(nodeId, { nodeId, remaining: totalBudget });
    this.nodeConfigs.set(nodeId, { definitionId, yieldPerHit, position });
    this.store.saveNodeState(nodeId, definitionId, totalBudget, yieldPerHit, position);
  }

  /**
   * Server-authoritative reach check (GDD section 5). The client applies the
   * same limit for responsiveness, but a modified client simply omits it, so
   * the claim is only real if the server makes it. Measured from the player's
   * eye, matching where the client measures from, with a tolerance that
   * absorbs the latency between the client deciding it is in range and the
   * command landing.
   */
  private isWithinReach(accountId: string, target: Vec3): boolean {
    const movement = this.movementByAccount.get(accountId);
    if (!movement) return false;
    const dx = movement.position.x - target.x;
    const dy = movement.position.y + EYE_HEIGHT_M - target.y;
    const dz = movement.position.z - target.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= INTERACT_REACH_M + INTERACT_REACH_TOLERANCE_M;
  }

  onJoin(client: RoomClient, options: { accountId?: string }): void {
    const accountId = options?.accountId;
    if (!accountId) {
      throw new Error('accountId is required to join the world');
    }

    const sessionEpoch = this.store.beginSession(accountId);
    client.userData = { accountId, sessionEpoch };
    // Deferred one tick: sending synchronously from onJoin can race the
    // client SDK's own post-join message listener registration.
    this.clock.setTimeout(() => client.send('session', { sessionEpoch }), 0);

    if (!this.state.players.has(accountId)) {
      // Fresh player: spawn kit position, GDD section 5's ground level.
      this.state.players.set(accountId, new PlayerState());
      this.movementByAccount.set(accountId, {
        position: { x: 0, y: 0, z: 0 },
        velocityY: 0,
        grounded: true,
      });
    }
    // Reconnecting to an existing accountId resumes the same body: the
    // schema entry and movementByAccount state are left untouched.

    if (!this.playerSlots.has(accountId)) {
      this.playerSlots.set(accountId, this.store.loadPlayerSlots(accountId, BACKPACK_SLOTS));
    }
    if (!this.playerVitals.has(accountId)) {
      this.playerVitals.set(accountId, { calories: CALORIE_SPAWN, health: HEALTH_SPAWN, exposure: 0 });
    }
    this.connectedAccounts.add(accountId); // sleepers (disconnected) do not drain, GDD section 12
    this.clientsByAccount.set(accountId, client);

    // Private per TECHNICAL section 3: inventory/vitals never ride the
    // shared replicated schema. Sent the same tick as 'session' for the
    // same reason (avoid racing the client's post-join listener setup).
    this.clock.setTimeout(() => {
      // A join followed immediately by a leave would otherwise fire these at a
      // client that is already gone.
      if (this.clientsByAccount.get(accountId) !== client) return;
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      client.send('vitals', this.playerVitals.get(accountId));
      // A reconnect mid-craft must not present an empty queue while escrow
      // is still held.
      this.sendCrafting(accountId);
    }, 0);
  }

  onLeave(client: RoomClient): void {
    const accountId = client.userData?.accountId;
    if (accountId) {
      // Only tear down if this is still the account's current connection. A
      // half-dead socket can close after the reconnect that replaced it has
      // already rebound the account; keying purely on accountId would then
      // remove the live client, and the reconnected player would stop being
      // simulated while still appearing connected.
      if (this.clientsByAccount.get(accountId) !== client) return;
      this.pendingMove.delete(accountId);
      this.connectedAccounts.delete(accountId);
      this.clientsByAccount.delete(accountId);
    }
    // The player entity stays in state.players and movementByAccount: a
    // disconnect leaves a sleeper (GDD section 12), not a removed entity.
  }

  private handleCommand(client: RoomClient, command: Command): void {
    if (!client.userData) return;
    const { accountId, sessionEpoch } = client.userData;
    if (command.sessionEpoch !== sessionEpoch || !this.store.isSessionActive(accountId, command.sessionEpoch)) {
      // A delayed packet from a session a reconnect already replaced.
      const result: CommandResult = {
        sequence: command.sequence,
        accepted: false,
        reasonCode: 'stale_session',
        serverTick: this.state.tick,
      };
      client.send('commandResult', result);
      return;
    }

    if (command.action.type === 'move') {
      this.pendingMove.set(accountId, { action: command.action, tick: this.state.tick });
      return;
    }

    const key = { accountId, sessionEpoch: command.sessionEpoch, sequence: command.sequence };

    if (command.action.type === 'takeItem') {
      const itemInstanceId = command.action.itemInstanceId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveTakeItem(accountId, itemInstanceId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      return;
    }

    if (command.action.type === 'hitNode') {
      const nodeId = command.action.nodeId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveHitNode(accountId, nodeId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      // The inventory changed (or didn't) as a side effect of resolveHitNode;
      // tell the owner their current contents either way, same as takeItem's
      // commandResult tells them the outcome of their own action.
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      return;
    }

    const { recipeId, quantity } = command.action;
    const encoded = this.store.commitOutcome(key, () =>
      JSON.stringify(this.resolveCraft(accountId, recipeId, quantity, command.sequence)),
    );
    client.send('commandResult', JSON.parse(encoded) as CommandResult);
    client.send('inventory', { slots: this.playerSlots.get(accountId) });
    this.sendCrafting(accountId);
  }

  private resolveTakeItem(accountId: string, itemInstanceId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const position = this.itemPositions.get(itemInstanceId);
    // Checked before the claim so an out-of-reach attempt neither takes the
    // item nor reveals whether it was still unclaimed.
    if (position && !this.isWithinReach(accountId, position)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }

    const outcome = simTakeItem(this.worldItems, itemInstanceId, accountId);
    if (outcome.outcome === 'taken') {
      const stateItem = this.state.items.get(itemInstanceId);
      if (stateItem) {
        stateItem.claimedBy = accountId;
        this.store.saveItemClaim(
          itemInstanceId,
          stateItem.definitionId,
          accountId,
          position ?? { x: 0, y: 0, z: 0 },
        );
      }
      return { ...base, accepted: true, reasonCode: 'ok' };
    }
    return { ...base, accepted: false, reasonCode: outcome.outcome };
  }

  private resolveHitNode(accountId: string, nodeId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const node = this.resourceNodes.get(nodeId);
    const config = this.nodeConfigs.get(nodeId);
    if (!node || !config) {
      return { ...base, accepted: false, reasonCode: 'not_found' };
    }
    if (!this.isWithinReach(accountId, config.position)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    const lastSwing = this.lastSwingTick.get(accountId);
    if (lastSwing !== undefined && this.state.tick - lastSwing < SWING_INTERVAL_TICKS) {
      // Without this, a node's whole budget falls to as many packets as a
      // scripted client can write, each costing a synchronous SQLite write
      // on the game-loop thread.
      return { ...base, accepted: false, reasonCode: 'rate_limited' };
    }

    // Peek at the harvest before committing it: decrementing the node budget
    // and then discarding what the backpack cannot hold would destroy the
    // resource outright (stacks.ts is explicit that overflow must be routed
    // or the action refused, never dropped).
    const { result: preview } = harvestNode(node, config.yieldPerHit);
    if (preview.granted <= 0) {
      return { ...base, accepted: false, reasonCode: 'depleted' };
    }

    const stackLimit = getItem(config.definitionId)?.stack ?? 1;
    const currentSlots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    if (countFreeCapacity(currentSlots, config.definitionId, stackLimit) < preview.granted) {
      // GDD section 8: a full pack refuses the gather rather than voiding it.
      return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
    }

    // Only an accepted swing starts the cooldown; a refused one (out of
    // reach, full pack, depleted) must not also cost the player their rhythm.
    this.lastSwingTick.set(accountId, this.state.tick);
    const { node: nextNode, result } = harvestNode(node, config.yieldPerHit);
    this.resourceNodes.set(nodeId, nextNode);
    this.store.saveNodeState(nodeId, config.definitionId, nextNode.remaining, config.yieldPerHit, config.position);

    const { slots: nextSlots, overflow } = addToInventory(currentSlots, config.definitionId, result.granted, stackLimit);
    if (overflow > 0) {
      // The capacity check above makes this unreachable; failing loudly beats
      // silently destroying a resource if the two ever disagree.
      throw new Error(`harvest overflow of ${overflow} ${config.definitionId} despite a capacity check`);
    }
    this.playerSlots.set(accountId, nextSlots);
    this.store.savePlayerSlots(accountId, nextSlots);

    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  private resolveCraft(accountId: string, recipeId: string, quantity: number, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const recipe = getRecipe(recipeId);
    if (!recipe) {
      return { ...base, accepted: false, reasonCode: 'not_found' };
    }
    if (this.craftingByAccount.has(accountId)) {
      // GDD section 9 allows six entries per queue; this vertical models
      // one active entry per account. Expand to a real multi-slot queue
      // when a second concurrent recipe is actually needed.
      return { ...base, accepted: false, reasonCode: 'busy' };
    }

    let slots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    for (const [inputId, perUnit] of Object.entries(recipe.inputs)) {
      if (countInInventory(slots, inputId) < perUnit * quantity) {
        return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
      }
    }
    // Escrow the entire entry's cost up front (GDD section 9), only after
    // confirming every input clears its full requirement above.
    for (const [inputId, perUnit] of Object.entries(recipe.inputs)) {
      slots = removeFromInventory(slots, inputId, perUnit * quantity).slots;
    }
    this.playerSlots.set(accountId, slots);
    this.store.savePlayerSlots(accountId, slots);

    const entry = startQueueEntry(recipe, quantity);
    this.craftingByAccount.set(accountId, entry);
    this.persistCrafting(accountId, entry);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * Tells one owner about their own crafting queue. Private per TECHNICAL
   * section 3, so it is a targeted message rather than shared schema state.
   * A null recipeId means "nothing queued" -- sent on completion so the UI
   * can clear, rather than showing a craft in progress forever.
   */
  private sendCrafting(accountId: string): void {
    const entry = this.craftingByAccount.get(accountId);
    this.clientsByAccount.get(accountId)?.send('crafting', {
      recipeId: entry?.recipe.id ?? null,
      completedUnits: entry?.completedUnits ?? 0,
      totalUnits: entry?.totalUnits ?? 0,
      progressS: entry?.progressS ?? 0,
    });
  }

  private persistCrafting(accountId: string, entry: QueueEntry): void {
    this.store.saveCraftingEntry(accountId, {
      recipeId: entry.recipe.id,
      totalUnits: entry.totalUnits,
      completedUnits: entry.completedUnits,
      progressS: entry.progressS,
    });
  }


  /**
   * A move intent describes what the player is doing right now, so it must not
   * outlive the stream of commands that produced it. Without this, one packet
   * drives the avatar forever: a backgrounded tab (whose send interval browsers
   * throttle to ~1Hz) or any packet-loss gap leaves the player sprinting across
   * the map unattended, burning calories at the sprint rate and re-jumping on
   * every landing.
   *
   * Expiry neutralizes the axes rather than dropping the entry, so gravity keeps
   * integrating and a player who disconnects mid-air still falls to the ground.
   * Yaw and crouch are posture, not motion, and are left as the player set them.
   */
  private expireStaleMoveIntents(): void {
    for (const [accountId, pending] of this.pendingMove) {
      if (this.state.tick - pending.tick <= MOVE_INTENT_GRACE_TICKS) continue;
      const { action } = pending;
      if (action.axisX === 0 && action.axisY === 0 && !action.sprint && !action.jump) continue;
      // Keeping the original tick leaves the entry expired, so it stays
      // neutral until a fresh command replaces it.
      this.pendingMove.set(accountId, {
        action: { ...action, axisX: 0, axisY: 0, sprint: false, jump: false },
        tick: pending.tick,
      });
    }
  }

  /** Test-only: reports whether the account's *effective* intent is sprinting. */
  isSprintingForTest(accountId: string): boolean {
    return this.pendingMove.get(accountId)?.action.sprint ?? false;
  }

  /** Advances every account's active crafting entry by dt seconds. */
  private tickCrafting(dt: number): void {
    for (const [accountId, entry] of this.craftingByAccount) {
      const stackLimit = getItem(entry.recipe.outputId)?.stack ?? 1;
      const currentSlots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
      // Real capacity, not Infinity: tickQueueEntry only completes units it can
      // deliver, so a full pack pauses the entry and retains escrow (GDD
      // section 9) instead of marking units done and dropping their output.
      const capacity = countFreeCapacity(currentSlots, entry.recipe.outputId, stackLimit);
      const { entry: nextEntry, producedUnits } = tickQueueEntry(entry, dt, capacity);

      if (producedUnits > 0) {
        const { slots, overflow } = addToInventory(
          currentSlots,
          nextEntry.recipe.outputId,
          producedUnits * nextEntry.recipe.outputQuantityPerUnit,
          stackLimit,
        );
        if (overflow > 0) {
          throw new Error(`craft overflow of ${overflow} ${nextEntry.recipe.outputId} despite a capacity check`);
        }
        this.playerSlots.set(accountId, slots);
        this.store.savePlayerSlots(accountId, slots);
        this.clientsByAccount.get(accountId)?.send('inventory', { slots });
      }

      if (nextEntry.completedUnits >= nextEntry.totalUnits) {
        this.craftingByAccount.delete(accountId);
        this.store.deleteCraftingEntry(accountId);
        this.sendCrafting(accountId);
      } else {
        this.craftingByAccount.set(accountId, nextEntry);
        if (producedUnits > 0) this.sendCrafting(accountId);
        // Persist only when a unit actually landed. TECHNICAL section 7:
        // a delivered unit is class-1 (durable at commit), while a partially
        // elapsed unit is class-2 continuous state that checkpoint() covers
        // every 5s. tickQueueEntry returns a fresh object whenever progressS
        // moves, so writing on every change would put an fsync on the 20Hz
        // game-loop thread for every crafting player.
        if (producedUnits > 0) this.persistCrafting(accountId, nextEntry);
      }
    }
  }

  /** Test-only: seeds a player's inventory directly, bypassing gather/take. */
  grantForTest(accountId: string, definitionId: string, quantity: number): void {
    const stackLimit = getItem(definitionId)?.stack ?? 1;
    const current = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    const { slots } = addToInventory(current, definitionId, quantity, stackLimit);
    this.playerSlots.set(accountId, slots);
    this.store.savePlayerSlots(accountId, slots);
  }

  /** Test-only: advances crafting by dt seconds directly, bypassing the real tick timer. */
  advanceCraftingForTest(dt: number): void {
    this.tickCrafting(dt);
  }

  /** Test-only read accessors; no client-facing binding. */
  isConnectedForTest(accountId: string): boolean {
    return this.connectedAccounts.has(accountId);
  }

  nodeRemainingForTest(nodeId: string): number | undefined {
    return this.resourceNodes.get(nodeId)?.remaining;
  }

  countForTest(accountId: string, definitionId: string): number {
    return countInInventory(this.playerSlots.get(accountId) ?? [], definitionId);
  }

  craftingEntryForTest(accountId: string): QueueEntry | undefined {
    return this.craftingByAccount.get(accountId);
  }

  private tick(dt: number): void {
    this.state.tick += 1;

    this.expireStaleMoveIntents();

    for (const [accountId, { action }] of this.pendingMove) {
      const movement = this.movementByAccount.get(accountId);
      const player = this.state.players.get(accountId);
      if (!movement || !player) continue;

      const next = stepMovement(movement, action, dt);
      this.movementByAccount.set(accountId, next);

      player.x = next.position.x;
      player.y = next.position.y;
      player.z = next.position.z;
      player.yaw = action.yaw;
      player.grounded = next.grounded;
    }

    for (const accountId of this.connectedAccounts) {
      const vitals = this.playerVitals.get(accountId);
      const movement = this.movementByAccount.get(accountId);
      if (!vitals || !movement) continue;

      const sprinting = this.pendingMove.get(accountId)?.action.sprint ?? false;
      const calories = drainCalories(vitals.calories, dt, sprinting);

      const dx = movement.position.x - HAZARD_ZONE_CENTER.x;
      const dz = movement.position.z - HAZARD_ZONE_CENTER.z;
      const inHazardZone = Math.hypot(dx, dz) <= HAZARD_ZONE_RADIUS_M;
      const exposure = inHazardZone
        ? Math.min(EXPOSURE_MAX, vitals.exposure + computeExposureIntake(EXPOSURE_ZONE_RATES.medium, 0, dt))
        : decayExposure(vitals.exposure, dt);

      const starvation = computeStarvationDamage(calories, dt);
      const exposureDamage = computeExposureDamage(exposure) * dt;
      const health = Math.max(0, Math.min(HEALTH_MAX, vitals.health - starvation - exposureDamage));
      const next = { calories, health, exposure };
      this.playerVitals.set(accountId, next);

      this.clientsByAccount.get(accountId)?.send('vitals', next);
    }

    this.tickCrafting(dt);

    if (this.state.tick % CHECKPOINT_INTERVAL_TICKS === 0) {
      this.checkpoint();
    }
  }
}
