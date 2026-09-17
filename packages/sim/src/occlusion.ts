import { CELL_SIZE_M, type PieceSite } from './building.js';

/** A barrier on the ground plane, from one corner of a cell edge to the other. */
export interface GroundSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * Where a wall or doorway stands on the ground (GDD section 10's grid). Height
 * is ignored: everything a player can currently reach for sits on the floor,
 * and pretending to do this in three dimensions would only be guessing at
 * numbers the design has not given.
 */
export function wallSegment(site: PieceSite): GroundSegment {
  const x = site.i * CELL_SIZE_M;
  const z = site.k * CELL_SIZE_M;
  return site.axis === 'x'
    ? { x1: x, z1: z, x2: x + CELL_SIZE_M, z2: z }
    : { x1: x, z1: z, x2: x, z2: z + CELL_SIZE_M };
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/**
 * Whether two ground segments properly cross. Touching at an endpoint or
 * lying along the same line does not count: a player standing exactly on a
 * wall's line, past its end, has not reached through anything.
 */
function segmentsCross(a: GroundSegment, b: GroundSegment): boolean {
  const rx = a.x2 - a.x1;
  const rz = a.z2 - a.z1;
  const sx = b.x2 - b.x1;
  const sz = b.z2 - b.z1;
  const denominator = cross(rx, rz, sx, sz);
  if (denominator === 0) return false; // parallel, including collinear

  const t = cross(b.x1 - a.x1, b.z1 - a.z1, sx, sz) / denominator;
  const u = cross(b.x1 - a.x1, b.z1 - a.z1, rx, rz) / denominator;
  return t > 0 && t < 1 && u > 0 && u < 1;
}

/**
 * Whether a barrier stands between these two points (T11's "through-wall loot
 * denied"). GDD section 8 lets anyone who "reaches a box" open it, so what
 * counts as reaching has to account for the wall in the way -- otherwise a
 * base's walls are decoration and its door is the only thing doing any work.
 *
 * The caller decides which pieces are barriers: a doorway holding a closed
 * door is one, an empty or open doorway is not, because section 10 says "a
 * door left open lets anyone walk through".
 */
export function isReachBlocked(
  from: { x: number; z: number },
  to: { x: number; z: number },
  barriers: GroundSegment[],
): boolean {
  const reach: GroundSegment = { x1: from.x, z1: from.z, x2: to.x, z2: to.z };
  return barriers.some((barrier) => segmentsCross(reach, barrier));
}
