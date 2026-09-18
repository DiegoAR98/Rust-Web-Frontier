import { isReachBlocked, type GroundSegment } from './occlusion.js';

/** A point on the ground plane. Height is not part of a barrier; see wallSegment. */
interface Ground {
  x: number;
  z: number;
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
