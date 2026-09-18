import { isReachBlocked, type GroundSegment } from './occlusion.js';

/** A point on the ground plane. Height is not part of a barrier; see wallSegment. */
interface Ground {
  x: number;
  z: number;
}

/**
 * The four sides of a square box standing on the ground, as barriers. A size of
 * zero produces none, which is how something you are meant to walk over -- a
 * bedroll -- is expressed.
 *
 * Deliberately NOT fed into the barrier list that reach and blast occlusion
 * use: a box's own centre is inside its own footprint, so a crate that occluded
 * a reach would be a crate nobody could open.
 *
 * Known degeneracy, inherited from segmentsCross and the same one that keeps a
 * wall from welding a player in place: a path that passes exactly through two
 * opposite corners touches only endpoints, and so is not blocked. It needs the
 * player's line to hit both corners to floating-point precision, and the price
 * of closing it is a fudge factor that would start trapping people.
 */
export function footprintSegments(centre: Ground, sizeM: number): GroundSegment[] {
  if (sizeM <= 0) return [];
  const half = sizeM / 2;
  const x1 = centre.x - half;
  const x2 = centre.x + half;
  const z1 = centre.z - half;
  const z2 = centre.z + half;
  return [
    { x1, z1, x2, z2: z1 },
    { x1, z1: z2, x2, z2 },
    { x1, z1, x2: x1, z2 },
    { x1: x2, z1, x2, z2 },
  ];
}

/**
 * Where a step actually ends once the walls are taken into account (GDD
 * section 5: "All collision meshes are shared in meaning between client
 * prediction and server simulation").
 *
 * The question a footstep asks is the one a reach already asks -- does the
 * line from here to there cross a barrier -- so it is asked with the same
 * function, of the same barrier list. A doorway holding a shut door is in that
 * list and an open or empty one is not, which is what makes a door the way in
 * rather than decoration.
 *
 * A blocked step retries one axis at a time so that walking into a wall at an
 * angle slides along it instead of stopping dead: a base otherwise stands in a
 * strip of ground that arrests anyone who brushes it. Both axes blocked means
 * the step does not happen, which is what being sealed in a room is.
 */
export function resolveMove(from: Ground, to: Ground, barriers: GroundSegment[]): Ground {
  if (!isReachBlocked(from, to, barriers)) return to;

  const alongX = { x: to.x, z: from.z };
  if (!isReachBlocked(from, alongX, barriers)) return alongX;

  const alongZ = { x: from.x, z: to.z };
  if (!isReachBlocked(from, alongZ, barriers)) return alongZ;

  return from;
}
