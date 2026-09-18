import { Room, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { CommandSchema, JoinOptionsSchema, type Command, type CommandResult } from '@rwf/protocol';
import { getBuildingPiece, getConsumable, getDeployable, getItem, getRecipe } from '@rwf/content';
import {
  addToInventory,
  applyBleedWound,
  moveAllThatFits,
  buildCorpse,
  cancelQueueEntry,
  CORPSE_SLOTS,
  chooseRespawnAnchor,
  pageOverflowIn,
  validateDeployablePlacement,
  validatePieceSite,
  cascadeRemoval,
  structuralMeleeDamage,
  structuralSplashDamage,
  characterBlastDamage,
  repairCost,
  repairableHp,
  REPAIR_CHANNEL_S,
  EXPLOSIVES,
  stepDecay,
  DECAY_INTERVAL_S,
  WOOD_DECAY,
  isReachBlocked,
  wallSegment,
  type GroundSegment,
  linkedSiteKeys,
  siteKey,
  worldPositionOf,
  PIECES_PER_BUILDING,
  PIECES_PER_OWNER,
  PLACEMENT_CLEARANCE_M,
  WORLD_ENTITY_CAP,
  type PieceSite,
  type CorpseInventory,
  type ItemStack,
  type RespawnAnchor,
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
  HAZARD_ZONE_CENTER,
  HAZARD_ZONE_RADIUS_M,
  HEALTH_MAX,
  HEALTH_SPAWN,
  MELEE_SWING_CALORIE_COST,
  REGEN_CALORIE_COST_PER_HP,
  harvestNode,
  removeFromInventory,
  resolveMove,
  footprintSegments,
  DEPLOYABLE_FOOTPRINT_M,
  INTERACT_REACH_M,
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
import { WorldStore, type CorpseRecord, type StatusEffectRecord, type Vec3 } from './persistence.js';
import {
  CarcassState,
  BuildingPieceState,
  CorpseState,
  CreatureState,
  DeployableState,
  DoorState,
  PlayerState,
  WorldItemState,
  WorldState,
} from './world-state.js';

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
// The placeholder hot-ore zone lives in @rwf/sim; see HAZARD_ZONE_CENTER there.
// INTERACT_REACH_M now lives in @rwf/sim, so the client aims at the same figure.
/**
 * Slack on the server's reach check. The client decides it is in range from
 * the position it has, which is always a little behind the server's; at
 * SPRINT 5.5 m/s a ~180ms round trip is about a metre of travel. Generous
 * enough never to refuse honest play, far too tight to farm from across the map.
 */
const INTERACT_REACH_TOLERANCE_M = 1;
/**
 * How far a builder can snap a piece. GDD section 10 gives no figure, and the
 * interact reach is too short for it: a 4 m cell's centre is 2.8 m from the
 * corner a player is standing on before the eye height is counted, so a
 * builder could not place the foundation they are stood on. Six metres lets
 * them build the cell they occupy and the one next to it, and no further.
 */
const BUILD_REACH_M = 6;
/**
 * CONTENT section 7's insert table: "wood_door | 500", "metal_door | 1000".
 * Only the wood door is craftable so far; the iron one is Bench/Default and
 * needs metal a player cannot smelt enough of yet.
 */
const DOOR_PLACED_HP: Record<string, number> = { wood_door: 500, metal_door: 1000 };
/** GDD section 11: "A building-wide raid lock lasts 60 seconds after any hostile damage". */
const RAID_LOCK_TICKS = 60 * TICK_RATE_HZ;
/** GDD section 10: "Breaking a door leaves its socket unavailable to everyone for 60 seconds." */
const BROKEN_SOCKET_LOCK_TICKS = 60 * TICK_RATE_HZ;

/**
 * Which of CONTENT section 8's two structural damage multipliers a piece
 * uses. Read off the id's tier prefix, which is how CONTENT names every one
 * of the eighteen pieces and both doors.
 */
function materialOf(definitionId: string): 'wood' | 'metal' {
  return definitionId.startsWith('metal') ? 'metal' : 'wood';
}
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
/**
 * GDD section 8: "player death bags 30 minutes; the timer never refreshes on
 * inspection." Counted in ticks like every other timer, so it freezes with the
 * host (T17) rather than running down against a wall clock.
 */
const CORPSE_LIFETIME_TICKS = 30 * 60 * TICK_RATE_HZ;
/** GDD section 8: "Player-dropped bags have a 10-minute lifetime". */
const BAG_LIFETIME_TICKS = 10 * 60 * TICK_RATE_HZ;
/** GDD section 12: "maximum five combined per account". */
const ANCHORS_PER_ACCOUNT = 5;
/**
 * GDD section 12: using an anchor "applies at least that cooldown to the
 * owner's other anchors within 50 m".
 */
const ANCHOR_SHARED_COOLDOWN_RADIUS_M = 50;
/**
 * GDD section 10: "awake connected owners or authorized builders within 50 m
 * refresh their building cluster's activity timestamp".
 */
const DECAY_ACTIVITY_RADIUS_M = 50;
/** Section 10 runs decay on a one-minute step; DECAY_INTERVAL_S is that minute. */
const DECAY_INTERVAL_TICKS = DECAY_INTERVAL_S * TICK_RATE_HZ;
/**
 * GDD section 12's "valid Coyote Wash or Juniper perimeter anchor". The real
 * map authors 16 arrival anchors (GDD section 13); until the map exists these
 * four stand in for them.
 *
 * They are far out deliberately. Section 12's rule is to prefer an anchor at
 * least 75 m from active enemies, and anchors huddled around the seeded
 * content could never satisfy it -- every respawn would take the "no safe
 * anchor" fallback and report the world as dangerous whether it was or not.
 * A perimeter is also what section 13's arrival anchors actually are.
 */
const RESPAWN_ANCHORS: RespawnAnchor[] = [
  { id: 'coyote_wash_n', position: { x: -90, y: 0, z: -60 } },
  { id: 'coyote_wash_s', position: { x: -80, y: 0, z: 70 } },
  { id: 'juniper_e', position: { x: 85, y: 0, z: -55 } },
  { id: 'juniper_w', position: { x: 95, y: 0, z: 60 } },
];
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
/** GDD section 6: "a fire within 4 m with unobstructed warmth ray gives 40". */
const FIRE_WARMTH = 40;

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
  private failed = false;
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
  /**
   * What last took health off each player, for the death recap. Six things can
   * kill you -- a bite, a blast, bleeding, poison, starving, the hot-ore zone
   * and the cold -- and the recap named none of them.
   */
  private readonly lastDamageCause = new Map<string, string>();
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
  /**
   * Which of the clear anchors a respawn lands on (GDD section 12). Injectable
   * for the same reason as bleedRoll: a test asserting "one of four" is barely
   * an assertion at all.
   */
  private respawnRoll: () => number = Math.random;
  private readonly channelsByAccount = new Map<
    string,
    {
      definitionId: string;
      channel: ChannelState;
      /**
       * A repair is the second thing that holds interact (GDD section 10), so
       * the channel carries what it is for rather than assuming an item.
       */
      repair?: { site: PieceSite; door: boolean };
    }
  >();
  private readonly useCooldownUntilTick = new Map<string, number>();
  private readonly poisonByAccount = new Map<string, BleedWound>();
  /** When each account last took damage, for GDD section 6's 10s regen delay. */
  private readonly lastDamagedTick = new Map<string, number>();
  /**
   * Dead players' bodies. Like stations, the contents live here rather than on
   * the replicated schema (TECHNICAL section 3); only existence and position
   * are public.
   */
  private readonly corpses = new Map<
    string,
    {
      ownerAccountId: string;
      position: Point3;
      inventory: CorpseInventory;
      diedAtTick: number;
      /**
       * GDD section 8 gives death bags 30 minutes and dropped bags 10, and
       * says drop containers "use the same 40-visible-slot plus paged overflow
       * representation as corpses" -- so they are the same thing here with
       * different clocks.
       */
      lifetimeTicks: number;
    }
  >();
  /**
   * Accounts with no live character until they respawn (GDD section 12:
   * "removes the live character, and marks the account dead"). Maps to the
   * tick they died on.
   */
  private readonly deadAccounts = new Map<string, number>();
  /** Who is currently standing over which corpse; see sendCorpsesToArrivals. */
  private readonly corpseViewers = new Map<string, Set<string>>();
  /**
   * Placed deployables (GDD section 10). Contents stay here rather than on the
   * schema, the same as stations and corpses (TECHNICAL section 3).
   */
  private readonly deployables = new Map<
    string,
    { definitionId: string; ownerAccountId: string; position: Point3; placedAtTick: number; slots: Slot[] }
  >();
  private readonly deployableViewers = new Map<string, Set<string>>();
  private nextDeployableId = 1;
  /**
   * Placed structural pieces, keyed by grid site (GDD section 10). Unlike a
   * crate a piece holds nothing, so this only carries what the schema cannot:
   * the site itself and when it went up.
   */
  private readonly buildingPieces = new Map<
    string,
    { definitionId: string; ownerAccountId: string; site: PieceSite; placedAtTick: number }
  >();
  /**
   * Undirected structural adjacency, maintained as pieces go up. Building
   * membership is walked from here rather than stored as a cluster id, which
   * would go stale the first time a collapse split a building in two.
   */
  private readonly pieceLinks = new Map<string, Set<string>>();
  /** Doors, keyed by the doorway site they hang in. */
  private readonly doors = new Map<
    string,
    { definitionId: string; ownerAccountId: string; open: boolean; site: PieceSite; installedAtTick: number }
  >();
  /**
   * Who may work each door besides its owner (GDD section 10). Per door, not
   * per owner: the section grants access "through a local interaction", which
   * is a thing you do standing at one door.
   */
  private readonly doorAccess = new Map<string, Set<string>>();
  /**
   * Section 10's "explicit builder", per owner rather than per building: a
   * building has no stable identity to key on -- membership is walked from the
   * structural links and changes whenever a piece goes up or comes down.
   */
  private readonly buildAccess = new Map<string, Set<string>>();
  /** Invalidated whenever a piece goes up or a door swings; see barriers(). */
  private barrierCache: GroundSegment[] | null = null;
  /** barriers() plus what you can walk into but not see through; see movementBarriers. */
  private movementBarrierCache: GroundSegment[] | null = null;
  /**
   * GDD section 11's raid lock, kept per piece so that "building-wide" can be
   * answered by walking the building the same way ownership is -- a building
   * has no id to key it on. Counted in ticks, so it freezes with the host like
   * every other timer (T17).
   */
  private readonly raidLockUntilTick = new Map<string, number>();
  /**
   * When each personal respawn anchor is next usable (GDD section 12). In
   * ticks, because the section says "Cooldowns use persisted simulation time"
   * -- a stopped host must not run them down.
   */
  private readonly anchorReadyAtTick = new Map<string, number>();
  /**
   * When each placed thing last had an awake owner or authorised builder
   * within 50 m (GDD section 10's decay). Keyed by site for a structural piece
   * and by id for a deployable; both decay on the same rule.
   */
  private readonly lastActivityTick = new Map<string, number>();
  /**
   * GDD section 10: "Breaking a door leaves its socket unavailable to everyone
   * for 60 seconds." Keyed by the doorway site, in ticks like every other
   * timer, and deliberately not limited to the attacker -- the point is that
   * the defender cannot re-hang a door the instant it breaks.
   */
  private readonly socketLockedUntilTick = new Map<string, number>();
  /** The tick the last decay minute ran on; see tickDecay. */
  private lastDecayTick = 0;

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
    this.store = new WorldStore(process.env.RWF_DB_PATH ?? 'runtime/world.sqlite');
    this.state = new WorldState();

    // Crash recovery (TECHNICAL section 7): resume from the last
    // checkpoint rather than starting a fresh world.
    this.state.tick = this.store.loadWorldTick();
    // Both locks are simulation timers, so they survive a restart rather than
    // being erased by one (T17). Expired rows are dropped on the way in.
    this.store.pruneSiteLocks(this.state.tick);
    for (const [key, until] of this.store.loadSiteLocks('raid')) this.raidLockUntilTick.set(key, until);
    for (const [key, until] of this.store.loadSiteLocks('socket')) this.socketLockedUntilTick.set(key, until);
    // Or the first decay pass after a restart fires immediately, however
    // recently the last one ran: the tick is restored and this was not, so
    // every restart charged a spare minute of decay. T17 wants no timer to
    // advance across a stop, and this one advanced by the whole world clock.
    this.lastDecayTick = this.state.tick;
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
      this.playerSlots.set(accountId, this.store.loadPlayerSlots(accountId, BACKPACK_SLOTS));
    }
    for (const [corpseId, record] of this.store.loadCorpses()) {
      this.corpses.set(corpseId, {
        ownerAccountId: record.ownerAccountId,
        position: record.position,
        // Only occupied slots are stored, so pad back out to the full 40.
        inventory: { slots: padSlots(record.slots, CORPSE_SLOTS), overflow: record.overflow },
        diedAtTick: record.diedAtTick,
        lifetimeTicks: record.lifetimeTicks,
      });
      const replicated = new CorpseState();
      replicated.ownerAccountId = record.ownerAccountId;
      replicated.x = record.position.x;
      replicated.y = record.position.y;
      replicated.z = record.position.z;
      this.state.corpses.set(corpseId, replicated);
    }
    for (const [deployableId, record] of this.store.loadDeployables()) {
      const definition = getDeployable(record.definitionId);
      if (!definition) continue; // a deployable kind that left CONTENT; leave the row alone
      this.deployables.set(deployableId, {
        definitionId: record.definitionId,
        ownerAccountId: record.ownerAccountId,
        position: record.position,
        placedAtTick: record.placedAtTick,
        slots: padSlots(record.slots, definition.slots),
      });
      if (record.anchorReadyAtTick > 0) this.anchorReadyAtTick.set(deployableId, record.anchorReadyAtTick);
      this.lastActivityTick.set(deployableId, record.lastActivityTick);
      const replicated = new DeployableState();
      replicated.definitionId = record.definitionId;
      replicated.ownerAccountId = record.ownerAccountId;
      replicated.x = record.position.x;
      replicated.y = record.position.y;
      replicated.z = record.position.z;
      replicated.health = record.health;
      this.state.deployables.set(deployableId, replicated);
      // Keep issuing fresh ids after a restart rather than colliding with a
      // restored one.
      const restoredNumber = Number(deployableId.replace('deployable_', ''));
      if (Number.isFinite(restoredNumber)) {
        this.nextDeployableId = Math.max(this.nextDeployableId, restoredNumber + 1);
      }
    }
    for (const [key, record] of this.store.loadBuildingPieces()) {
      const site: PieceSite = {
        form: record.form as PieceSite['form'],
        storey: record.storey,
        i: record.i,
        k: record.k,
        axis: (record.axis as PieceSite['axis']) ?? null,
      };
      this.buildingPieces.set(key, {
        definitionId: record.definitionId,
        ownerAccountId: record.ownerAccountId,
        site,
        placedAtTick: record.placedAtTick,
      });
      // GDD section 10's decay clock has to survive the restart, or a host
      // that restarts nightly never lets anything rot.
      this.lastActivityTick.set(key, record.lastActivityTick);
      const replicated = new BuildingPieceState();
      replicated.definitionId = record.definitionId;
      replicated.ownerAccountId = record.ownerAccountId;
      replicated.form = record.form;
      replicated.storey = record.storey;
      replicated.i = record.i;
      replicated.k = record.k;
      replicated.axis = record.axis ?? '';
      replicated.health = record.health;
      this.state.buildingPieces.set(key, replicated);
    }
    for (const [key, record] of this.store.loadDoors()) {
      this.doors.set(key, {
        definitionId: record.definitionId,
        ownerAccountId: record.ownerAccountId,
        open: record.open,
        site: {
          form: 'doorway',
          storey: record.storey,
          i: record.i,
          k: record.k,
          axis: record.axis === '' ? null : (record.axis as 'x' | 'z'),
        },
        installedAtTick: record.installedAtTick,
      });
      const replicated = new DoorState();
      replicated.definitionId = record.definitionId;
      replicated.ownerAccountId = record.ownerAccountId;
      replicated.open = record.open;
      replicated.storey = record.storey;
      replicated.i = record.i;
      replicated.k = record.k;
      replicated.axis = record.axis;
      replicated.health = record.health;
      this.state.doors.set(key, replicated);
    }
    // GDD section 10: "Permissions persist and can be revoked immediately."
    for (const [key, list] of this.store.loadDoorAccess()) this.doorAccess.set(key, list);
    for (const [owner, list] of this.store.loadBuildAccess()) this.buildAccess.set(owner, list);
    this.invalidateBarriers();
    // Rebuilt after every piece is back, because a link needs both ends to
    // exist and the rows come out of SQLite in no particular order.
    for (const [key, piece] of this.buildingPieces) {
      for (const linked of linkedSiteKeys(piece.site)) {
        if (this.buildingPieces.has(linked)) this.linkPieces(key, linked);
      }
    }
    for (const [accountId, diedAtTick] of this.store.loadDeadAccounts()) {
      // The checkpoint above restored a live body for every account with a
      // transform; a dead one must not keep it (GDD section 12, T04).
      this.deadAccounts.set(accountId, diedAtTick);
      this.state.players.delete(accountId);
      this.movementByAccount.delete(accountId);
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
      if (!this.playerSlots.has(accountId)) {
        this.playerSlots.set(accountId, this.store.loadPlayerSlots(accountId, BACKPACK_SLOTS));
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
    // CONTENT section 6's mixed rock pays "stone 100 ... stone 5" per hit
    // alongside its ore. A node still carries one resource (D35), so its stone
    // is seeded as a second rock rather than left out -- which is what it was,
    // and it made every recipe that needs stone unreachable: the stone hatchet
    // GDD section 5 has a player craft in their first five minutes, the
    // campfire, the furnace and arrows. Within a short walk of spawn, as
    // section 5's opening minutes require.
    if (!this.resourceNodes.has('stone_1')) {
      this.spawnNode('stone_1', 'stone', 100, 5, { x: 4, y: 0.5, z: -5 });
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
      this.runSafely(() => this.handleCommand(client, command));
    });
    this.onMessage('ready', (client) => {
      const accountId = client.userData?.accountId;
      if (!accountId || this.clientsByAccount.get(accountId) !== client) return;
      client.send('session', { sessionEpoch: client.userData.sessionEpoch });
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      client.send('vitals', this.vitalsPayload(accountId));
      this.sendCrafting(accountId);
      this.sendChannel(accountId);
      for (const viewers of [this.stationViewers, this.corpseViewers, this.deployableViewers]) {
        for (const audience of viewers.values()) audience.delete(accountId);
      }
      if (this.deadAccounts.has(accountId)) {
        const own = [...this.corpses].find(([, corpse]) => corpse.ownerAccountId === accountId);
        client.send('death', {
          corpseId: own?.[0] ?? null,
          tick: this.deadAccounts.get(accountId),
          cause: this.lastDamageCause.get(accountId) ?? 'killed',
        });
      }
    });

    this.setFixedTimestep((ctx) => this.runSafely(() => this.tick(ctx.dt)), TICK_RATE_HZ);
  }

  private runSafely(work: () => void): void {
    if (this.failed) return;
    try {
      work();
    } catch (error) {
      // A rollback cannot undo mutated in-memory objects. Stop the room and
      // never checkpoint that divergent state over the last valid save.
      this.failed = true;
      console.error('World stopped after a simulation or storage failure', error);
      void this.disconnect().catch((failure: unknown) => console.error('World shutdown failed', failure));
    }
  }

  onDispose(): void {
    try {
      if (!this.failed) this.checkpoint();
    } finally {
      this.store.close();
    }
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
      // Structure health is class-2 (TECHNICAL section 7): a raid is hundreds
      // of hits, and writing each one would put an fsync on the game loop per
      // swing. T04 allows losing up to 5 s of continuous state, which is a few
      // swings of damage; destruction itself is class-1 and already written.
      // The decay activity stamp rides along: it is continuous state too, and
      // losing a few seconds of it only costs a few more seconds of grace.
      // Kept in memory only, a nightly restart would reset every base's decay
      // clock and nothing in the world would ever rot.
      for (const [key, replicated] of this.state.buildingPieces) {
        this.store.saveBuildingPieceHealth(key, replicated.health, this.lastActivityTick.get(key) ?? 0);
      }
      for (const [id, replicated] of this.state.deployables) {
        this.store.saveDeployableHealth(id, replicated.health, this.lastActivityTick.get(id) ?? 0);
      }
      for (const [key, replicated] of this.state.doors) {
        this.store.saveDoorHealth(key, replicated.health);
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

  /** Test-only: fixes which clear anchor a respawn picks. */
  setRespawnRollForTest(roll: () => number): void {
    this.respawnRoll = roll;
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
      // Whether it has a clear line to its target, which decides both whether
      // it can bite and -- after GDD section 7's five seconds -- whether it
      // gives up and goes home. A wall is 0.2 m thick and a bite reaches
      // 1.8 m, so stopping its feet alone would still leave whoever is on the
      // far side inside its range.
      const reachable =
        target !== null && !isReachBlocked(creature.position, target.position, this.barriers());
      const stepped = stepCreature(creature, spec, target?.position ?? null, dt, reachable);
      // The same walls that stop a player. Without this, collision would make
      // a base worse than no base at all: it would hold the raider out and
      // wave the wolf in. T20: "no wall attacks/teleports".
      const ground = resolveMove(creature.position, stepped.state.position, this.movementBarriers());
      const state = {
        ...stepped.state,
        position: { x: ground.x, y: stepped.state.position.y, z: ground.z },
      };
      const { attackDamage } = stepped;
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
    this.lastDamageCause.set(accountId, source === 'bite' ? 'mauled by an animal' : 'struck down');
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

    this.killIfDead(accountId);
  }

  /**
   * GDD section 11: "zero HP is death" -- there is no downed state to be
   * revived from. Called wherever health can fall rather than swept up at the
   * end of the tick, so a dying player stops being a live target inside the
   * same step that killed them.
   */
  private killIfDead(accountId: string): void {
    if (this.deadAccounts.has(accountId)) return;
    if ((this.playerVitals.get(accountId)?.health ?? Infinity) > 0) return;
    this.killPlayer(accountId);
  }

  /**
   * GDD section 12's death transaction: "cancels actions, moves backpack,
   * belt, worn gear, loaded weapons and craft escrow into one corpse
   * inventory, removes the live character, and marks the account dead."
   *
   * Belt, worn gear and loaded weapons have no representation yet; the
   * backpack and the craft escrow do, and both move. The escrow is
   * deliberately not left in the queue for a returning player to collect:
   * section 8 requires that "overflow cannot be lost due to queued crafting",
   * which means the escrow has to be somewhere reachable, and the corpse is
   * the only place it can be once the live character is gone.
   *
   * Written to disk at the commit rather than at the next checkpoint: a
   * force-kill between the two would otherwise restore a living body still
   * holding everything the corpse now has (T04).
   */
  private killPlayer(accountId: string): void {
    const position = this.movementByAccount.get(accountId)?.position ?? { x: 0, y: 0, z: 0 };

    this.cancelChannel(accountId);

    const carried: ItemStack[] = [];
    for (const slot of this.playerSlots.get(accountId) ?? []) {
      if (slot) carried.push({ ...slot });
    }
    const entry = this.craftingByAccount.get(accountId);
    if (entry) {
      for (const [definitionId, quantity] of Object.entries(cancelQueueEntry(entry))) {
        if (quantity > 0) carried.push({ definitionId, quantity });
      }
    }

    const corpseId = `corpse_${randomUUID()}`;
    const inventory = buildCorpse(carried, (id) => getItem(id)?.stack ?? 1);
    this.corpses.set(corpseId, {
      ownerAccountId: accountId,
      position: { ...position },
      inventory,
      diedAtTick: this.state.tick,
      lifetimeTicks: CORPSE_LIFETIME_TICKS,
    });

    const replicated = new CorpseState();
    replicated.ownerAccountId = accountId;
    replicated.x = position.x;
    replicated.y = position.y;
    replicated.z = position.z;
    this.state.corpses.set(corpseId, replicated);

    const emptySlots: Slot[] = new Array(BACKPACK_SLOTS).fill(null);
    this.playerSlots.set(accountId, emptySlots);
    this.craftingByAccount.delete(accountId);
    this.woundsByAccount.delete(accountId);
    this.poisonByAccount.delete(accountId);
    this.pendingMove.delete(accountId);
    this.deadAccounts.set(accountId, this.state.tick);
    this.state.players.delete(accountId);
    // The body is gone, so it has no transform to checkpoint, no vitals to
    // drain and nothing for a wolf to bite.
    this.movementByAccount.delete(accountId);

    this.store.runInTransaction(() => {
      this.persistCorpse(corpseId);
      this.store.savePlayerSlots(accountId, emptySlots);
      this.store.deleteCraftingEntry(accountId);
      this.store.saveStatusEffects(accountId, []);
      this.store.setAccountDead(accountId, this.state.tick);
    });

    this.clientsByAccount.get(accountId)?.send('death', {
      corpseId,
      tick: this.state.tick,
      // Six things can kill a player and the recap named none of them.
      cause: this.lastDamageCause.get(accountId) ?? 'killed',
    });
  }

  private persistCorpse(corpseId: string): void {
    const corpse = this.corpses.get(corpseId);
    if (!corpse) return;
    const record: CorpseRecord = {
      ownerAccountId: corpse.ownerAccountId,
      position: corpse.position,
      diedAtTick: corpse.diedAtTick,
      lifetimeTicks: corpse.lifetimeTicks,
      slots: corpse.inventory.slots,
      overflow: corpse.inventory.overflow,
    };
    this.store.saveCorpse(corpseId, record);
  }

  private removeCorpse(corpseId: string): void {
    this.corpses.delete(corpseId);
    this.state.corpses.delete(corpseId);
    this.store.deleteCorpse(corpseId);
    // Tells whoever was standing over it that it is gone, then forgets them;
    // a viewer set that outlived its corpse would leak one entry per death.
    this.sendCorpse(corpseId);
  }

  /**
   * GDD section 10's placement. The item is consumed only after every rule
   * passes -- "Reaching a cap produces an understandable error before
   * consumption", which is the same capacity-before-consume shape hitNode,
   * takeItem and the station commands already use.
   */
  private resolvePlaceDeployable(
    accountId: string,
    definitionId: string,
    position: Point3,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const definition = getDeployable(definitionId);
    if (!definition) return { ...base, accepted: false, reasonCode: 'not_found' };

    const slots = this.playerSlots.get(accountId) ?? [];
    if (countInInventory(slots, definitionId) < 1) {
      return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
    }

    const movement = this.movementByAccount.get(accountId);
    if (!movement) return { ...base, accepted: false, reasonCode: 'not_found' };

    // Everything section 10 says a placement must not overlap: other players,
    // placed deployables, stations and resource anchors. Bodies are excluded
    // deliberately -- a corpse is temporary, and a crate that cannot be put
    // down where someone died is a worse rule than one that can.
    const occupied: Point3[] = [];
    for (const [otherId, other] of this.movementByAccount) {
      if (otherId === accountId) continue;
      occupied.push(other.position);
    }
    for (const placed of this.deployables.values()) occupied.push(placed.position);
    for (const config of this.stationConfigs.values()) occupied.push(config.position);
    for (const config of this.nodeConfigs.values()) occupied.push(config.position);

    let ownerDeployableCount = 0;
    for (const placed of this.deployables.values()) {
      if (placed.ownerAccountId === accountId) ownerDeployableCount += 1;
    }

    const refusal = validateDeployablePlacement({
      position,
      actorPosition: movement.position,
      reachM: INTERACT_REACH_M + INTERACT_REACH_TOLERANCE_M,
      occupied,
      ownerDeployableCount,
      worldEntityCount: this.deployables.size + this.buildingPieces.size,
    });
    if (refusal === 'out_of_range') return { ...base, accepted: false, reasonCode: 'out_of_range' };
    // T11's "through-wall loot denied" is about reaching in; putting something
    // in is the same question and was never asked. Without this a raider
    // outside a sealed cabin plants a bedroll through its wall and respawns
    // inside it at will. Reported as out_of_range because that is what it is:
    // the spot is not somewhere this player can reach.
    if (isReachBlocked(movement.position, position, this.barriers())) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    if (refusal === 'overlap') return { ...base, accepted: false, reasonCode: 'overlap' };
    if (refusal) return { ...base, accepted: false, reasonCode: 'cap_reached' };

    // GDD section 12: "maximum five combined per account". Checked before the
    // item is spent, like every other cap.
    if (definition.respawnCooldownS !== null && this.anchorsOf(accountId).length >= ANCHORS_PER_ACCOUNT) {
      return { ...base, accepted: false, reasonCode: 'cap_reached' };
    }

    const { slots: remaining } = removeFromInventory(slots, definitionId, 1);
    this.playerSlots.set(accountId, remaining);

    const deployableId = `deployable_${this.nextDeployableId++}`;
    this.deployables.set(deployableId, {
      definitionId,
      ownerAccountId: accountId,
      position: { ...position },
      placedAtTick: this.state.tick,
      slots: new Array(definition.slots).fill(null),
    });

    // A crate is something to walk into; see movementBarriers.
    this.invalidateBarriers();

    const replicated = new DeployableState();
    replicated.definitionId = definitionId;
    replicated.ownerAccountId = accountId;
    replicated.x = position.x;
    replicated.y = position.y;
    replicated.z = position.z;
    replicated.health = definition.placedHp;
    this.state.deployables.set(deployableId, replicated);

    this.lastActivityTick.set(deployableId, this.state.tick);
    // GDD section 12: "A new anchor starts on its full cooldown" -- laying one
    // must not be a free trip home the moment you die.
    if (definition.respawnCooldownS !== null) {
      this.anchorReadyAtTick.set(deployableId, this.state.tick + definition.respawnCooldownS * TICK_RATE_HZ);
    }

    this.store.runInTransaction(() => {
      this.store.savePlayerSlots(accountId, remaining);
      this.persistDeployable(deployableId);
    });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /** This account's personal respawn anchors, standing right now. */
  private anchorsOf(accountId: string): Array<{ id: string; position: Point3; cooldownS: number }> {
    const anchors: Array<{ id: string; position: Point3; cooldownS: number }> = [];
    for (const [id, placed] of this.deployables) {
      if (placed.ownerAccountId !== accountId) continue;
      const cooldownS = getDeployable(placed.definitionId)?.respawnCooldownS;
      if (cooldownS === null || cooldownS === undefined) continue;
      anchors.push({ id, position: placed.position, cooldownS });
    }
    return anchors;
  }

  /** Why this anchor cannot be used, or null when it can. */
  private checkAnchor(accountId: string, anchorId: string): CommandResult['reasonCode'] | null {
    const placed = this.deployables.get(anchorId);
    // T13's "destroyed anchor unavailable" -- and a player whose bedroll
    // burned down must still be able to take the random anchor instead.
    if (!placed) return 'not_found';
    if (getDeployable(placed.definitionId)?.respawnCooldownS == null) return 'not_found';
    // CONTENT section 7: "Owner-only spawn".
    if (placed.ownerAccountId !== accountId) return 'forbidden';
    if ((this.anchorReadyAtTick.get(anchorId) ?? -Infinity) > this.state.tick) return 'busy';
    return null;
  }

  /**
   * GDD section 12: "Using one starts its timer and applies at least that
   * cooldown to the owner's other anchors within 50 m." Without the second
   * half, a pile of bedrolls in one room is an unlimited respawn.
   */
  private startAnchorCooldown(accountId: string, anchorId: string): void {
    const used = this.deployables.get(anchorId);
    if (!used) return;
    const cooldownS = getDeployable(used.definitionId)?.respawnCooldownS ?? 0;
    const readyAt = this.state.tick + cooldownS * TICK_RATE_HZ;
    this.anchorReadyAtTick.set(anchorId, readyAt);

    for (const other of this.anchorsOf(accountId)) {
      if (other.id === anchorId) continue;
      const distance = Math.hypot(
        other.position.x - used.position.x,
        other.position.y - used.position.y,
        other.position.z - used.position.z,
      );
      if (distance > ANCHOR_SHARED_COOLDOWN_RADIUS_M) continue;
      // "at least that cooldown": a neighbour already on a longer one keeps
      // it, rather than having it shortened by someone else's respawn.
      this.anchorReadyAtTick.set(other.id, Math.max(this.anchorReadyAtTick.get(other.id) ?? -Infinity, readyAt));
    }

    // GDD section 12: "Cooldowns use persisted simulation time." Written at
    // the commit that started them, not at the next checkpoint, so a restart
    // in between cannot hand the player a ready bedroll.
    this.store.runInTransaction(() => {
      this.persistDeployable(anchorId);
      for (const other of this.anchorsOf(accountId)) this.persistDeployable(other.id);
    });
  }

  /**
   * Every piece in the same connected building as this site, walked over the
   * structural adjacency. GDD section 10 needs it twice: for "only a building
   * owner or explicit builder can attach to its grid", and for the
   * 1000-pieces-per-building cap.
   */
  private buildingFrom(seeds: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = seeds.filter((key) => this.buildingPieces.has(key));
    for (const key of queue) seen.add(key);
    while (queue.length > 0) {
      const key = queue.shift()!;
      for (const neighbour of this.pieceLinks.get(key) ?? []) {
        if (seen.has(neighbour) || !this.buildingPieces.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    return seen;
  }

  /**
   * GDD section 10's placement: "Craft each piece into an inventory item,
   * equip it and place its ghost. A server-accepted placement consumes one
   * item." Same capacity-before-consume order as everything else -- the piece
   * stays in the pack unless every rule passes.
   */
  private resolvePlaceBuildingPiece(
    accountId: string,
    definitionId: string,
    site: PieceSite,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const definition = getBuildingPiece(definitionId);
    // A mismatch would let one recipe pay for another piece's cost and HP.
    if (!definition || definition.form !== site.form) {
      return { ...base, accepted: false, reasonCode: 'not_found' };
    }

    const slots = this.playerSlots.get(accountId) ?? [];
    if (countInInventory(slots, definitionId) < 1) {
      return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
    }

    const movement = this.movementByAccount.get(accountId);
    if (!movement) return { ...base, accepted: false, reasonCode: 'not_found' };

    const placed = new Set(this.buildingPieces.keys());
    const refusal = validatePieceSite(site, placed);
    if (refusal === 'occupied') return { ...base, accepted: false, reasonCode: 'overlap' };
    if (refusal === 'unsupported') return { ...base, accepted: false, reasonCode: 'unsupported' };
    if (refusal === 'too_high') return { ...base, accepted: false, reasonCode: 'cap_reached' };

    const position = worldPositionOf(site);
    const dx = position.x - movement.position.x;
    const dy = position.y - (movement.position.y + EYE_HEIGHT_M);
    const dz = position.z - movement.position.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > BUILD_REACH_M) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }

    // "Reject overlap with players, sleepers, containers, resource anchors or
    // world geometry." Measured on the ground plane, which for a ceiling means
    // the cell it roofs: a teammate standing anywhere in a 4 m room made the
    // ceiling over their head un-placeable. Only the forms that stand in a
    // player's own space can overlap one; a floor slab and a roof slab are
    // things you stand on and under.
    const standsInPlayerSpace = site.form === 'wall' || site.form === 'doorway' || site.form === 'pillar';
    for (const [otherId, other] of this.movementByAccount) {
      if (otherId === accountId || !standsInPlayerSpace) continue;
      if (Math.hypot(position.x - other.position.x, position.z - other.position.z) < PLACEMENT_CLEARANCE_M) {
        return { ...base, accepted: false, reasonCode: 'overlap' };
      }
    }
    for (const blocker of [
      ...[...this.deployables.values()].map((d) => d.position),
      ...[...this.stationConfigs.values()].map((c) => c.position),
      ...[...this.nodeConfigs.values()].map((c) => c.position),
    ]) {
      if (Math.hypot(position.x - blocker.x, position.z - blocker.z) < PLACEMENT_CLEARANCE_M) {
        return { ...base, accepted: false, reasonCode: 'overlap' };
      }
    }

    const links = linkedSiteKeys(site).filter((key) => this.buildingPieces.has(key));
    const proposedKey = siteKey(site);
    for (const [otherKey, other] of this.buildingPieces) {
      if (linkedSiteKeys(other.site).includes(proposedKey)) links.push(otherKey);
    }
    const building = this.buildingFrom(links);
    if (!this.mayBuildOn(accountId, building)) {
      return { ...base, accepted: false, reasonCode: 'forbidden' };
    }
    // GDD section 11: the raid lock "blocks ... new attached construction", so
    // a defender cannot wall a breach shut while it is being made.
    if (this.isRaidLocked(building)) {
      return { ...base, accepted: false, reasonCode: 'raid_locked' };
    }

    let ownerPieceCount = 0;
    for (const piece of this.buildingPieces.values()) {
      if (piece.ownerAccountId === accountId) ownerPieceCount += 1;
    }
    if (
      ownerPieceCount >= PIECES_PER_OWNER ||
      building.size >= PIECES_PER_BUILDING ||
      this.buildingPieces.size + this.deployables.size >= WORLD_ENTITY_CAP
    ) {
      return { ...base, accepted: false, reasonCode: 'cap_reached' };
    }

    const key = siteKey(site);
    const { slots: remaining } = removeFromInventory(slots, definitionId, 1);
    this.playerSlots.set(accountId, remaining);
    this.buildingPieces.set(key, {
      definitionId,
      ownerAccountId: accountId,
      site: { ...site },
      placedAtTick: this.state.tick,
    });
    for (const linked of links) {
      this.linkPieces(key, linked);
    }
    // Also link to anything already standing that this piece holds up -- a
    // pillar placed after its ceiling was impossible, but a foundation placed
    // next to another one is not, and the link has to go both ways.
    for (const [otherKey, other] of this.buildingPieces) {
      if (otherKey === key) continue;
      if (linkedSiteKeys(other.site).includes(key)) this.linkPieces(key, otherKey);
    }

    this.lastActivityTick.set(key, this.state.tick);
    this.invalidateBarriers(); // a new wall or doorway changes what blocks a reach
    const replicated = new BuildingPieceState();
    replicated.definitionId = definitionId;
    replicated.ownerAccountId = accountId;
    replicated.form = site.form;
    replicated.storey = site.storey;
    replicated.i = site.i;
    replicated.k = site.k;
    replicated.axis = site.axis ?? '';
    replicated.health = definition.placedHp;
    this.state.buildingPieces.set(key, replicated);

    this.store.runInTransaction(() => {
      this.store.savePlayerSlots(accountId, remaining);
      this.store.saveBuildingPiece(key, {
        definitionId,
        ownerAccountId: accountId,
        form: site.form,
        storey: site.storey,
        i: site.i,
        k: site.k,
        axis: site.axis,
        health: definition.placedHp,
        placedAtTick: this.state.tick,
        lastActivityTick: this.state.tick,
      });
    });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * Whether this account may attach to the building the seeds belong to
   * (GDD section 10: "Only a building owner or explicit builder can attach to
   * its grid"). An empty building -- bare ground -- is open to anyone.
   */
  private mayBuildOn(accountId: string, building: Set<string>): boolean {
    for (const key of building) {
      const owner = this.buildingPieces.get(key)!.ownerAccountId;
      if (owner === accountId) continue;
      if (this.buildAccess.get(owner)?.has(accountId)) continue;
      return false;
    }
    return true;
  }

  /**
   * GDD section 10: a door hangs in a doorway socket, and "only the authorized
   * builder can install a replacement door" -- so installing is a build-grid
   * action, gated the same way attaching a piece is.
   */
  private resolveInstallDoor(
    accountId: string,
    definitionId: string,
    site: PieceSite,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    if (!Object.hasOwn(DOOR_PLACED_HP, definitionId)) {
      return { ...base, accepted: false, reasonCode: 'not_found' };
    }
    const key = siteKey(site);
    const frame = this.buildingPieces.get(key);
    if (!frame || frame.site.form !== 'doorway') {
      return { ...base, accepted: false, reasonCode: 'not_found' };
    }
    if (this.doors.has(key)) return { ...base, accepted: false, reasonCode: 'overlap' };
    // "Breaking a door leaves its socket unavailable to everyone for 60
    // seconds": without it a defender re-hangs a door the instant it breaks,
    // and a breach that cost a satchel closes for free.
    if ((this.socketLockedUntilTick.get(key) ?? -Infinity) > this.state.tick) {
      return { ...base, accepted: false, reasonCode: 'busy' };
    }

    const slots = this.playerSlots.get(accountId) ?? [];
    if (countInInventory(slots, definitionId) < 1) {
      return { ...base, accepted: false, reasonCode: 'insufficient_resources' };
    }
    if (!this.mayBuildOn(accountId, this.buildingFrom([key]))) {
      return { ...base, accepted: false, reasonCode: 'forbidden' };
    }
    if (!this.canReachThrough(accountId, worldPositionOf(site) as Vec3)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }

    const { slots: remaining } = removeFromInventory(slots, definitionId, 1);
    this.playerSlots.set(accountId, remaining);
    // The door belongs to the frame's owner, not whoever hung it: section 10's
    // "owner doors default closed and private" is about the base's owner, and
    // an authorised builder installing one must not take the base's locks with
    // them.
    const ownerAccountId = frame.ownerAccountId;
    this.doors.set(key, {
      definitionId,
      ownerAccountId,
      open: false,
      site: { ...site },
      installedAtTick: this.state.tick,
    });

    // A doorway that now holds a shut door blocks reaches it did not before.
    this.invalidateBarriers();
    const placedHp = DOOR_PLACED_HP[definitionId] ?? 0;
    const replicated = new DoorState();
    replicated.definitionId = definitionId;
    replicated.ownerAccountId = ownerAccountId;
    replicated.open = false;
    replicated.storey = site.storey;
    replicated.i = site.i;
    replicated.k = site.k;
    replicated.axis = site.axis ?? '';
    replicated.health = placedHp;
    this.state.doors.set(key, replicated);

    this.store.runInTransaction(() => {
      this.store.savePlayerSlots(accountId, remaining);
      this.store.saveDoor(key, {
        definitionId,
        ownerAccountId,
        open: false,
        storey: site.storey,
        i: site.i,
        k: site.k,
        axis: site.axis ?? '',
        health: placedHp,
        installedAtTick: this.state.tick,
      });
    });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * GDD section 10: "Owner doors default closed and private", and door access
   * is granted separately from building permission -- so a builder is not
   * automatically a key holder.
   */
  private mayOperateDoor(accountId: string, key: string): boolean {
    const door = this.doors.get(key);
    if (!door) return false;
    return door.ownerAccountId === accountId || (this.doorAccess.get(key)?.has(accountId) ?? false);
  }

  private resolveOperateDoor(
    accountId: string,
    site: PieceSite,
    open: boolean,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const key = siteKey(site);
    const door = this.doors.get(key);
    if (!door) return { ...base, accepted: false, reasonCode: 'not_found' };
    if (!this.canReachThrough(accountId, worldPositionOf(site) as Vec3)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    if (!this.mayOperateDoor(accountId, key)) {
      return { ...base, accepted: false, reasonCode: 'forbidden' };
    }

    door.open = open;
    this.invalidateBarriers();
    const replicated = this.state.doors.get(key);
    if (replicated) replicated.open = open;
    this.store.saveDoor(key, {
      definitionId: door.definitionId,
      ownerAccountId: door.ownerAccountId,
      open,
      storey: site.storey,
      i: site.i,
      k: site.k,
      axis: site.axis ?? '',
      health: replicated?.health ?? 0,
      installedAtTick: door.installedAtTick,
    });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  private resolveSetDoorAccess(
    accountId: string,
    site: PieceSite,
    targetAccountId: string,
    granted: boolean,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const key = siteKey(site);
    const door = this.doors.get(key);
    if (!door) return { ...base, accepted: false, reasonCode: 'not_found' };
    // Only the owner hands out keys; a guest cannot invite their friends in.
    if (door.ownerAccountId !== accountId) return { ...base, accepted: false, reasonCode: 'forbidden' };
    if (!this.canReachThrough(accountId, worldPositionOf(site) as Vec3)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }

    const list = this.doorAccess.get(key) ?? new Set<string>();
    if (granted) list.add(targetAccountId);
    else list.delete(targetAccountId);
    this.doorAccess.set(key, list);
    this.store.setDoorAccess(key, targetAccountId, granted);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  private resolveSetBuildAccess(
    accountId: string,
    targetAccountId: string,
    granted: boolean,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const list = this.buildAccess.get(accountId) ?? new Set<string>();
    if (granted) list.add(targetAccountId);
    else list.delete(targetAccountId);
    this.buildAccess.set(accountId, list);
    this.store.setBuildAccess(accountId, targetAccountId, granted);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /** GDD section 11: the lock is building-wide, so any locked piece locks all of it. */
  private isRaidLocked(building: Set<string>): boolean {
    for (const key of building) {
      if ((this.raidLockUntilTick.get(key) ?? -Infinity) > this.state.tick) return true;
    }
    return false;
  }

  /**
   * A swing at a wall, ceiling, doorway or the door hanging in one (GDD
   * section 11: "After the window, use normal combat on destructible
   * pieces"). Foundations and pillars are refused outright -- section 10 calls
   * their combat immunity intentional.
   */
  private resolveAttackStructure(
    accountId: string,
    site: PieceSite,
    door: boolean,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const key = siteKey(site);
    const piece = this.buildingPieces.get(key);
    if (!piece) return { ...base, accepted: false, reasonCode: 'not_found' };
    if (door && !this.doors.has(key)) return { ...base, accepted: false, reasonCode: 'not_found' };

    if (!door && getBuildingPiece(piece.definitionId)?.combatImmune) {
      return { ...base, accepted: false, reasonCode: 'forbidden' };
    }
    if (!this.canReachThrough(accountId, worldPositionOf(site) as Vec3)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    if (this.isSwingOnCooldown(accountId)) return { ...base, accepted: false, reasonCode: 'rate_limited' };
    this.lastSwingTick.set(accountId, this.state.tick);
    this.chargeSwingCalorie(accountId);

    // "A building-wide raid lock lasts 60 seconds after any hostile damage
    // ... Owner damage also starts the lock", so this is set before the hit
    // resolves and regardless of who swung.
    const until = this.state.tick + RAID_LOCK_TICKS;
    for (const member of this.buildingFrom([key])) {
      this.raidLockUntilTick.set(member, until);
      // Written at the commit that starts it, not at the next checkpoint: a
      // force-kill in between would otherwise lift a lock the raider paid for.
      this.store.setSiteLock(member, 'raid', until);
    }

    const replicated = door ? this.state.doors.get(key) : this.state.buildingPieces.get(key);
    if (!replicated) return { ...base, accepted: false, reasonCode: 'not_found' };
    // CONTENT section 8: "Tools deal their base melee damage x0.5 to wood and
    // x0.05 to metal." Without it a rock chews through a wall at full damage,
    // and there is no reason for anyone to build an explosive.
    const health =
      replicated.health -
      structuralMeleeDamage(MELEE_DAMAGE, materialOf(door ? replicated.definitionId : piece.definitionId));
    if (health > 0) {
      // Class-2 continuous state (TECHNICAL section 7): checkpointed rather
      // than written per hit, because a raid is hundreds of hits and each one
      // would be an fsync on the game loop. T04 allows losing up to 5 s of it.
      replicated.health = health;
      return { ...base, accepted: true, reasonCode: 'ok' };
    }

    if (door) {
      this.removeDoor(key);
    } else {
      this.destroyPiece(key);
    }
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * GDD section 11's explosion against structures. Test-only for now: the
   * satchel item and its crafting chain are M3 (PRODUCTION section 1 puts
   * "satchel raid" there), but T12's maths and the occlusion rule are
   * structural geometry and belong with the building work.
   */
  detonateForTest(at: Point3, explosiveId: 'satchel' | 'powder_bomb'): void {
    const spec = EXPLOSIVES[explosiveId];
    // "resolve the blocking set from the pre-explosion world so a single
    // explosion cannot destroy a door and then damage behind it
    // retroactively" -- so the barriers are taken once, up front, and the
    // targets are gathered before anything is applied.
    const barriers = this.barriers();
    const hits: Array<{ key: string; damage: number; door: boolean; deployable: boolean }> = [];

    const consider = (key: string, position: Point3, door: boolean, deployable: boolean): void => {
      const distance = Math.hypot(position.x - at.x, position.y - at.y, position.z - at.z);
      const damage = structuralSplashDamage(spec, distance);
      if (damage <= 0) return;
      // "One intact structural barrier occludes further structural blast
      // damage."
      if (isReachBlocked(at, position, barriers)) return;
      hits.push({ key, damage, door, deployable });
    };

    for (const [key, piece] of this.buildingPieces) {
      // CONTENT section 8: "Supports marked combat immune ignore these and
      // all explosions."
      if (getBuildingPiece(piece.definitionId)?.combatImmune) continue;
      consider(key, worldPositionOf(piece.site), false, false);
    }
    for (const [key, door] of this.doors) {
      consider(key, worldPositionOf(door.site), true, false);
    }
    for (const [id, deployable] of this.deployables) {
      consider(id, deployable.position, false, true);
    }

    // CONTENT section 8's other column. A different, wider falloff than the
    // structural one, so a raider standing on their own charge is hurt by it
    // even where the wall behind them is out of reach.
    for (const [accountId, movement] of this.movementByAccount) {
      const distance = Math.hypot(
        movement.position.x - at.x,
        movement.position.y + EYE_HEIGHT_M / 2 - at.y,
        movement.position.z - at.z,
      );
      const damage = characterBlastDamage(spec, distance);
      // Line of sight for people too: GDD section 11's "Explosion damage uses
      // distance falloff and line of sight from its center".
      if (damage <= 0 || isReachBlocked(at, movement.position, barriers)) continue;
      // 'melee' rather than 'bite': section 6's bleed roll is for bites, and
      // an explosion is not one.
      this.damagePlayer(accountId, damage, 'melee');
    }

    for (const hit of hits) {
      const replicated = hit.deployable
        ? this.state.deployables.get(hit.key)
        : hit.door
          ? this.state.doors.get(hit.key)
          : this.state.buildingPieces.get(hit.key);
      if (!replicated) continue;
      const health = replicated.health - hit.damage;
      if (health > 0) {
        replicated.health = health;
        continue;
      }
      if (hit.deployable) this.breakDeployable(hit.key);
      else if (hit.door) this.removeDoor(hit.key);
      else this.destroyPiece(hit.key);
    }
  }

  /**
   * What a repair would put back and what it would cost, or a refusal. Shared
   * by the command (which must refuse before starting the hold) and the
   * completion (which must re-check, because two seconds is long enough for
   * the wall to have been hit again).
   */
  private planRepair(
    accountId: string,
    site: PieceSite,
    door: boolean,
  ):
    | { restored: number; cost: Record<string, number>; key: string }
    | CommandResult['reasonCode'] {
    const key = siteKey(site);
    const piece = this.buildingPieces.get(key);
    if (!piece) return 'not_found';
    const replicated = door ? this.state.doors.get(key) : this.state.buildingPieces.get(key);
    const definitionId = door ? this.doors.get(key)?.definitionId : piece.definitionId;
    if (!replicated || !definitionId) return 'not_found';

    const maxHealth = door ? DOOR_PLACED_HP[definitionId] : getBuildingPiece(definitionId)?.placedHp;
    if (!maxHealth) return 'not_found';
    const restored = repairableHp(replicated.health, maxHealth);
    if (restored <= 0) return 'not_found';

    if (!this.mayBuildOn(accountId, this.buildingFrom([key]))) return 'forbidden';
    // GDD section 11: the raid lock "blocks repair" -- a wall cannot be
    // patched faster than it is being broken.
    if (this.isRaidLocked(this.buildingFrom([key]))) return 'raid_locked';

    const recipe = getRecipe(definitionId);
    if (!recipe) return 'not_found';
    const cost = repairCost(recipe.inputs, restored, maxHealth);
    const slots = this.playerSlots.get(accountId) ?? [];
    for (const [id, quantity] of Object.entries(cost)) {
      if (countInInventory(slots, id) < quantity) return 'insufficient_resources';
    }
    return { restored, cost, key };
  }

  private resolveRepairStructure(
    accountId: string,
    site: PieceSite,
    door: boolean,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const plan = this.planRepair(accountId, site, door);
    if (typeof plan === 'string') return { ...base, accepted: false, reasonCode: plan };
    if (!this.canReachThrough(accountId, worldPositionOf(site) as Vec3)) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    if (this.channelsByAccount.has(accountId)) return { ...base, accepted: false, reasonCode: 'busy' };

    // Nothing is spent and nothing is restored yet: section 10 says "hold
    // interact ... for 2 seconds", and an interrupted hold costs nothing, the
    // same rule a bandage follows (D36).
    this.channelsByAccount.set(accountId, {
      definitionId: 'repair',
      channel: startChannel(REPAIR_CHANNEL_S),
      repair: { site: { ...site }, door },
    });
    this.sendChannel(accountId);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * Pays for and applies a finished repair. Re-planned rather than trusting
   * what the hold started with: two seconds is long enough for the wall to
   * have been hit again, for the raid lock to have come on, or for the
   * materials to have been spent elsewhere.
   */
  private completeRepair(accountId: string, site: PieceSite, door: boolean): void {
    const plan = this.planRepair(accountId, site, door);
    if (typeof plan === 'string' || !this.canReachThrough(accountId, worldPositionOf(site))) return;

    let slots = this.playerSlots.get(accountId) ?? [];
    for (const [id, quantity] of Object.entries(plan.cost)) {
      slots = removeFromInventory(slots, id, quantity).slots;
    }
    this.playerSlots.set(accountId, slots);

    const replicated = door ? this.state.doors.get(plan.key) : this.state.buildingPieces.get(plan.key);
    if (replicated) replicated.health += plan.restored;

    this.store.runInTransaction(() => {
      this.store.savePlayerSlots(accountId, slots);
      if (replicated) {
        if (door) this.store.saveDoorHealth(plan.key, replicated.health);
        else this.store.saveBuildingPieceHealth(plan.key, replicated.health, this.lastActivityTick.get(plan.key) ?? 0);
      }
    });
    this.clientsByAccount.get(accountId)?.send('inventory', { slots });
  }

  private removeDoor(key: string): void {
    const socketUntil = this.state.tick + BROKEN_SOCKET_LOCK_TICKS;
    this.socketLockedUntilTick.set(key, socketUntil);
    this.store.setSiteLock(key, 'socket', socketUntil);
    this.doors.delete(key);
    this.state.doors.delete(key);
    this.doorAccess.delete(key);
    this.invalidateBarriers();
    this.store.runInTransaction(() => {
      this.store.deleteDoor(key);
      this.store.clearDoorAccess(key);
    });
  }

  /**
   * Removes a piece and everything that was standing on it (GDD section 10's
   * cascade). Class-1: a removal is a committed outcome, so it is written at
   * once rather than waiting for a checkpoint.
   */
  private destroyPiece(key: string): void {
    const sites = new Map<string, PieceSite>();
    for (const [otherKey, piece] of this.buildingPieces) sites.set(otherKey, piece.site);
    const fallen = cascadeRemoval(key, sites);

    this.store.runInTransaction(() => {
      for (const fallenKey of fallen) {
        // A door dies with the frame it hangs in (CONTENT section 7:
        // "insert dies with frame").
        if (this.doors.has(fallenKey)) {
          this.doors.delete(fallenKey);
          this.state.doors.delete(fallenKey);
          this.doorAccess.delete(fallenKey);
          this.store.deleteDoor(fallenKey);
          this.store.clearDoorAccess(fallenKey);
        }
        this.buildingPieces.delete(fallenKey);
        this.state.buildingPieces.delete(fallenKey);
        this.raidLockUntilTick.delete(fallenKey);
        // The links go with the pieces; a stale one would keep a fallen
        // building's ownership alive over empty ground.
        for (const neighbour of this.pieceLinks.get(fallenKey) ?? []) {
          this.pieceLinks.get(neighbour)?.delete(fallenKey);
        }
        this.pieceLinks.delete(fallenKey);
        this.store.deleteBuildingPiece(fallenKey);
      }
    });
    this.invalidateBarriers();
  }

  /**
   * GDD section 10's decay, one minute at a time. Two halves, in order:
   * "Every 60 seconds, awake connected owners or authorized builders within
   * 50 m refresh their building cluster's activity timestamp; sleepers do
   * not", and then "At each minute after grace, subtract the appropriate
   * fraction of max HP".
   *
   * Driven by the tick counter, so a stopped host does not catch up -- section
   * 10 says so outright, and it is T17's rule for every other timer.
   */
  private tickDecay(): void {
    this.refreshActivity();

    for (const [key, replicated] of [...this.state.buildingPieces]) {
      const piece = this.buildingPieces.get(key);
      const maxHealth = piece ? getBuildingPiece(piece.definitionId)?.placedHp : undefined;
      if (!maxHealth) continue;
      const health = this.decayOne(key, replicated.health, maxHealth);
      if (health > 0) {
        replicated.health = health;
        continue;
      }
      // Combat immunity is to combat; the same CONTENT row says "Combat
      // immune; decays", so a foundation goes this way and takes its
      // building with it.
      this.destroyPiece(key);
    }

    for (const [id, replicated] of [...this.state.deployables]) {
      const deployable = this.deployables.get(id);
      const maxHealth = deployable ? getDeployable(deployable.definitionId)?.placedHp : undefined;
      if (!maxHealth) continue;
      const health = this.decayOne(id, replicated.health, maxHealth);
      if (health > 0) {
        replicated.health = health;
        continue;
      }
      // "Nonempty containers still decay and spill loot; there is no immortal
      // full-box exception."
      this.breakDeployable(id);
    }
  }

  private decayOne(key: string, health: number, maxHealth: number): number {
    const since = (this.state.tick - (this.lastActivityTick.get(key) ?? this.state.tick)) / TICK_RATE_HZ;
    return stepDecay(health, maxHealth, since, WOOD_DECAY);
  }

  /**
   * Stamps every placed thing that has an awake owner or authorised builder
   * standing near it. Strangers do not count -- section 10 names the owner and
   * their explicit builders, and a squatter propping up someone else's base is
   * the opposite of what the rule is for.
   */
  private refreshActivity(): void {
    const awake: Array<{ accountId: string; position: Point3 }> = [];
    for (const accountId of this.connectedAccounts) {
      const movement = this.movementByAccount.get(accountId);
      // A sleeper is disconnected, so it is already absent here; a dead
      // account has no body at all.
      if (!movement || this.deadAccounts.has(accountId)) continue;
      awake.push({ accountId, position: movement.position });
    }
    if (awake.length === 0) return;

    const stamp = (key: string, ownerAccountId: string, position: Point3): void => {
      for (const person of awake) {
        if (person.accountId !== ownerAccountId && !this.buildAccess.get(ownerAccountId)?.has(person.accountId)) {
          continue;
        }
        const distance = Math.hypot(
          person.position.x - position.x,
          person.position.y - position.y,
          person.position.z - position.z,
        );
        if (distance > DECAY_ACTIVITY_RADIUS_M) continue;
        this.lastActivityTick.set(key, this.state.tick);
        return;
      }
    };

    for (const [key, piece] of this.buildingPieces) {
      stamp(key, piece.ownerAccountId, worldPositionOf(piece.site));
    }
    for (const [id, deployable] of this.deployables) {
      stamp(id, deployable.ownerAccountId, deployable.position);
    }
  }

  private linkPieces(a: string, b: string): void {
    if (!this.pieceLinks.has(a)) this.pieceLinks.set(a, new Set());
    if (!this.pieceLinks.has(b)) this.pieceLinks.set(b, new Set());
    this.pieceLinks.get(a)!.add(b);
    this.pieceLinks.get(b)!.add(a);
  }

  /**
   * A swing at a crate (GDD section 11: "Destroying a box produces its
   * loot"). Reach and rate are the same as any other swing.
   */
  private resolveAttackDeployable(accountId: string, deployableId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const deployable = this.deployables.get(deployableId);
    const replicated = this.state.deployables.get(deployableId);
    if (!deployable || !replicated) return { ...base, accepted: false, reasonCode: 'not_found' };
    if (!this.canReachThrough(accountId, { ...deployable.position })) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }
    if (this.isSwingOnCooldown(accountId)) return { ...base, accepted: false, reasonCode: 'rate_limited' };
    this.lastSwingTick.set(accountId, this.state.tick);
    this.chargeSwingCalorie(accountId);

    const health = replicated.health - MELEE_DAMAGE;
    if (health > 0) {
      // Class-2 like a wall's, and checkpointed with it.
      replicated.health = health;
      return { ...base, accepted: true, reasonCode: 'ok' };
    }

    this.breakDeployable(deployableId);
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * Removes a crate and spills what was inside it into one bag (GDD section 8:
   * "Destroyed containers spill one bounded bag holding the actual remaining
   * items"). The bag is a corpse with a shorter clock -- section 8 says drop
   * containers "use the same 40-visible-slot plus paged overflow
   * representation as corpses", so it is literally the same thing here.
   *
   * Spills once, because the crate is gone in the same step.
   */
  private breakDeployable(deployableId: string): void {
    const deployable = this.deployables.get(deployableId);
    if (!deployable) return;

    const spilled: ItemStack[] = [];
    for (const slot of deployable.slots) {
      if (slot) spilled.push({ ...slot });
    }

    this.deployables.delete(deployableId);
    this.state.deployables.delete(deployableId);
    this.deployableViewers.delete(deployableId);
    this.invalidateBarriers();

    const bagId = spilled.length > 0 ? `bag_${deployableId}_${this.state.tick}` : null;
    if (bagId) {
      this.corpses.set(bagId, {
        ownerAccountId: deployable.ownerAccountId,
        position: { ...deployable.position },
        inventory: buildCorpse(spilled, (id) => getItem(id)?.stack ?? 1),
        diedAtTick: this.state.tick,
        lifetimeTicks: BAG_LIFETIME_TICKS,
      });
      const replicated = new CorpseState();
      replicated.ownerAccountId = deployable.ownerAccountId;
      replicated.x = deployable.position.x;
      replicated.y = deployable.position.y;
      replicated.z = deployable.position.z;
      this.state.corpses.set(bagId, replicated);
    }
    // An empty crate leaves nothing behind: a bag with nothing in it is a prop
    // that invites a pointless interaction, the same reasoning as D49.

    this.store.runInTransaction(() => {
      this.store.deleteDeployable(deployableId);
      if (bagId) this.persistCorpse(bagId);
    });
    this.sendDeployable(deployableId);
  }

  private persistDeployable(deployableId: string): void {
    const deployable = this.deployables.get(deployableId);
    if (!deployable) return;
    this.store.saveDeployable(deployableId, {
      definitionId: deployable.definitionId,
      ownerAccountId: deployable.ownerAccountId,
      position: deployable.position,
      health: this.state.deployables.get(deployableId)?.health ?? 0,
      placedAtTick: deployable.placedAtTick,
      anchorReadyAtTick: this.anchorReadyAtTick.get(deployableId) ?? 0,
      lastActivityTick: this.lastActivityTick.get(deployableId) ?? this.state.tick,
      slots: deployable.slots,
    });
  }

  /**
   * A container command's preamble. Reach is the only gate: GDD section 8 says
   * "Boxes are not magically private. Any person who reaches a box can open
   * it; doors supply security."
   */
  private resolveContainerAccess(
    accountId: string,
    containerId: string,
  ): { definitionId: string; ownerAccountId: string; position: Point3; placedAtTick: number; slots: Slot[] } | CommandResult['reasonCode'] {
    const deployable = this.deployables.get(containerId);
    if (!deployable) return 'not_found';
    if (!this.canReachThrough(accountId, { ...deployable.position })) return 'out_of_range';
    return deployable;
  }

  private resolveContainerInsert(
    accountId: string,
    containerId: string,
    definitionId: string,
    quantity: number,
    sequence: number,
  ): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const access = this.resolveContainerAccess(accountId, containerId);
    if (typeof access === 'string') return { ...base, accepted: false, reasonCode: access };

    const slots = this.playerSlots.get(accountId) ?? [];
    const available = Math.min(quantity, countInInventory(slots, definitionId));
    if (available < 1) return { ...base, accepted: false, reasonCode: 'insufficient_resources' };

    const stackLimit = getItem(definitionId)?.stack ?? 1;
    const room = countFreeCapacity(access.slots, definitionId, stackLimit);
    if (room < 1) return { ...base, accepted: false, reasonCode: 'no_space' };

    // Only as much as the crate can hold leaves the pack; the rest stays put
    // rather than being taken and then dropped.
    const moving = Math.min(available, room);
    const { slots: afterRemove } = removeFromInventory(slots, definitionId, moving);
    access.slots = addToInventory(access.slots, definitionId, moving, stackLimit).slots;
    this.playerSlots.set(accountId, afterRemove);

    this.store.runInTransaction(() => {
      this.store.savePlayerSlots(accountId, afterRemove);
      this.persistDeployable(containerId);
    });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  private resolveContainerTake(accountId: string, containerId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const access = this.resolveContainerAccess(accountId, containerId);
    if (typeof access === 'string') return { ...base, accepted: false, reasonCode: access };

    const { source, destination, moved } = moveAllThatFits(
      access.slots,
      this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null),
      (id) => getItem(id)?.stack ?? 1,
    );
    if (moved === 0) {
      return {
        ...base,
        accepted: false,
        reasonCode: access.slots.some((slot) => slot) ? 'no_space' : 'depleted',
      };
    }

    access.slots = source;
    this.playerSlots.set(accountId, destination);
    this.store.runInTransaction(() => {
      this.store.savePlayerSlots(accountId, destination);
      this.persistDeployable(containerId);
    });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  private deployablePayload(containerId: string): unknown {
    const deployable = this.deployables.get(containerId);
    return {
      containerId,
      definitionId: deployable?.definitionId ?? '',
      ownerAccountId: deployable?.ownerAccountId ?? '',
      slots: deployable?.slots ?? [],
      removed: !deployable,
    };
  }

  private sendDeployable(containerId: string): void {
    const deployable = this.deployables.get(containerId);
    const payload = this.deployablePayload(containerId);
    const audience = deployable
      ? [...this.connectedAccounts].filter((accountId) =>
          this.canReachThrough(accountId, { ...deployable.position }),
        )
      : [...(this.deployableViewers.get(containerId) ?? [])];
    for (const accountId of audience) {
      this.clientsByAccount.get(accountId)?.send('container', payload);
    }
    if (!deployable) this.deployableViewers.delete(containerId);
  }

  /** The same arrival rule stations and corpses use: an untouched crate never changes. */
  private sendDeployablesToArrivals(): void {
    for (const [containerId, deployable] of this.deployables) {
      const previous = this.deployableViewers.get(containerId) ?? new Set<string>();
      const current = new Set<string>();
      for (const accountId of this.connectedAccounts) {
        if (!this.canReachThrough(accountId, { ...deployable.position })) continue;
        current.add(accountId);
        if (previous.has(accountId)) continue;
        this.clientsByAccount.get(accountId)?.send('container', this.deployablePayload(containerId));
      }
      this.deployableViewers.set(containerId, current);
    }
  }

  /**
   * A corpse's contents are container contents, so like a station's they are a
   * targeted message to the players standing over it rather than shared state
   * (TECHNICAL section 3).
   */
  private corpsePayload(corpseId: string): unknown {
    const corpse = this.corpses.get(corpseId);
    return {
      corpseId,
      ownerAccountId: corpse?.ownerAccountId ?? '',
      slots: corpse?.inventory.slots ?? [],
      // A count, not the contents: section 12 calls the manifest
      // noninteractive, and a looter only needs to know more is coming.
      overflowCount: corpse?.inventory.overflow.length ?? 0,
      removed: !corpse,
    };
  }

  private sendCorpse(corpseId: string): void {
    const corpse = this.corpses.get(corpseId);
    const payload = this.corpsePayload(corpseId);
    // A removal notice goes only to the players who were being shown the body,
    // not to everyone connected: nobody else was told it existed.
    const audience = corpse
      ? [...this.connectedAccounts].filter((accountId) => this.canReachThrough(accountId, { ...corpse.position }))
      : [...(this.corpseViewers.get(corpseId) ?? [])];
    for (const accountId of audience) {
      this.clientsByAccount.get(accountId)?.send('corpse', payload);
    }
    if (!corpse) this.corpseViewers.delete(corpseId);
  }

  /**
   * Shows a corpse's contents to a player the moment they come within reach,
   * the same arrival rule stations use: a body that nobody has touched never
   * changes, so waiting for a change would show them nothing at all.
   */
  private sendCorpsesToArrivals(): void {
    for (const [corpseId, corpse] of this.corpses) {
      const previous = this.corpseViewers.get(corpseId) ?? new Set<string>();
      const current = new Set<string>();
      for (const accountId of this.connectedAccounts) {
        if (!this.canReachThrough(accountId, { ...corpse.position })) continue;
        current.add(accountId);
        if (previous.has(accountId)) continue;
        this.clientsByAccount.get(accountId)?.send('corpse', this.corpsePayload(corpseId));
      }
      this.corpseViewers.set(corpseId, current);
    }
  }

  /** GDD section 8's 30-minute death bag, counted in ticks so it freezes with the host. */
  private expireCorpses(): void {
    for (const [corpseId, corpse] of this.corpses) {
      if (this.state.tick - corpse.diedAtTick < corpse.lifetimeTicks) continue;
      this.removeCorpse(corpseId);
    }
  }

  /**
   * GDD section 12: "Respawn grants the starter kit exactly once and resets
   * survival stats." The "exactly once" is the replay guard -- this runs
   * inside commitOutcome, so a duplicated respawn command returns the first
   * outcome rather than handing out a second kit.
   */
  private resolveRespawn(accountId: string, anchorId: string | null, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    if (!this.deadAccounts.has(accountId)) {
      return { ...base, accepted: false, reasonCode: 'not_dead' };
    }

    // GDD section 12's personal respawn anchor. A refusal leaves the player
    // dead rather than silently dumping them at a random anchor: they asked
    // for a specific place and need to know they did not get it.
    if (anchorId) {
      const refusal = this.checkAnchor(accountId, anchorId);
      if (refusal) return { ...base, accepted: false, reasonCode: refusal };
      const position = { ...this.deployables.get(anchorId)!.position };
      this.startAnchorCooldown(accountId, anchorId);
      this.reviveAt(accountId, position);
      // safe is not in question at a bedroll: the player chose where it went,
      // and section 12's warning is about the random arrival anchor.
      this.clientsByAccount.get(accountId)?.send('respawn', { ...position, safe: true });
      return { ...base, accepted: true, reasonCode: 'ok' };
    }

    // "Active enemies" is read as things that would attack the new body: other
    // living players, and predators. A deer is not an enemy -- it runs from
    // you -- and counting it would push respawns away from the safest ground
    // in the world for no reason.
    const enemies: Point3[] = [];
    for (const creature of this.creatures.values()) {
      if (CREATURE_SPECS[creature.kind].attack === null) continue;
      enemies.push(creature.position);
    }
    for (const [otherId, movement] of this.movementByAccount) {
      if (otherId === accountId || this.deadAccounts.has(otherId)) continue;
      enemies.push(movement.position);
    }
    const chosen = chooseRespawnAnchor(RESPAWN_ANCHORS, enemies, this.respawnRoll);
    const position = chosen ? { ...chosen.anchor.position } : { x: 0, y: 0, z: 0 };

    this.reviveAt(accountId, position);
    // safe: false is section 12's "communicate that the world is dangerous".
    this.clientsByAccount.get(accountId)?.send('respawn', { ...position, safe: chosen?.safe ?? false });
    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  /**
   * GDD section 12's "Respawn grants the starter kit exactly once and resets
   * survival stats", shared by the random anchor and a personal one. The
   * "exactly once" is commitOutcome's, which both paths run inside.
   */
  private reviveAt(accountId: string, position: Point3): void {
    this.deadAccounts.delete(accountId);
    this.movementByAccount.set(accountId, { position, velocityY: 0, grounded: true });
    const player = new PlayerState();
    player.x = position.x;
    player.y = position.y;
    player.z = position.z;
    this.state.players.set(accountId, player);

    const vitals = { calories: CALORIE_SPAWN, health: HEALTH_SPAWN, exposure: 0 };
    this.playerVitals.set(accountId, vitals);
    this.lastDamagedTick.delete(accountId);
    this.useCooldownUntilTick.delete(accountId);
    this.grantSpawnKit(accountId);

    this.store.runInTransaction(() => {
      this.store.setAccountDead(accountId, null);
      this.store.savePlayerVitals(accountId, vitals);
      this.store.savePlayerCheckpoint(accountId, { ...position, yaw: 0, grounded: true });
    });
  }

  /**
   * Empties a corpse into the actor's pack (GDD section 8: "Any person who
   * reaches a box can open it; doors supply security"). Whatever will not fit
   * stays on the body, and the manifest pages into the freed slots so nothing
   * is stranded.
   */
  private resolveCorpseTake(accountId: string, corpseId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const corpse = this.corpses.get(corpseId);
    if (!corpse) return { ...base, accepted: false, reasonCode: 'not_found' };
    if (!this.canReachThrough(accountId, { ...corpse.position })) {
      return { ...base, accepted: false, reasonCode: 'out_of_range' };
    }

    const { source: remaining, destination: slots, moved } = moveAllThatFits(
      corpse.inventory.slots,
      this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null),
      (id) => getItem(id)?.stack ?? 1,
    );

    if (moved === 0) {
      return {
        ...base,
        accepted: false,
        reasonCode: corpse.inventory.slots.some((slot) => slot) ? 'no_space' : 'depleted',
      };
    }

    corpse.inventory = pageOverflowIn(
      { slots: remaining, overflow: corpse.inventory.overflow },
      (id) => getItem(id)?.stack ?? 1,
    );
    this.playerSlots.set(accountId, slots);

    const emptied =
      !corpse.inventory.slots.some((slot) => slot) && corpse.inventory.overflow.length === 0;
    this.store.runInTransaction(() => {
      this.store.savePlayerSlots(accountId, slots);
      if (emptied) {
        this.store.deleteCorpse(corpseId);
      } else {
        this.persistCorpse(corpseId);
      }
    });
    if (emptied) {
      // An empty body is scenery nobody can interact with; GDD section 8's
      // 30-minute timer is for bags that still hold something. The row is
      // already deleted above, inside the same transaction as the pack.
      this.corpses.delete(corpseId);
      this.state.corpses.delete(corpseId);
      this.corpseViewers.delete(corpseId);
    }

    return { ...base, accepted: true, reasonCode: 'ok' };
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
        this.lastDamageCause.set(accountId, effects === this.poisonByAccount ? 'poisoned' : 'bled out');
        this.playerVitals.set(accountId, { ...vitals, health: Math.max(0, vitals.health - damage) });
        // Bleeding counts as damage for the regeneration delay, but it does
        // not cancel a use channel; see damagePlayer and D36.
        this.lastDamagedTick.set(accountId, this.state.tick);
        this.killIfDead(accountId);
      }
    }
  }

  /**
   * What the owner of this body is told about it. Bleeding and poison were
   * computed, persisted and allowed to block regeneration without ever being
   * sent, so a player lost 0.5 HP/s with their healing switched off and had
   * nothing on screen to say why -- while the HUD advertised the cure.
   */
  private vitalsPayload(accountId: string): Record<string, unknown> {
    const effects = this.statusEffectsOf(accountId);
    const remaining = (kind: string): number =>
      effects.find((effect) => effect.kind === kind)?.remainingS ?? 0;
    return {
      ...(this.playerVitals.get(accountId) ?? { calories: 0, health: 0, exposure: 0 }),
      coldDeficit: this.coldDeficitFor(accountId),
      phase: dayPhase(this.state.tick),
      bleedingS: remaining('bleed'),
      poisonedS: remaining('poison'),
    };
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
    if (!this.canReachThrough(accountId, creature.position)) {
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
    if (!this.canReachThrough(accountId, carcass.position)) {
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
      const added = addToInventory(slots, definitionId, quantity, getItem(definitionId)?.stack ?? 1);
      if (added.overflow > 0) return { ...base, accepted: false, reasonCode: 'no_space' };
      slots = added.slots;
    }
    this.lastSwingTick.set(accountId, this.state.tick);
    this.chargeSwingCalorie(accountId);
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

      if (open.repair) {
        this.channelsByAccount.delete(accountId);
        this.completeRepair(accountId, open.repair.site, open.repair.door);
        this.sendChannel(accountId);
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

      this.store.runInTransaction(() => {
        this.playerSlots.set(accountId, next);
        this.store.savePlayerSlots(accountId, next);
        if (open.definitionId === 'bandage') this.woundsByAccount.delete(accountId);
        this.applyConsumable(accountId, open.definitionId);
        this.store.savePlayerVitals(accountId, this.playerVitals.get(accountId)!);
        this.store.saveStatusEffects(accountId, this.statusEffectsOf(accountId));
      });

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
  /**
   * Plain distance, with no wall in the question. Everything a player aims at
   * goes through canReachThrough now (D85); this is what that check is built
   * on, and what the server uses where the target is the barrier itself.
   */
  private isWithinReach(accountId: string, target: Vec3): boolean {
    const movement = this.movementByAccount.get(accountId);
    if (!movement) return false;
    const dx = movement.position.x - target.x;
    const dy = movement.position.y + EYE_HEIGHT_M - target.y;
    const dz = movement.position.z - target.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) <= INTERACT_REACH_M + INTERACT_REACH_TOLERANCE_M;
  }

  /**
   * Distance *and* a clear line to it. T11's "through-wall loot denied":
   * close enough is not the same as reachable, or a base's walls are
   * decoration and its door is the only thing doing any work, which
   * contradicts GDD section 8's "doors supply security".
   *
   * Used by everything a player aims at: containers, corpses, stations, doors,
   * world items and -- since D85 -- every swing. GDD section 7 is explicit
   * that "swing timing, reach and line of sight determine every successful
   * hit", which D64 had read the other way round. A swing at the barrier
   * itself still lands: the segment from the player ends *on* that wall
   * rather than crossing it, so a wall never blocks the blow aimed at it.
   */
  private canReachThrough(accountId: string, target: Vec3): boolean {
    if (!this.isWithinReach(accountId, target)) return false;
    const movement = this.movementByAccount.get(accountId)!;
    return !isReachBlocked(movement.position, target, this.barriers());
  }

  /**
   * The walls standing between people and things. A doorway counts only while
   * it holds a shut door: GDD section 10 says "a door left open lets anyone
   * walk through", and an empty frame is a hole rather than security.
   *
   * Cached, because the list only changes when a piece goes up or a door
   * swings, and rebuilding it per reach check would put a full scan of every
   * wall in the world on each one.
   */
  private barriers(): GroundSegment[] {
    if (this.barrierCache) return this.barrierCache;
    const segments: GroundSegment[] = [];
    for (const [key, piece] of this.buildingPieces) {
      // D78's recorded cost, contained: wallSegment ignores storey, so an
      // upper-floor wall would flatten into a barrier at ground level and stop
      // anyone walking past the building outside. Ground floor only until the
      // barrier list carries height; an upper wall is decoration for now,
      // which is consistent with there being no floor to stand on up there.
      if (piece.site.storey !== 0) continue;
      if (piece.site.form === 'wall') {
        segments.push(wallSegment(piece.site));
        continue;
      }
      if (piece.site.form !== 'doorway') continue;
      const door = this.doors.get(key);
      if (door && !door.open) segments.push(wallSegment(piece.site));
    }
    this.barrierCache = segments;
    return segments;
  }

  /**
   * What a step has to get round, which is more than what a reach has to see
   * past: a crate is solid to walk into but must not occlude anything, because
   * its own centre lies inside its own footprint and a crate that blocked a
   * reach would be a crate nobody could open.
   *
   * Cached separately from barriers() because it also changes when a crate goes
   * down or breaks; invalidateBarriers clears both together so a new wall can
   * never refresh one list and leave the other holding the old copy of it.
   */
  private movementBarriers(): GroundSegment[] {
    if (this.movementBarrierCache) return this.movementBarrierCache;
    const segments = [...this.barriers()];
    for (const deployable of this.deployables.values()) {
      segments.push(
        ...footprintSegments(deployable.position, DEPLOYABLE_FOOTPRINT_M[deployable.definitionId] ?? 0),
      );
    }
    this.movementBarrierCache = segments;
    return segments;
  }

  private invalidateBarriers(): void {
    this.barrierCache = null;
    this.movementBarrierCache = null;
  }

  onAuth(_client: RoomClient, options: unknown): boolean {
    if (this.failed) return false;
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!parsed.success) return false;
    return this.store.authenticateAccount(parsed.data.accountId, parsed.data.accountToken);
  }

  onJoin(client: RoomClient, options: { accountId?: string }): void {
    const accountId = options?.accountId;
    if (!accountId) {
      throw new Error('accountId is required to join the world');
    }

    let sessionEpoch = 0;
    this.store.runInTransaction(() => {
    sessionEpoch = this.store.beginSession(accountId);
    client.userData = { accountId, sessionEpoch };
    // Deferred one tick: sending synchronously from onJoin can race the
    // client SDK's own post-join message listener registration.
    this.clock.setTimeout(() => client.send('session', { sessionEpoch }), 0);

    if (!this.state.players.has(accountId) && !this.deadAccounts.has(accountId)) {
      // Fresh player: spawn kit position, GDD section 5's ground level. A dead
      // account is skipped deliberately -- GDD section 12 gives it "a death
      // recap and respawn options", not a new body just for reconnecting.
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
    const movement = this.movementByAccount.get(accountId);
    if (movement) this.store.savePlayerCheckpoint(accountId, { ...movement.position, yaw: this.state.players.get(accountId)?.yaw ?? 0, grounded: movement.grounded });
    this.store.savePlayerVitals(accountId, this.playerVitals.get(accountId)!);
    });
    this.pendingMove.delete(accountId);
    this.channelsByAccount.delete(accountId);
    for (const viewers of [this.stationViewers, this.corpseViewers, this.deployableViewers]) {
      for (const audience of viewers.values()) audience.delete(accountId);
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
      client.send('vitals', this.vitalsPayload(accountId));
      // A reconnect mid-craft must not present an empty queue while escrow
      // is still held.
      this.sendCrafting(accountId);
      // GDD section 12: "If killed while away, show a death recap and respawn
      // options." Without this a player who was killed as a sleeper comes back
      // to a world they cannot act in and no explanation.
      if (this.deadAccounts.has(accountId)) {
        const own = [...this.corpses].find(([, corpse]) => corpse.ownerAccountId === accountId);
        client.send('death', {
          corpseId: own?.[0] ?? null,
          tick: this.deadAccounts.get(accountId),
          cause: this.lastDamageCause.get(accountId) ?? 'killed',
        });
      }
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
      // Dropped, not neutralised: tickMovement walks every body and falls back
      // to a neutral action, so a sleeper with no intent still falls under
      // gravity (GDD section 12) while its motion stops, which is both halves
      // of the rule.
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

    const key = { accountId, sessionEpoch: command.sessionEpoch, sequence: command.sequence };
    if (command.action.type !== 'move' && this.deadAccounts.has(accountId)) {
      const prior = this.store.loadOutcome(key);
      if (prior !== undefined) {
        client.send('commandResult', JSON.parse(prior) as CommandResult);
        return;
      }
    }

    // GDD section 12 marks a dead account dead until it respawns: it has no
    // live character, so nothing but the respawn itself can be acted on.
    //
    // Moves are exempt from the *reply*, not from the refusal: a dead client
    // keeps sending move intents at its normal rate while the player reads the
    // death prompt, and answering each one would spend a message per move and
    // pin the HUD's last-result line to "dead". They are dropped silently, the
    // same way a live move never gets a result either. The body cannot move
    // regardless -- death deletes its movement state, so the tick skips it.
    if (this.deadAccounts.has(accountId) && command.action.type === 'move') {
      return;
    }
    if (this.deadAccounts.has(accountId) && command.action.type !== 'respawn') {
      client.send('commandResult', {
        sequence: command.sequence,
        accepted: false,
        reasonCode: 'dead',
        serverTick: this.state.tick,
      } satisfies CommandResult);
      return;
    }

    if (command.action.type === 'respawn') {
      const anchorId = command.action.anchorId ?? null;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveRespawn(accountId, anchorId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      client.send('vitals', this.vitalsPayload(accountId));
      return;
    }

    if (command.action.type === 'move') {
      this.pendingMove.set(accountId, { action: command.action, tick: this.state.tick });
      return;
    }

    if (command.action.type === 'placeDeployable') {
      const { definitionId, x, y, z } = command.action;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolvePlaceDeployable(accountId, definitionId, { x, y, z }, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      return;
    }

    if (command.action.type === 'attackDeployable') {
      const deployableId = command.action.deployableId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveAttackDeployable(accountId, deployableId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      return;
    }

    if (command.action.type === 'repairStructure') {
      const { form, door, storey, i, k, axis } = command.action;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(
          this.resolveRepairStructure(accountId, { form, storey, i, k, axis }, door, command.sequence),
        ),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      this.sendChannel(accountId);
      return;
    }

    if (command.action.type === 'attackStructure') {
      const { form, door, storey, i, k, axis } = command.action;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(
          this.resolveAttackStructure(accountId, { form, storey, i, k, axis }, door, command.sequence),
        ),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      return;
    }

    if (command.action.type === 'placeBuildingPiece') {
      const { definitionId, form, storey, i, k, axis } = command.action;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(
          this.resolvePlaceBuildingPiece(accountId, definitionId, { form, storey, i, k, axis }, command.sequence),
        ),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      return;
    }

    if (
      command.action.type === 'installDoor' ||
      command.action.type === 'operateDoor' ||
      command.action.type === 'setDoorAccess'
    ) {
      const action = command.action;
      const site: PieceSite = {
        form: 'doorway',
        storey: action.storey,
        i: action.i,
        k: action.k,
        axis: action.axis,
      };
      const encoded = this.store.commitOutcome(key, () => {
        if (action.type === 'installDoor') {
          return JSON.stringify(this.resolveInstallDoor(accountId, action.definitionId, site, command.sequence));
        }
        if (action.type === 'operateDoor') {
          return JSON.stringify(this.resolveOperateDoor(accountId, site, action.open, command.sequence));
        }
        return JSON.stringify(
          this.resolveSetDoorAccess(accountId, site, action.targetAccountId, action.granted, command.sequence),
        );
      });
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      return;
    }

    if (command.action.type === 'setBuildAccess') {
      const { targetAccountId, granted } = command.action;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveSetBuildAccess(accountId, targetAccountId, granted, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      return;
    }

    if (command.action.type === 'containerInsert' || command.action.type === 'containerTake') {
      const action = command.action;
      const containerId = action.containerId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(
          action.type === 'containerInsert'
            ? this.resolveContainerInsert(
                accountId,
                containerId,
                action.definitionId,
                action.quantity,
                command.sequence,
              )
            : this.resolveContainerTake(accountId, containerId, command.sequence),
        ),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      this.sendDeployable(containerId);
      return;
    }

    if (command.action.type === 'corpseTake') {
      const corpseId = command.action.corpseId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveCorpseTake(accountId, corpseId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      client.send('inventory', { slots: this.playerSlots.get(accountId) });
      this.sendCorpse(corpseId);
      return;
    }

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
    if (action.type !== 'stationInsert' && action.type !== 'stationTake' && action.type !== 'stationLight') {
      return; // every other action type returned above
    }
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
    if (!this.canReachThrough(accountId, config.position)) return 'out_of_range';
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

    // Whatever will not fit stays in the station rather than being dropped.
    const { source: remaining, destination: slots, moved } = moveAllThatFits(
      station.outputs,
      this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null),
      (id) => getItem(id)?.stack ?? 1,
    );

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
      if (!this.canReachThrough(accountId, config.position)) continue;
      this.clientsByAccount.get(accountId)?.send('station', payload);
    }
  }

  private resolveTakeItem(accountId: string, itemInstanceId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const position = this.itemPositions.get(itemInstanceId);
    // Checked before the claim so an out-of-reach attempt neither takes the
    // item nor reveals whether it was still unclaimed.
    if (position && !this.canReachThrough(accountId, position)) {
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
    if (!this.canReachThrough(accountId, config.position)) {
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

      this.store.runInTransaction(() => {
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
      });
    }
  }

  /**
   * Cold deficit for a player right now (GDD section 6): environment pressure
   * minus worn/fire/shelter warmth. Per player rather than per tick, because
   * standing at a fire is now the difference between the two.
   */
  private coldDeficitFor(accountId: string): number {
    const pressure = lowlandColdPressure(dayPhase(this.state.tick));
    const movement = this.movementByAccount.get(accountId);
    // GDD section 6: "a fire within 4 m with unobstructed warmth ray gives
    // 40". There is nothing to obstruct it yet -- walls are M2 -- so the ray
    // is always clear. Worn clothing (20 for a full cloth set) and a held lit
    // torch (10) still contribute nothing, because neither is equippable.
    const warmth = movement && this.isNearLitCampfire(movement.position) ? FIRE_WARMTH : 0;
    return computeColdDeficit(pressure, warmth);
  }

  /** Test-only read accessor for the cold vertical. */
  coldDeficitForTest(accountId: string): number {
    return this.coldDeficitFor(accountId);
  }

  /**
   * Test-only: where the simulation thinks a body is, which is not always what
   * the replicated schema says -- teleportForTest moves the former and only a
   * movement tick copies it into the latter.
   */
  positionForTest(accountId: string): Point3 | undefined {
    const movement = this.movementByAccount.get(accountId);
    return movement ? { ...movement.position } : undefined;
  }

  /** Test-only: moves a body without driving it there. */
  teleportForTest(accountId: string, position: Point3): void {
    const movement = this.movementByAccount.get(accountId);
    if (movement) this.movementByAccount.set(accountId, { ...movement, position: { ...position } });
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

  isDeadForTest(accountId: string): boolean {
    return this.deadAccounts.has(accountId);
  }

  corpseForTest(
    corpseId: string,
  ): { ownerAccountId: string; position: Point3; inventory: CorpseInventory; diedAtTick: number } | undefined {
    return this.corpses.get(corpseId);
  }

  doorForTest(site: PieceSite): { ownerAccountId: string; open: boolean } | undefined {
    return this.doors.get(siteKey(site));
  }

  setDeployableHealthForTest(deployableId: string, health: number): void {
    const replicated = this.state.deployables.get(deployableId);
    if (replicated) replicated.health = health;
  }

  setDoorHealthForTest(site: PieceSite, health: number): void {
    const replicated = this.state.doors.get(siteKey(site));
    if (replicated) replicated.health = health;
  }

  /** Test-only: drops a piece to one swing from destruction instead of a hundred. */
  setPieceHealthForTest(site: PieceSite, health: number): void {
    const replicated = this.state.buildingPieces.get(siteKey(site));
    if (replicated) replicated.health = health;
  }

  /**
   * Test-only: removes a piece the way decay or demolition will, exercising
   * the same cascade a destruction does. Pillars are combat immune, so this is
   * the only way to knock one out today.
   */
  removePieceForTest(site: PieceSite): void {
    this.destroyPiece(siteKey(site));
  }

  /** Test-only: runs one decay minute without waiting for the real tick timer. */
  decayTickForTest(): void {
    this.tickDecay();
  }

  socketLockedForTest(site: PieceSite): boolean {
    return (this.socketLockedUntilTick.get(siteKey(site)) ?? -Infinity) > this.state.tick;
  }

  raidLockedForTest(site: PieceSite): boolean {
    return this.isRaidLocked(this.buildingFrom([siteKey(site)]));
  }

  containerForTest(containerId: string): Slot[] | undefined {
    return this.deployables.get(containerId)?.slots;
  }

  corpseIdForTest(ownerAccountId: string): string | undefined {
    return [...this.corpses].find(([, corpse]) => corpse.ownerAccountId === ownerAccountId)?.[0];
  }

  respawnAnchorsForTest(): RespawnAnchor[] {
    return RESPAWN_ANCHORS;
  }

  expireCorpsesForTest(): void {
    this.expireCorpses();
  }

  /** Test-only read accessors; no client-facing binding. */
  isConnectedForTest(accountId: string): boolean {
    return this.connectedAccounts.has(accountId);
  }

  nodeRemainingForTest(nodeId: string): number | undefined {
    return this.resourceNodes.get(nodeId)?.remaining;
  }

  /** The first seeded node paying out this resource, or undefined if none does. */
  nodeYieldingForTest(definitionId: string): string | undefined {
    for (const [nodeId, config] of this.nodeConfigs) {
      if (config.definitionId === definitionId) return nodeId;
    }
    return undefined;
  }

  nodePositionForTest(nodeId: string): Vec3 | undefined {
    return this.nodeConfigs.get(nodeId)?.position;
  }

  countForTest(accountId: string, definitionId: string): number {
    return countInInventory(this.playerSlots.get(accountId) ?? [], definitionId);
  }

  craftingEntryForTest(accountId: string): QueueEntry | undefined {
    return this.craftingByAccount.get(accountId);
  }

  advanceMovementForTest(dt: number): void {
    this.tickMovement(dt);
  }

  /**
   * Walks every player one step, and stops the ones who walked into a wall.
   *
   * Collision is resolved here rather than inside stepMovement because a
   * barrier is world state, not a property of the mover: the same step is
   * legal or not depending on whether somebody has since shut a door. GDD
   * section 10's "a door left open lets anyone walk through" is the whole
   * rule, and it is the barrier list -- shared with reach and with blast
   * occlusion -- that says which of the two a doorway currently is.
   */
  private tickMovement(dt: number): void {
    for (const [accountId, movement] of this.movementByAccount) {
      const action = this.pendingMove.get(accountId)?.action ?? {
        type: 'move', axisX: 0, axisY: 0, yaw: this.state.players.get(accountId)?.yaw ?? 0,
        sprint: false, crouch: false, jump: false,
      };
      const player = this.state.players.get(accountId);
      if (!movement || !player) continue;

      const stepped = stepMovement(movement, action, dt);
      const ground = resolveMove(movement.position, stepped.position, this.movementBarriers());
      const next: MovementState = {
        ...stepped,
        position: { x: ground.x, y: stepped.position.y, z: ground.z },
      };
      this.movementByAccount.set(accountId, next);

      player.x = next.position.x;
      player.y = next.position.y;
      player.z = next.position.z;
      player.yaw = action.yaw;
      player.grounded = next.grounded;
    }
  }

  private tick(dt: number): void {
    this.state.tick += 1;

    this.expireStaleMoveIntents();

    this.tickMovement(dt);

    this.tickCreatures(dt);

    this.expireCarcasses();
    this.expireCorpses();
    if (this.state.tick - this.lastDecayTick >= DECAY_INTERVAL_TICKS) {
      this.lastDecayTick = this.state.tick;
      this.tickDecay();
    }
    this.sendCorpsesToArrivals();
    this.sendDeployablesToArrivals();

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
        if (!this.canReachThrough(accountId, config.position)) continue;
        current.add(accountId);
        if (previous.has(accountId)) continue;
        this.clientsByAccount.get(accountId)?.send('station', this.stationPayload(stationId));
      }
      this.stationViewers.set(stationId, current);
    }
  }

  /** Calories, starvation, hot-ore exposure and cold, for every connected player. */
  private tickSurvival(dt: number): void {
    for (const accountId of this.connectedAccounts) {
      const vitals = this.playerVitals.get(accountId);
      const movement = this.movementByAccount.get(accountId);
      if (!vitals || !movement) continue;

      const coldDeficit = this.coldDeficitFor(accountId);

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
      if (damage > 0) {
        this.lastDamagedTick.set(accountId, this.state.tick);
        // Whichever of the three is doing the most, since that is the one the
        // player would have had to act on.
        const worst = Math.max(starvation, exposureDamage, coldDamage);
        this.lastDamageCause.set(
          accountId,
          worst === starvation ? 'starved' : worst === exposureDamage ? 'hot-ore sickness' : 'frozen',
        );
      }

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

      this.clientsByAccount.get(accountId)?.send('vitals', this.vitalsPayload(accountId));

      // Starvation, exposure and cold can all finish a player off, not only a
      // wolf (GDD section 11: "zero HP is death").
      this.killIfDead(accountId);
    }
  }
}
