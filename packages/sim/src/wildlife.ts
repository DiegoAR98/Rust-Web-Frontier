export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export type CreatureKind = 'deer' | 'wolf';

/** GDD section 7's "simple wander/flee/chase/attack/return states". */
export type CreatureMode = 'wander' | 'flee' | 'chase' | 'attack' | 'return';

export interface CreatureSpec {
  health: number;
  /** CONTENT section 4's "Max chase/flee m/s". */
  speed: number;
  /** GDD section 7: predators notice at 25 m, prey at 20 m. */
  noticeRange: number;
  /** How far from its anchor a predator will follow before giving up; prey have none. */
  leashRange: number | null;
  attack: { damage: number; intervalS: number } | null;
  harvest: Record<string, number>;
}

/** GDD section 7: "melee reach 1.8 m", the same for every creature. */
export const CREATURE_MELEE_REACH_M = 1.8;

/** CONTENT section 4's creature table, for the two the world starts with. */
export const CREATURE_SPECS: Record<CreatureKind, CreatureSpec> = {
  deer: {
    health: 60,
    speed: 6.5,
    noticeRange: 20,
    leashRange: null,
    attack: null,
    harvest: { raw_meat: 8, cloth: 8, hide: 4, fat: 4 },
  },
  wolf: {
    health: 100,
    speed: 6,
    noticeRange: 25,
    leashRange: 80,
    attack: { damage: 15, intervalS: 1.5 },
    harvest: { raw_meat: 6, cloth: 6, hide: 8, fat: 4 },
  },
};

export interface CreatureState {
  kind: CreatureKind;
  mode: CreatureMode;
  position: Point3;
  /** Where it was spawned; leashing and returning are measured from here. */
  anchor: Point3;
  health: number;
  /** Seconds until it can bite again (CONTENT section 4's "Hit / interval"). */
  attackCooldownS: number;
  /**
   * Seconds of alarm left after being hurt. GDD section 7's prey "flee when
   * approached *or hurt*", so a deer shot from beyond its notice range still
   * runs instead of grazing.
   */
  alarmS: number;
  /**
   * How long it has been aware of a target it has no clear line to. See
   * PATHING_GIVE_UP_S.
   */
  blockedS: number;
}

/**
 * GDD section 7: "if pathfinding fails for 5 seconds, retreat rather than
 * teleport or hit through geometry." Before walls existed there was nothing
 * for a path to fail against. Now that one stops an animal, a base without
 * this rule collects a permanent collar of wolves pressed against it -- unable
 * to reach anyone inside and unwilling to leave, which is worse to play
 * against than the wall they used to walk through.
 */
export const PATHING_GIVE_UP_S = 5;

export function spawnCreature(kind: CreatureKind, anchor: Point3): CreatureState {
  return {
    kind,
    mode: 'wander',
    position: { ...anchor },
    anchor: { ...anchor },
    health: CREATURE_SPECS[kind].health,
    attackCooldownS: 0,
    alarmS: 0,
    blockedS: 0,
  };
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Moves `from` toward `toward` at `speed`, never overshooting. Straight-line:
 * the world is one flat plane with no collision, so there is nothing to path
 * around yet. GDD section 7's "if pathfinding fails for 5 seconds, retreat
 * rather than teleport or hit through geometry" needs the geometry that
 * arrives with M2's buildings before it can be written or exercised.
 */
function moveToward(from: Point3, toward: Point3, speed: number, dt: number): Point3 {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const dz = toward.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return { ...from };
  const step = Math.min(speed * dt, length);
  return {
    x: from.x + (dx / length) * step,
    y: from.y + (dy / length) * step,
    z: from.z + (dz / length) * step,
  };
}

function moveAwayFrom(from: Point3, threat: Point3, speed: number, dt: number): Point3 {
  const dx = from.x - threat.x;
  const dy = from.y - threat.y;
  const dz = from.z - threat.z;
  const length = Math.hypot(dx, dy, dz);
  // Standing exactly on the threat gives no direction to run in; pick one.
  if (length === 0) return { x: from.x + speed * dt, y: from.y, z: from.z };
  return {
    x: from.x + (dx / length) * speed * dt,
    y: from.y + (dy / length) * speed * dt,
    z: from.z + (dz / length) * speed * dt,
  };
}

/** Close enough to its anchor to count as home again. */
const ANCHOR_TOLERANCE_M = 0.5;

export interface CreatureStep {
  state: CreatureState;
  /** Damage dealt to the target this step; 0 when it did not bite. */
  attackDamage: number;
}

/**
 * Advances one creature by dt seconds against the nearest eligible player.
 *
 * "Wander" is standing at the anchor: a real idle walk needs a random source,
 * which would make this impure and the room's simulation non-deterministic on
 * replay. Add it with a seeded stream when animals need to look alive rather
 * than merely behave correctly.
 */
export function stepCreature(
  state: CreatureState,
  spec: CreatureSpec,
  target: Point3 | null,
  dt: number,
  /**
   * Whether there is a clear line to the target. The caller owns the geometry;
   * this only has to know whether the straight line it walks and bites along
   * is open, which for a creature that does not path is the same question as
   * "can it get there".
   */
  targetReachable = true,
): CreatureStep {
  const alarmS = Math.max(0, state.alarmS - dt);
  const attackCooldownS = Math.max(0, state.attackCooldownS - dt);
  const next: CreatureState = { ...state, alarmS, attackCooldownS };

  const toTarget = target ? distance(state.position, target) : Infinity;
  const fromAnchor = distance(state.position, state.anchor);

  // A predator dragged past its leash breaks off, whatever the player does.
  if (spec.leashRange !== null && fromAnchor > spec.leashRange) {
    next.mode = 'return';
    next.position = moveToward(state.position, state.anchor, spec.speed, dt);
    return { state: next, attackDamage: 0 };
  }

  const aware = target !== null && (toTarget <= spec.noticeRange || alarmS > 0);

  // Only counted while it is actually trying to get at something: the clock
  // has to keep running once it has given up, or it flips straight back to
  // chasing on the very next step and never goes anywhere.
  next.blockedS = aware && !targetReachable ? state.blockedS + dt : 0;

  if (aware && target) {
    if (next.blockedS >= PATHING_GIVE_UP_S) {
      next.mode = 'return';
      next.position = moveToward(state.position, state.anchor, spec.speed, dt);
      return { state: next, attackDamage: 0 };
    }

    if (spec.attack === null) {
      next.mode = 'flee';
      next.position = moveAwayFrom(state.position, target, spec.speed, dt);
      return { state: next, attackDamage: 0 };
    }

    if (toTarget <= CREATURE_MELEE_REACH_M) {
      next.mode = 'attack';
      if (attackCooldownS > 0) return { state: next, attackDamage: 0 };
      next.attackCooldownS = spec.attack.intervalS;
      // "rather than teleport or hit through geometry". The swing is spent
      // either way: CONTENT section 4's interval is a rate of attacking, not
      // a rate of connecting, so a wall absorbs the bite rather than banking it.
      return { state: next, attackDamage: targetReachable ? spec.attack.damage : 0 };
    }

    next.mode = 'chase';
    next.position = moveToward(state.position, target, spec.speed, dt);
    return { state: next, attackDamage: 0 };
  }

  if (fromAnchor > ANCHOR_TOLERANCE_M) {
    next.mode = 'return';
    next.position = moveToward(state.position, state.anchor, spec.speed, dt);
    return { state: next, attackDamage: 0 };
  }

  next.mode = 'wander';
  return { state: next, attackDamage: 0 };
}
