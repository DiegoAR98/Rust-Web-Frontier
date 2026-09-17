import type { Point3 } from './wildlife.js';

/** GDD section 12: "preferring one at least 75 m from active enemies". */
export const RESPAWN_ENEMY_CLEARANCE_M = 75;

export interface RespawnAnchor {
  id: string;
  position: Point3;
}

function distance(a: Point3, b: Point3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function nearestEnemyDistance(anchor: RespawnAnchor, enemies: Point3[]): number {
  let nearest = Infinity;
  for (const enemy of enemies) {
    nearest = Math.min(nearest, distance(anchor.position, enemy));
  }
  return nearest;
}

/**
 * Picks where a respawning player appears (GDD section 12). Anchors with the
 * full clearance are equally good, so one is chosen at random -- otherwise
 * every death in a quiet world lands on the same spot. When no anchor is
 * clear the choice stops being a lottery and becomes the least exposed one,
 * reported with safe: false so the player can be told the world is dangerous
 * rather than silently dropped next to whoever killed them.
 *
 * `anchors` are the ones the caller has already established are valid --
 * outside hazards and structures, not inside collision.
 */
export function chooseRespawnAnchor(
  anchors: RespawnAnchor[],
  enemies: Point3[],
  roll: () => number,
): { anchor: RespawnAnchor; safe: boolean } | null {
  if (anchors.length === 0) {
    return null;
  }

  const clear = anchors.filter((a) => nearestEnemyDistance(a, enemies) >= RESPAWN_ENEMY_CLEARANCE_M);
  if (clear.length > 0) {
    const index = Math.min(clear.length - 1, Math.floor(roll() * clear.length));
    return { anchor: clear[index]!, safe: true };
  }

  let best = anchors[0]!;
  let bestDistance = nearestEnemyDistance(best, enemies);
  for (const anchor of anchors.slice(1)) {
    const d = nearestEnemyDistance(anchor, enemies);
    if (d > bestDistance) {
      best = anchor;
      bestDistance = d;
    }
  }
  return { anchor: best, safe: false };
}
