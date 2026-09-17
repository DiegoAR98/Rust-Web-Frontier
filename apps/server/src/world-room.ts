import { Room, type Client } from '@colyseus/core';
import { CommandSchema, type Command, type CommandResult } from '@rwf/protocol';
import { getConsumable, getItem, getRecipe } from '@rwf/content';
import {
  addToInventory,
  applyBleedWound,
  CALORIE_MAX,
  CALORIE_SPAWN,
  CREATURE_SPECS,
  harvestCarcassHit,
  progressChannel,
  startChannel,
  spawnCreature as simSpawnCreature,
  stepCreature,
  tickBleed,
  type CarcassState as SimCarcassState,
  type ChannelState,
  type BleedWound,
  type CreatureKind,
  type CreatureState as SimCreatureState,
  type Point3,
  computeExposureDamage,
  computeExposureIntake,
  computeColdCalorieDrainPerS,
  computeColdDamagePerS,
  computeColdDeficit,
  computeRegenPerS,
  computeStarvationDamage,
  countFreeCapacity,
  dayPhase,
  lowlandColdPressure,
  countInInventory,
  decayExposure,
  drainCalories,
  EXPOSURE_MAX,
  EXPOSURE_ZONE_RATES,
  HEALTH_MAX,
  HEALTH_SPAWN,
  MELEE_SWING_CALORIE_COST,
  REGEN_CALORIE_COST_PER_HP,
  harvestNode,
  removeFromInventory,
  startQueueEntry,
  stepMovement,
  stepStation,
  takeItem as simTakeItem,
  tickQueueEntry,
  FUEL_DEFINITION_ID,
  STATION_SPECS,
  type MovementState,
  type QueueEntry,
  type ResourceNode,
  type Slot,
  type StationKind,
  type StationSpec,
  type StationState,
  type WorldItem,
} from '@rwf/sim';
import { WorldStore, type StatusEffectRecord, type Vec3 } from './persistence.js';
import { CarcassState, CreatureState, PlayerState, WorldItemState, WorldState } from './world-state.js';

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
/**
 * GDD section 6: "Melee and animal bites have 20% for 0.5 HP/s for 10
 * seconds." Arrows and bullets roll 25% for 1 HP/s over the same duration;
 * they arrive with M3's weapons.
 */
const BITE_BLEED_CHANCE = 0.2;
const BITE_BLEED_RATE_PER_S = 0.5;
const BLEED_DURATION_S = 10;
/**
 * CONTENT section 5's tool melee table: "rock 10, stone hatchet 15, iron
 * hatchet 25, pickaxe 20". Which one a player is swinging needs the equip/belt
 * system the gather rate is also waiting on, so it is the rock everyone starts
 * with.
 */
const MELEE_DAMAGE = 10;
/**
 * How long a hurt animal stays alarmed. GDD section 7 says prey "flee when
 * approached or hurt" and that "damage alerts the victim independently of
 * detection", but gives no duration; this is the project's number.
 */
const ALARM_DURATION_S = 5;
/** GDD section 7: "Unharvested carcasses expire after 10 online minutes." */
const CARCASS_LIFETIME_TICKS = 10 * 60 * TICK_RATE_HZ;
/** GDD section 5: "A player starts with a rock, a torch and bandages." */
const SPAWN_KIT: Array<[string, number]> = [
  ['rock', 1],
  ['torch', 1],
  ['bandage', 2],
];
/**
 * GDD section 6's use channels: "food/water/cleanser 1 second, bandage 2,
 * field dressing 3, surgeon kit 4." Only the bandage does anything yet -- it
 * clears bleeding; the healing-over-time kits need the medical regeneration
 * rules from the same section, which nothing else is waiting on.
 */
const USE_CHANNEL_SECONDS: Record<string, number> = { bandage: 2 };

/** How long a use channel runs, for medicine or for food. */
function useChannelSeconds(definitionId: string): number | undefined {
  return USE_CHANNEL_SECONDS[definitionId] ?? getConsumable(definitionId)?.channelSeconds;
}

/** GDD section 6: a fire within 4 m is what "a nearby campfire" means. */
const CAMPFIRE_WARMTH_RADIUS_M = 4;
/** GDD section 6: "A shared 2-second post-use cooldown prevents instant stacked medicine." */
const USE_COOLDOWN_TICKS = 2 * TICK_RATE_HZ;
/** GDD section 6: raw meat "applies 20 seconds of sickness at 0.5 HP/s". */
const POISON_RATE_PER_S = 0.5;

interface ClientUserData {
  accountId: string;
  sessionEpoch: number;
}

interface NodeConfig {
  definitionId: string;
  yieldPerHit: number;
  position: Vec3;
}

interface StationConfig {
  kind: StationKind;
  spec: StationSpec;
  position: Vec3;
}

type RoomClient = Client<{ userData: ClientUserData }>;
type MoveAction = Extract<Command['action'], { type: 'move' }>;

/** Fills a sparse slot array out to a fixed size, empty slots as null. */
function padSlots(slots: Slot[], size: number): Slot[] {
  const padded: Slot[] = new Array(size).fill(null);
  for (let i = 0; i < size; i++) padded[i] = slots[i] ?? null;
  return padded;
}

function fuelQuantity(station: StationState): number {
  return station.fuel?.quantity ?? 0;
}

/**
 * Spreads a quantity as evenly as it can across the slots that will take it,
 * rather than filling the first to its stack limit. A station converts one
 * unit per input slot per quantum (CONTENT section 3), so where the items land
 * decides the throughput: 24 ore in one furnace slot smelts at half the rate
 * of 12 in each, which is why CONTENT's worked example specifies "12 metal_ore
 * in each input".
 */
function spreadAcrossSlots(
  slots: Slot[],
  definitionId: string,
  quantity: number,
  stackLimit: number,
): { slots: Slot[]; overflow: number } {
  const next = slots.slice();
  let remaining = quantity;

  /** How many of this item a slot holds; Infinity if it is not usable at all. */
  const heldIn = (slot: Slot | undefined): number => {
    if (slot === null || slot === undefined) return 0;
    return slot.definitionId === definitionId ? slot.quantity : Infinity;
  };

  while (remaining > 0) {
    let target = -1;
    let targetHeld = Infinity;
    for (let i = 0; i < next.length; i++) {
      const held = heldIn(next[i]);
      if (held >= stackLimit || held >= targetHeld) continue;
      target = i;
      targetHeld = held;
    }
    if (target === -1) break; // every slot is full or holds something else
    next[target] = { definitionId, quantity: targetHeld + 1 };
    remaining -= 1;
  }

  return { slots: next, overflow: remaining };
}

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
  private readonly stations = new Map<string, StationState>();
  private readonly stationConfigs = new Map<string, StationConfig>();
  /** Who was last within reach of each station, so arrivals can be detected. */
  private readonly stationViewers = new Map<string, Set<string>>();
  private readonly creatures = new Map<string, SimCreatureState>();
  private readonly carcasses = new Map<
    string,
    { kind: CreatureKind; position: Point3; state: SimCarcassState; diedAtTick: number }
  >();
  private readonly woundsByAccount = new Map<string, BleedWound>();
  /**
   * GDD section 6 makes the bleed chance a server roll. Injectable so a test
   * can assert the wound rules rather than the coin flip; production uses
   * Math.random.
   */
  private bleedRoll: () => number = Math.random;
  private readonly channelsByAccount = new Map<string, { definitionId: string; channel: ChannelState }>();
  private readonly useCooldownUntilTick = new Map<string, number>();
  private readonly poisonByAccount = new Map<string, BleedWound>();
  /** When each account last took damage, for GDD section 6's 10s regen delay. */
  private readonly lastDamagedTick = new Map<string, number>();

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
    for (const [accountId, effects] of this.store.loadStatusEffects()) {
      for (const effect of effects) {
        const target = effect.kind === 'poison' ? this.poisonByAccount : this.woundsByAccount;
        target.set(accountId, { ratePerS: effect.ratePerS, remainingS: effect.remainingS });
      }
    }
    for (const [stationId, record] of this.store.loadStations()) {
      const spec = STATION_SPECS[record.kind];
      if (!spec) continue; // a station kind that left CONTENT; leave the row alone
      this.stationConfigs.set(stationId, { kind: record.kind, spec, position: record.position });
      this.stations.set(stationId, {
        lit: record.lit,
        // Only occupied slots are stored, so pad each compartment back out to
        // the spec's size -- a furnace with one ore left still has two slots.
        inputs: padSlots(record.inputs, spec.inputSlots),
        fuel: record.fuel,
        outputs: padSlots(record.outputs, spec.outputSlots),
        // Restored rather than reset, so a stopped host resumes the quantum it
        // was part-way through instead of discarding it (T17).
        progressS: record.progressS,
      });
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
    if (!this.resourceNodes.has('rock_1')) {
      // CONTENT section 4's mixed rock, metal_ore column only (budget 60,
      // yield 3). The real node carries three simultaneous budgets and pays
      // all of them per swing, which needs a multi-resource node model;
      // without any ore at all a furnace can only ever make charcoal.
      this.spawnNode('rock_1', 'metal_ore', 60, 3, { x: 0, y: 0.5, z: -6 });
    }
    // Placed outside HAZARD_ZONE_RADIUS_M so tending a fire is not also a
    // stint in the hot-ore zone. Built stations arrive with M2's building
    // system; until then the world starts with one of each.
    if (!this.stations.has('furnace_1')) {
      this.spawnStation('furnace_1', 'furnace', { x: 6, y: 0.5, z: 0 });
    }
    if (!this.stations.has('campfire_1')) {
      this.spawnStation('campfire_1', 'campfire', { x: -6, y: 0.5, z: 0 });
    }
    // A handful of CONTENT section 4's budget of 24. The wolf is anchored
    // beyond its own 25 m notice range from spawn, so joining the world is not
    // immediately an ambush. Nothing respawns: CONTENT's rule (at least 15
    // minutes and no player within 30 m of the anchor) needs a spawn director
    // this does not have, so a hunted-out world stays empty until a restart.
    if (this.creatures.size === 0) {
      this.spawnCreature('deer_1', 'deer', { x: 12, y: 0, z: 12 });
      this.spawnCreature('deer_2', 'deer', { x: -12, y: 0, z: 8 });
      this.spawnCreature('wolf_1', 'wolf', { x: 0, y: 0, z: 30 });
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
        // Written for every known player, not only the wounded ones, so a
        // wound that closed since the last checkpoint is actually cleared
        // rather than left behind to be restored on the next restart.
        this.store.saveStatusEffects(accountId, this.statusEffectsOf(accountId));
      }
      for (const [accountId, entry] of this.craftingByAccount) {
        this.persistCrafting(accountId, entry);
      }
      for (const [stationId, station] of this.stations) {
        // Class-2 only: the partially elapsed quantum. Contents were already
        // written at the commit that changed them.
        this.store.saveStationProgress(stationId, station.progressS, station.lit);
      }
    });
  }

  /** Test-only accessors for the wildlife and bleeding verticals. */
  creatureForTest(creatureId: string): SimCreatureState | undefined {
    return this.creatures.get(creatureId);
  }

  carcassForTest(carcassId: string): SimCarcassState | undefined {
    return this.carcasses.get(carcassId)?.state;
  }

  tickForTest(): number {
    return this.state.tick;
  }

  /** Test-only: lets a test take consecutive swings without waiting out the 1s interval. */
  clearSwingCooldownForTest(accountId: string): void {
    this.lastSwingTick.delete(accountId);
  }

  channelForTest(accountId: string): { definitionId: string; channel: ChannelState } | undefined {
    return this.channelsByAccount.get(accountId);
  }

  advanceChannelsForTest(dt: number): void {
    this.tickChannels(dt);
  }

  /** Test-only: opens a bleed wound without needing something to bite you. */
  woundForTestSet(accountId: string, wound: BleedWound): void {
    this.woundsByAccount.set(accountId, wound);
  }

  /** Test-only: incoming damage, the kind that cancels a use channel. */
  damageForTest(accountId: string, damage: number): void {
    this.damagePlayer(accountId, damage, 'melee');
  }

  clearInventoryForTest(accountId: string): void {
    const empty: Slot[] = new Array(BACKPACK_SLOTS).fill(null);
    this.playerSlots.set(accountId, empty);
    this.store.savePlayerSlots(accountId, empty);
  }

  poisonForTest(accountId: string): BleedWound | null {
    return this.poisonByAccount.get(accountId) ?? null;
  }

  poisonForTestSet(accountId: string, wound: BleedWound): void {
    this.poisonByAccount.set(accountId, wound);
  }

  setVitalsForTest(accountId: string, vitals: { calories: number; health: number; exposure: number }): void {
    this.playerVitals.set(accountId, vitals);
  }

  setLastDamagedTickForTest(accountId: string, tick: number): void {
    this.lastDamagedTick.set(accountId, tick);
  }

  clearUseCooldownForTest(accountId: string): void {
    this.useCooldownUntilTick.delete(accountId);
  }

  expireCarcassesForTest(): void {
    this.expireCarcasses();
  }

  woundForTest(accountId: string): BleedWound | null {
    return this.woundsByAccount.get(accountId) ?? null;
  }

  /** Test-only: replaces GDD section 6's server bleed roll with a fixed one. */
  setBleedRollForTest(roll: () => number): void {
    this.bleedRoll = roll;
  }

  advanceCreaturesForTest(dt: number): void {
    this.tickCreatures(dt);
  }

  advanceBleedForTest(dt: number): void {
    this.tickBleeding(dt);
  }

  /** Test-only read/write accessors for the station vertical. */
  stationForTest(stationId: string): StationState | undefined {
    return this.stations.get(stationId);
  }

  setStationOutputsForTest(stationId: string, outputs: Slot[]): void {
    const station = this.stations.get(stationId);
    if (!station) return;
    station.outputs = outputs;
    this.persistStation(stationId); // seeded like grantForTest: durable, not just in memory
  }

  /** Test-only: runs the station loop for dt seconds without the real tick timer. */
  advanceStationsForTest(dt: number): void {
    this.tickStations(dt);
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
   * Seeds a creature. Live animals are public world state, so unlike a
   * station's contents they ride the replicated schema: everyone can see where
   * a wolf is. Nothing persists them yet -- a restart repopulates the world
   * from the spawn table rather than restoring where each animal stood, which
   * needs CONTENT section 4's respawn rules (15 minutes and no player within
   * 30 m) to mean anything.
   */
  spawnCreature(creatureId: string, kind: CreatureKind, anchor: Point3): void {
    this.creatures.set(creatureId, simSpawnCreature(kind, anchor));
    const replicated = new CreatureState();
    replicated.kind = kind;
    replicated.x = anchor.x;
    replicated.y = anchor.y;
    replicated.z = anchor.z;
    replicated.health = CREATURE_SPECS[kind].health;
    this.state.creatures.set(creatureId, replicated);
  }

  /**
   * The body a creature will go for: the nearest one, connected or not. GDD
   * section 12 is explicit that a sleeper can still be killed by wildlife.
   */
  private nearestBody(position: Point3): { accountId: string; position: Point3 } | null {
    let nearest: { accountId: string; position: Point3 } | null = null;
    let nearestDistance = Infinity;
    for (const [accountId, movement] of this.movementByAccount) {
      const distance = Math.hypot(
        movement.position.x - position.x,
        movement.position.y - position.y,
        movement.position.z - position.z,
      );
      if (distance >= nearestDistance) continue;
      nearest = { accountId, position: movement.position };
      nearestDistance = distance;
    }
    return nearest;
  }

  /** Advances every living creature and applies whatever they bite. */
  private tickCreatures(dt: number): void {
    for (const [creatureId, creature] of this.creatures) {
      const spec = CREATURE_SPECS[creature.kind];
      const target = this.nearestBody(creature.position);
      const { state, attackDamage } = stepCreature(creature, spec, target?.position ?? null, dt);
      this.creatures.set(creatureId, state);

      const replicated = this.state.creatures.get(creatureId);
      if (replicated) {
        replicated.x = state.position.x;
        replicated.y = state.position.y;
        replicated.z = state.position.z;
        replicated.health = state.health;
        replicated.mode = state.mode;
      }

      if (attackDamage <= 0 || !target) continue;
      this.damagePlayer(target.accountId, attackDamage, 'bite');
    }
  }

  /**
   * Applies damage from an external source, with GDD section 6's bleed roll
   * where the source can open a wound: "melee and animal bites have 20% for
   * 0.5 HP/s for 10 seconds".
   */
  private damagePlayer(accountId: string, damage: number, source: 'bite' | 'melee'): void {
    const vitals = this.playerVitals.get(accountId);
    if (!vitals) return;
    this.playerVitals.set(accountId, { ...vitals, health: Math.max(0, vitals.health - damage) });
    this.lastDamagedTick.set(accountId, this.state.tick);
    this.cancelChannel(accountId);

    if (source === 'bite' && this.bleedRoll() < BITE_BLEED_CHANCE) {
      // applyBleedWound takes the higher rate and later expiry rather than
      // summing, so a second bite cannot double the bleed (GDD section 6).
      this.woundsByAccount.set(
        accountId,
        applyBleedWound(this.woundsByAccount.get(accountId) ?? null, BITE_BLEED_RATE_PER_S, BLEED_DURATION_S),
      );
    }
  }

  /**
   * Bleeds every wounded body. Separate from tickSurvival because GDD section
   * 12 keeps bleeding running on a disconnected sleeper while calorie drain,
   * regeneration and cold damage stop.
   */
  private tickBleeding(dt: number): void {
    // Food poisoning is the same rule with a different name (GDD section 6:
    // "20 seconds of sickness at 0.5 HP/s"), so it runs through the same loop.
    for (const effects of [this.woundsByAccount, this.poisonByAccount]) {
      for (const [accountId, wound] of effects) {
        const { wound: next, damage } = tickBleed(wound, dt);
        if (next) {
          effects.set(accountId, next);
        } else {
          effects.delete(accountId);
        }

        const vitals = this.playerVitals.get(accountId);
        if (!vitals || damage <= 0) continue;
        this.playerVitals.set(accountId, { ...vitals, health: Math.max(0, vitals.health - damage) });
        // Bleeding counts as damage for the regeneration delay, but it does
        // not cancel a use channel; see damagePlayer and D36.
        this.lastDamagedTick.set(accountId, this.state.tick);
      }
    }
  }

  private statusEffectsOf(accountId: string): StatusEffectRecord[] {
    const effects: StatusEffectRecord[] = [];
    const bleed = this.woundsByAccount.get(accountId);
    if (bleed) effects.push({ kind: 'bleed', ...bleed });
    const poison = this.poisonByAccount.get(accountId);
    if (poison) effects.push({ kind: 'poison', ...poison });
    return effects;
  }

  /** Seeds a carcass directly; the world normally makes them by killing something. */
  spawnCarcass(carcassId: string, kind: CreatureKind, position: Point3): void {
    this.carcasses.set(carcassId, {
      kind,
      position: { ...position },
      state: { hitsUsed: 0 },
      diedAtTick: this.state.tick,
    });
    const replicated = new CarcassState();
    replicated.kind = kind;
    replicated.x = position.x;
    replicated.y = position.y;
    replicated.z = position.z;
    this.state.carcasses.set(carcassId, replicated);
  }

  private removeCarcass(carcassId: string): void {
    this.carcasses.delete(carcassId);
    this.state.carcasses.delete(carcassId);
  }

  /**
   * A melee swing at an animal. Damage is the rock's 10 (CONTENT section 5's
   * tool melee table): which tool a player is swinging needs the equip/belt
   * system that the gather rate is waiting on too, so everyone punches with a
   * rock for now.
   */
  private resolveAttackCreature(accountId: string, creatureId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const creature = this.creatures.get(creatureId);
    if (!creature) return { ...base, accepted: false, reasonCode: 'not_found' };
    if (!this.isWithinReach(accountId, creature.position)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    if (this.isSwingOnCooldown(accountId)) return { ...base, accepted: false, reasonCode: 'rate_limited' };
    this.lastSwingTick.set(accountId, this.state.tick);
    this.chargeSwingCalorie(accountId);

    const health = creature.health - MELEE_DAMAGE;
    // GDD section 7: "Prey flee when approached or hurt", and "damage alerts
    // the victim independently of detection" -- so being hit has to make an
    // animal run even from a player it never noticed. GDD gives no duration
    // for that alarm; five seconds is this project's number.
    this.creatures.set(creatureId, { ...creature, health, alarmS: ALARM_DURATION_S });

    if (health <= 0) {
      this.creatures.delete(creatureId);
      this.state.creatures.delete(creatureId);
      this.spawnCarcass(creatureId, creature.kind, creature.position);
      return { ...base, accepted: true, reasonCode: 'ok' };
    }

    const replicated = this.state.creatures.get(creatureId);
    if (replicated) replicated.health = health;
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * One of the four tool hits a carcass pays out over (GDD section 7). The
   * pool is spent by the carcass, not by the player, so two people taking
   * turns still only ever extract one animal's worth.
   */
  private resolveHarvestCarcass(accountId: string, carcassId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const carcass = this.carcasses.get(carcassId);
    if (!carcass) return { ...base, accepted: false, reasonCode: 'not_found' };
    if (!this.isWithinReach(accountId, carcass.position)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    if (this.isSwingOnCooldown(accountId)) return { ...base, accepted: false, reasonCode: 'rate_limited' };

    const totals = CREATURE_SPECS[carcass.kind].harvest;
    const { state, granted } = harvestCarcassHit(carcass.state, totals);
    const entries = Object.entries(granted).filter(([, quantity]) => quantity > 0);
    if (entries.length === 0) {
      this.removeCarcass(carcassId);
      return { ...base, accepted: false, reasonCode: 'depleted' };
    }

    // Capacity for the whole hit before any of it is taken, same rule as a
    // gather: a full pack refuses rather than voiding part of the pool.
    let slots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    for (const [definitionId, quantity] of entries) {
      if (countFreeCapacity(slots, definitionId, getItem(definitionId)?.stack ?? 1) < quantity) {
        return { ...base, accepted: false, reasonCode: 'no_space' };
      }
    }

    this.lastSwingTick.set(accountId, this.state.tick);
    this.chargeSwingCalorie(accountId);
    for (const [definitionId, quantity] of entries) {
      const { slots: next, overflow } = addToInventory(
        slots,
        definitionId,
        quantity,
        getItem(definitionId)?.stack ?? 1,
      );
      if (overflow > 0) {
        throw new Error(`harvest overflow of ${overflow} ${definitionId} despite a capacity check`);
      }
      slots = next;
    }
    this.playerSlots.set(accountId, slots);
    this.store.savePlayerSlots(accountId, slots);

    const replicated = this.state.carcasses.get(carcassId);
    if (replicated) replicated.hitsUsed = state.hitsUsed;
    if (state.hitsUsed >= 4) {
      // A spent pool is gone, rather than lingering for a fifth hit to find.
      this.removeCarcass(carcassId);
    } else {
      this.carcasses.set(carcassId, { ...carcass, state });
    }
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * GDD section 7: "Unharvested carcasses expire after 10 online minutes."
   * Counted in ticks, so a stopped host does not rot the world (T17). The
   * clock runs from death and is not reset by a partial harvest -- GDD says
   * "unharvested", which does not say what a half-skinned one does.
   */
  private expireCarcasses(): void {
    for (const [carcassId, carcass] of this.carcasses) {
      if (this.state.tick - carcass.diedAtTick < CARCASS_LIFETIME_TICKS) continue;
      this.removeCarcass(carcassId);
    }
  }

  /**
   * Starts a use channel (GDD section 6). Nothing is consumed here: the item
   * is spent only when the channel completes, which is what makes cancelling
   * free.
   */
  private resolveUseItem(accountId: string, definitionId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const durationS = useChannelSeconds(definitionId);
    if (durationS === undefined) return { ...base, accepted: false, reasonCode: 'not_found' };

    const cooldownUntil = this.useCooldownUntilTick.get(accountId);
    if (cooldownUntil !== undefined && this.state.tick < cooldownUntil) {
      return { ...base, accepted: false, reasonCode: 'rate_limited' };
    }
    if (this.channelsByAccount.has(accountId)) return { ...base, accepted: false, reasonCode: 'busy' };

    const slots = this.playerSlots.get(accountId) ?? [];
    if (countInInventory(slots, definitionId) < 1) {
      return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
    }

    this.channelsByAccount.set(accountId, { definitionId, channel: startChannel(durationS) });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * GDD section 6: "Damage, sprint, death or disconnect cancels without
   * consumption." Read as *incoming* damage: a bleed wound that cancelled the
   * bandage treating it, every tick, would make bleeding untreatable, which is
   * the opposite of what T08 describes. So bleeding, starvation, exposure and
   * cold do not cancel; bites do.
   */
  private cancelChannel(accountId: string): void {
    if (!this.channelsByAccount.delete(accountId)) return;
    this.sendChannel(accountId);
  }

  /** Advances every open use channel, consuming and applying only on completion. */
  private tickChannels(dt: number): void {
    for (const [accountId, open] of this.channelsByAccount) {
      if (this.pendingMove.get(accountId)?.action.sprint) {
        this.cancelChannel(accountId);
        continue;
      }

      const { channel, completed } = progressChannel(open.channel, dt);
      if (!completed) {
        this.channelsByAccount.set(accountId, { ...open, channel: channel! });
        continue;
      }

      // Consume and apply together: a completion that spent the bandage but
      // failed to clear the wound would be worse than not completing at all.
      const slots = this.playerSlots.get(accountId) ?? [];
      const { slots: next, removed } = removeFromInventory(slots, open.definitionId, 1);
      this.channelsByAccount.delete(accountId);
      this.useCooldownUntilTick.set(accountId, this.state.tick + USE_COOLDOWN_TICKS);
      if (removed < 1) {
        // The item left the pack while the channel ran; nothing to apply.
        this.sendChannel(accountId);
        continue;
      }

      this.playerSlots.set(accountId, next);
      this.store.savePlayerSlots(accountId, next);
      if (open.definitionId === 'bandage') this.woundsByAccount.delete(accountId);
      this.applyConsumable(accountId, open.definitionId);

      const client = this.clientsByAccount.get(accountId);
      client?.send('inventory', { slots: next });
      this.sendChannel(accountId);
    }
  }

  /**
   * Applies what eating something does (CONTENT section 1, GDD section 6).
   * Raw meat is deliberately edible: it feeds badly and makes you sick, which
   * is the decision the cooking loop exists to let you avoid.
   */
  private applyConsumable(accountId: string, definitionId: string): void {
    const effect = getConsumable(definitionId);
    const vitals = this.playerVitals.get(accountId);
    if (!effect || !vitals) return;

    this.playerVitals.set(accountId, {
      calories: Math.min(CALORIE_MAX, vitals.calories + effect.calories),
      health: Math.min(HEALTH_MAX, vitals.health + effect.health),
      exposure: Math.max(0, vitals.exposure + effect.exposure),
    });

    if (effect.poisonSeconds > 0) {
      // GDD section 6: "Repeated consumption refreshes, not stacks, the
      // duration" -- which is applyBleedWound's max-rate/latest-expiry rule.
      // Poisoning is the same shape of timed damage as bleeding.
      this.poisonByAccount.set(
        accountId,
        applyBleedWound(this.poisonByAccount.get(accountId) ?? null, POISON_RATE_PER_S, effect.poisonSeconds),
      );
    }
  }

  /** Tells one owner about their own open channel, so the HUD can show a timer. */
  private sendChannel(accountId: string): void {
    const open = this.channelsByAccount.get(accountId);
    this.clientsByAccount.get(accountId)?.send('channel', {
      definitionId: open?.definitionId ?? null,
      elapsedS: open?.channel.elapsedS ?? 0,
      durationS: open?.channel.durationS ?? 0,
    });
  }

  /** GDD section 6's "nearby campfire": a lit one within 4 m. */
  private isNearLitCampfire(position: Point3): boolean {
    for (const [stationId, config] of this.stationConfigs) {
      if (config.kind !== 'campfire') continue;
      if (!this.stations.get(stationId)?.lit) continue;
      const distance = Math.hypot(
        position.x - config.position.x,
        position.y - config.position.y,
        position.z - config.position.z,
      );
      if (distance <= CAMPFIRE_WARMTH_RADIUS_M) return true;
    }
    return false;
  }

  /**
   * GDD section 6: "Every valid melee swing additionally costs 1 calorie."
   * Charged only on swings the server accepted, so a refused one is free.
   */
  private chargeSwingCalorie(accountId: string): void {
    const vitals = this.playerVitals.get(accountId);
    if (!vitals) return;
    this.playerVitals.set(accountId, {
      ...vitals,
      calories: Math.max(0, vitals.calories - MELEE_SWING_CALORIE_COST),
    });
  }

  private isSwingOnCooldown(accountId: string): boolean {
    const lastSwing = this.lastSwingTick.get(accountId);
    return lastSwing !== undefined && this.state.tick - lastSwing < SWING_INTERVAL_TICKS;
  }

  /** Seeds a furnace or campfire; not a player-facing command until M2 building. */
  spawnStation(stationId: string, kind: StationKind, position: Vec3 = { x: 0, y: 0, z: 0 }): void {
    const spec = STATION_SPECS[kind];
    const station: StationState = {
      lit: false,
      inputs: new Array(spec.inputSlots).fill(null),
      fuel: null,
      outputs: new Array(spec.outputSlots).fill(null),
      progressS: 0,
    };
    this.stationConfigs.set(stationId, { kind, spec, position });
    this.stations.set(stationId, station);
    this.persistStation(stationId);
  }

  private persistStation(stationId: string): void {
    const station = this.stations.get(stationId);
    const config = this.stationConfigs.get(stationId);
    if (!station || !config) return;
    this.store.saveStation(stationId, {
      kind: config.kind,
      lit: station.lit,
      progressS: station.progressS,
      position: config.position,
      inputs: station.inputs,
      fuel: station.fuel,
      outputs: station.outputs,
    });
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
    // GDD section 5's spawn kit. Epoch 1 is an account's very first join ever,
    // which is the only signal that separates a new player from one who has
    // simply emptied their pack. Respawn-on-death gets its own rule with M2.
    if (sessionEpoch === 1) {
      this.grantSpawnKit(accountId);
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
      // GDD section 6: a disconnect cancels an open use channel, without
      // consuming what it would have spent.
      this.channelsByAccount.delete(accountId);
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
      // A take that succeeded changed the pack; tell the owner, same as a
      // gather does. Inventory is private, so it cannot ride the shared state.
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
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

    if (command.action.type === 'craft') {
      const { recipeId, quantity } = command.action;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveCraft(accountId, recipeId, quantity, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      this.sendCrafting(accountId);
      return;
    }

    if (command.action.type === 'attackCreature') {
      const creatureId = command.action.creatureId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveAttackCreature(accountId, creatureId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      return;
    }

    if (command.action.type === 'harvestCarcass') {
      const carcassId = command.action.carcassId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveHarvestCarcass(accountId, carcassId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      return;
    }

    if (command.action.type === 'useItem') {
      const definitionId = command.action.definitionId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveUseItem(accountId, definitionId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      this.sendChannel(accountId);
      return;
    }

    // The three station commands (CONTENT section 3). Insert and take move
    // items, so they are transactions like takeItem and craft and go through
    // commitOutcome; lighting is keyed the same way purely for uniformity.
    const action = command.action;
    const stationId = action.stationId;
    const encoded = this.store.commitOutcome(key, () => {
      if (action.type === 'stationInsert') {
        return JSON.stringify(
          this.resolveStationInsert(accountId, stationId, action.definitionId, action.quantity, command.sequence),
        );
      }
      if (action.type === 'stationTake') {
        return JSON.stringify(this.resolveStationTake(accountId, stationId, command.sequence));
      }
      return JSON.stringify(this.resolveStationLight(accountId, stationId, action.lit, command.sequence));
    });
    client.send('commandResult', JSON.parse(encoded) as CommandResult);
    client.send('inventory', { slots: this.playerSlots.get(accountId) });
    this.sendStation(stationId);
  }

  /**
   * A station command's common preamble: it must exist and be within arm's
   * reach. Reach is the *only* gate -- anyone standing at a furnace can empty
   * it. GDD section 11's ownership and door permissions are M2 scope, so until
   * they land a station is public to whoever walks up to it.
   */
  private resolveStationAccess(
    accountId: string,
    stationId: string,
  ): { station: StationState; config: StationConfig } | CommandResult['reasonCode'] {
    const station = this.stations.get(stationId);
    const config = this.stationConfigs.get(stationId);
    if (!station || !config) return 'not_found';
    if (!this.isWithinReach(accountId, config.position)) return 'out_of_range';
    return { station, config };
  }

  /**
   * Moves items from the player's pack into a station. The destination slot is
   * inferred, not chosen: wood is fuel and nothing else (CONTENT section 3's
   * "no charcoal duplication from simultaneously counting wood as input and
   * fuel" is exactly that rule), and anything the spec converts is an input.
   * Inputs spread evenly across the station's input slots, because each slot
   * converts one unit per quantum -- piling 24 ore into one furnace slot would
   * halve the throughput CONTENT's worked example expects. A real per-slot
   * station UI arrives with M2's containers.
   */
  private resolveStationInsert(
    accountId: string,
    stationId: string,
    definitionId: string,
    quantity: number,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const access = this.resolveStationAccess(accountId, stationId);
    if (typeof access === 'string') return { ...base, accepted: false, reasonCode: access };
    const { station, config } = access;

    const isFuel = definitionId === FUEL_DEFINITION_ID;
    if (!isFuel && !config.spec.conversions[definitionId]) {
      return { ...base, accepted: false, reasonCode: 'not_found' };
    }

    const slots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    if (countInInventory(slots, definitionId) < quantity) {
      return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
    }

    const stackLimit = getItem(definitionId)?.stack ?? 1;
    // Capacity first: taking the items out of the pack and then discovering
    // the station is full would destroy them.
    const destination = isFuel
      ? addToInventory([station.fuel], definitionId, quantity, stackLimit)
      : spreadAcrossSlots(station.inputs, definitionId, quantity, stackLimit);
    if (destination.overflow > 0) {
      // All-or-nothing, unlike a take: half-filling a furnace slot silently
      // would leave the player wondering where the rest went.
      return { ...base, accepted: false, reasonCode: 'no_space' };
    }

    if (isFuel) {
      station.fuel = destination.slots[0] ?? null;
    } else {
      station.inputs = destination.slots;
    }
    this.playerSlots.set(accountId, removeFromInventory(slots, definitionId, quantity).slots);
    this.store.savePlayerSlots(accountId, this.playerSlots.get(accountId)!);
    this.persistStation(stationId);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /** Empties a station's outputs into the player's pack, as far as they fit. */
  private resolveStationTake(accountId: string, stationId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const access = this.resolveStationAccess(accountId, stationId);
    if (typeof access === 'string') return { ...base, accepted: false, reasonCode: access };
    const { station } = access;

    let slots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    const remaining: Slot[] = [];
    let moved = 0;
    for (const slot of station.outputs) {
      if (!slot) {
        remaining.push(null);
        continue;
      }
      const stackLimit = getItem(slot.definitionId)?.stack ?? 1;
      const result = addToInventory(slots, slot.definitionId, slot.quantity, stackLimit);
      slots = result.slots;
      moved += slot.quantity - result.overflow;
      // Whatever will not fit stays in the station rather than being dropped.
      remaining.push(result.overflow > 0 ? { definitionId: slot.definitionId, quantity: result.overflow } : null);
    }

    if (moved === 0) {
      return {
        ...base,
        accepted: false,
        reasonCode: station.outputs.some((slot) => slot) ? 'no_space' : 'depleted',
      };
    }

    station.outputs = remaining;
    this.playerSlots.set(accountId, slots);
    this.store.savePlayerSlots(accountId, slots);
    this.persistStation(stationId);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  private resolveStationLight(
    accountId: string,
    stationId: string,
    lit: boolean,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const access = this.resolveStationAccess(accountId, stationId);
    if (typeof access === 'string') return { ...base, accepted: false, reasonCode: access };

    access.station.lit = lit;
    this.store.saveStationProgress(stationId, access.station.progressS, lit);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * Station contents are container contents, which TECHNICAL section 3 keeps
   * off the shared schema, so this is a targeted message -- and only to
   * players standing at the station, who are the ones who could open it.
   */
  private stationPayload(stationId: string): unknown {
    const station = this.stations.get(stationId);
    const config = this.stationConfigs.get(stationId);
    return {
      stationId,
      kind: config?.kind,
      lit: station?.lit ?? false,
      progressS: station?.progressS ?? 0,
      inputs: station?.inputs ?? [],
      fuel: station?.fuel ?? null,
      outputs: station?.outputs ?? [],
    };
  }

  private sendStation(stationId: string): void {
    const config = this.stationConfigs.get(stationId);
    if (!this.stations.has(stationId) || !config) return;
    const payload = this.stationPayload(stationId);
    for (const accountId of this.connectedAccounts) {
      if (!this.isWithinReach(accountId, config.position)) continue;
      this.clientsByAccount.get(accountId)?.send('station', payload);
    }
  }

  private resolveTakeItem(accountId: string, itemInstanceId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const position = this.itemPositions.get(itemInstanceId);
    // Checked before the claim so an out-of-reach attempt neither takes the
    // item nor reveals whether it was still unclaimed.
    if (position && !this.isWithinReach(accountId, position)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }

    // Checked before the claim, for the same reason resolveHitNode peeks
    // before harvesting: claiming the item and then finding nowhere to put it
    // would delete it from the world instead of picking it up.
    const worldItem = this.worldItems.get(itemInstanceId);
    const currentSlots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    if (worldItem && worldItem.claimedBy === null) {
      const stackLimit = getItem(worldItem.definitionId)?.stack ?? 1;
      if (countFreeCapacity(currentSlots, worldItem.definitionId, stackLimit) < 1) {
        return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
      }
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
      // The claim only removes the item from the world; this is what actually
      // puts it in the taker's pack (GDD section 5).
      const stackLimit = getItem(outcome.item.definitionId)?.stack ?? 1;
      const { slots, overflow } = addToInventory(currentSlots, outcome.item.definitionId, 1, stackLimit);
      if (overflow > 0) {
        // Unreachable given the capacity check above; failing loudly beats
        // silently destroying the item if the two ever disagree.
        throw new Error(`take overflow of ${outcome.item.definitionId} despite a capacity check`);
      }
      this.playerSlots.set(accountId, slots);
      this.store.savePlayerSlots(accountId, slots);
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
    this.chargeSwingCalorie(accountId);
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

  /**
   * Cold deficit for a player right now (GDD section 6): environment pressure
   * minus worn/fire/shelter warmth. Warmth is 0 for everyone until clothing
   * and fires exist, and the whole map is one lowland plane, so this is
   * currently uniform -- hence one value per tick rather than per player.
   */
  private currentColdDeficit(): number {
    const pressure = lowlandColdPressure(dayPhase(this.state.tick));
    return computeColdDeficit(pressure, 0);
  }

  /** Test-only read accessors for the cold vertical. */
  coldDeficitForTest(_accountId: string): number {
    return this.currentColdDeficit();
  }

  vitalsForTest(accountId: string): { calories: number; health: number; exposure: number } | undefined {
    return this.playerVitals.get(accountId);
  }

  /** Test-only: jumps the world clock, e.g. to reach nightfall without waiting 45 minutes. */
  setTickForTest(tick: number): void {
    this.state.tick = tick;
  }

  /** Test-only: runs one survival step of dt seconds without the real tick timer. */
  advanceSurvivalForTest(dt: number): void {
    this.tickSurvival(dt);
  }

  private grantSpawnKit(accountId: string): void {
    let slots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    for (const [definitionId, quantity] of SPAWN_KIT) {
      slots = addToInventory(slots, definitionId, quantity, getItem(definitionId)?.stack ?? 1).slots;
    }
    this.playerSlots.set(accountId, slots);
    this.store.savePlayerSlots(accountId, slots);
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

    this.tickCreatures(dt);

    this.expireCarcasses();

    // Before tickSurvival, so a bite landing this tick is reflected in the
    // vitals message that goes out at the end of it.
    this.tickBleeding(dt);

    this.tickSurvival(dt);

    this.tickChannels(dt);

    this.tickCrafting(dt);

    this.tickStations(dt);

    if (this.state.tick % CHECKPOINT_INTERVAL_TICKS === 0) {
      this.checkpoint();
    }
  }

  /**
   * Advances every lit station by dt (CONTENT section 3). Time reaches a
   * station only through here, so a stopped host stops its fuel exactly as
   * T17 requires -- there is no wall-clock reading to catch up from.
   */
  private tickStations(dt: number): void {
    for (const [stationId, station] of this.stations) {
      const config = this.stationConfigs.get(stationId);
      if (!config) continue;

      const next = stepStation(station, config.spec, (id) => getItem(id)?.stack ?? 1, dt);
      this.stations.set(stationId, next);

      // A completed quantum always burns exactly one fuel, so this is the
      // cheapest true test of "did anything actually move". Progress alone is
      // class-2 continuous state that checkpoint() covers; writing on every
      // tick would put an fsync on the game loop for each lit station.
      if (fuelQuantity(next) === fuelQuantity(station)) continue;
      this.persistStation(stationId);
      this.sendStation(stationId);
    }

    this.sendStationsToArrivals();
  }

  /**
   * Sends a station's contents to a player the moment they come within reach
   * of it. Without this a player who walks up to a station sees nothing at all
   * until it next changes -- and a cold, empty one never changes. Tracked as
   * an arrival rather than resent on a timer so a crowd standing at a furnace
   * costs nothing.
   */
  private sendStationsToArrivals(): void {
    for (const [stationId, config] of this.stationConfigs) {
      const previous = this.stationViewers.get(stationId) ?? new Set<string>();
      const current = new Set<string>();
      for (const accountId of this.connectedAccounts) {
        if (!this.isWithinReach(accountId, config.position)) continue;
        current.add(accountId);
        if (previous.has(accountId)) continue;
        this.clientsByAccount.get(accountId)?.send('station', this.stationPayload(stationId));
      }
      this.stationViewers.set(stationId, current);
    }
  }

  /** Calories, starvation, hot-ore exposure and cold, for every connected player. */
  private tickSurvival(dt: number): void {
    const coldDeficit = this.currentColdDeficit();

    for (const accountId of this.connectedAccounts) {
      const vitals = this.playerVitals.get(accountId);
      const movement = this.movementByAccount.get(accountId);
      if (!vitals || !movement) continue;

      const sprinting = this.pendingMove.get(accountId)?.action.sprint ?? false;
      // Cold adds its drain on top of the movement drain (GDD section 6):
      // deficit 1-19 costs 0.1 cal/s, 20-39 costs 0.25/s, 40+ costs 0.5/s.
      const calories = Math.max(
        0,
        drainCalories(vitals.calories, dt, sprinting) - computeColdCalorieDrainPerS(coldDeficit) * dt,
      );

      const dx = movement.position.x - HAZARD_ZONE_CENTER.x;
      const dz = movement.position.z - HAZARD_ZONE_CENTER.z;
      const inHazardZone = Math.hypot(dx, dz) <= HAZARD_ZONE_RADIUS_M;
      const exposure = inHazardZone
        ? Math.min(EXPOSURE_MAX, vitals.exposure + computeExposureIntake(EXPOSURE_ZONE_RATES.medium, 0, dt))
        : decayExposure(vitals.exposure, dt);

      const starvation = computeStarvationDamage(calories, dt);
      const exposureDamage = computeExposureDamage(exposure) * dt;
      const coldDamage = computeColdDamagePerS(coldDeficit) * dt;
      const damage = starvation + exposureDamage + coldDamage;
      if (damage > 0) this.lastDamagedTick.set(accountId, this.state.tick);

      // GDD section 6's passive recovery. Without it health only ever falls:
      // the wolf outside is a one-way trip to 0 HP, which is not a state the
      // game can do anything with until M2's death transaction exists.
      const regenPerS = computeRegenPerS({
        calories,
        secondsSinceDamage: (this.state.tick - (this.lastDamagedTick.get(accountId) ?? -Infinity)) / TICK_RATE_HZ,
        bleeding: this.woundsByAccount.has(accountId),
        poisoned: this.poisonByAccount.has(accountId),
        exposure,
        coldDeficit,
        nearCampfire: this.isNearLitCampfire(movement.position),
      });
      const beforeRegen = Math.max(0, Math.min(HEALTH_MAX, vitals.health - damage));
      const health = Math.min(HEALTH_MAX, beforeRegen + regenPerS * dt);
      // "Each regenerated HP consumes two additional calories" -- charged on
      // what was actually healed, so a player already at full health pays
      // nothing.
      const healed = health - beforeRegen;

      const next = { calories: Math.max(0, calories - healed * REGEN_CALORIE_COST_PER_HP), health, exposure };
      this.playerVitals.set(accountId, next);

      this.clientsByAccount.get(accountId)?.send('vitals', {
        ...next,
        coldDeficit,
        phase: dayPhase(this.state.tick),
      });
    }
  }
}
