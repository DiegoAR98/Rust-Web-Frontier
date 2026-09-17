import type { Point3 } from './wildlife.js';

/**
 * GDD section 10 requires "minimum non-overlapping spacing" for deployables
 * without giving a figure, and gives exactly one clearance number in the same
 * paragraph: "A new detached foundation must be at least 1 m from any existing
 * foundation edge." Reusing it rather than inventing a second number.
 */
export const PLACEMENT_CLEARANCE_M = 1;
/** GDD section 10: "max 400 structural pieces and 100 deployables per owner". */
export const DEPLOYABLES_PER_OWNER = 100;
/** GDD section 10: "a 6000-world-entity build/deployable cap bound growth". */
export const WORLD_ENTITY_CAP = 6000;

export type PlacementRefusal = 'out_of_range' | 'overlap' | 'owner_cap' | 'world_cap';

export interface PlacementRequest {
  position: Point3;
  actorPosition: Point3;
  reachM: number;
  /** Everything the new deployable must not land on: players, other placed things, anchors. */
  occupied: Point3[];
  ownerDeployableCount: number;
  worldEntityCount: number;
}

/**
 * Whether a deployable may be placed here (GDD section 10). Returns the
 * refusal, or null when the placement is legal. Callers check this *before*
 * consuming the item: "Reaching a cap produces an understandable error before
 * consumption."
 *
 * Refusals are ordered by how close the cause is to the player, so the message
 * they get is about something they can see and act on: being told a spot 40 m
 * away is occupied when the real problem is that they cannot reach it is not
 * an understandable error.
 */
export function validateDeployablePlacement(request: PlacementRequest): PlacementRefusal | null {
  const dx = request.position.x - request.actorPosition.x;
  const dy = request.position.y - request.actorPosition.y;
  const dz = request.position.z - request.actorPosition.z;
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > request.reachM) {
    return 'out_of_range';
  }

  for (const other of request.occupied) {
    // Ground distance, not the full 3D one: two crates on the same ground are
    // not separated by one being a metre above the other's origin, and there
    // is no stacking for that to be wrong about yet.
    const ox = request.position.x - other.x;
    const oz = request.position.z - other.z;
    if (Math.sqrt(ox * ox + oz * oz) < PLACEMENT_CLEARANCE_M) {
      return 'overlap';
    }
  }

  if (request.ownerDeployableCount >= DEPLOYABLES_PER_OWNER) return 'owner_cap';
  if (request.worldEntityCount >= WORLD_ENTITY_CAP) return 'world_cap';
  return null;
}
