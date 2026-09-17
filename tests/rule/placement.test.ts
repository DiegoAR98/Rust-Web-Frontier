import { describe, expect, it } from 'vitest';
import {
  DEPLOYABLES_PER_OWNER,
  PLACEMENT_CLEARANCE_M,
  WORLD_ENTITY_CAP,
  validateDeployablePlacement,
  type PlacementRequest,
} from '@rwf/sim';

/**
 * GDD section 10: "Reject overlap with players, sleepers, containers,
 * resource anchors or world geometry. Minimum non-overlapping spacing plus
 * max 400 structural pieces and 100 deployables per owner ... and a
 * 6000-world-entity build/deployable cap bound growth. Reaching a cap
 * produces an understandable error before consumption."
 */

function request(overrides: Partial<PlacementRequest> = {}): PlacementRequest {
  return {
    position: { x: 2, y: 0, z: 0 },
    actorPosition: { x: 0, y: 0, z: 0 },
    reachM: 3,
    occupied: [],
    ownerDeployableCount: 0,
    worldEntityCount: 0,
    ...overrides,
  };
}

describe('deployable placement (GDD section 10)', () => {
  it('accepts a clear spot within reach', () => {
    expect(validateDeployablePlacement(request())).toBeNull();
  });

  it('refuses a spot the player cannot reach', () => {
    expect(validateDeployablePlacement(request({ position: { x: 40, y: 0, z: 0 } }))).toBe('out_of_range');
  });

  it('refuses to drop a crate on top of something already there', () => {
    const occupied = [{ x: 2.4, y: 0, z: 0 }];
    expect(validateDeployablePlacement(request({ occupied }))).toBe('overlap');
  });

  it('allows a crate exactly the clearance away', () => {
    const occupied = [{ x: 2 + PLACEMENT_CLEARANCE_M, y: 0, z: 0 }];
    expect(validateDeployablePlacement(request({ occupied }))).toBeNull();
  });

  it('ignores height when measuring clearance', () => {
    // Two crates on the same ground are not separated by one being a metre
    // above the other's origin; the world is not stacked yet and pretending
    // otherwise would let them intersect.
    const occupied = [{ x: 2, y: 1.2, z: 0 }];
    expect(validateDeployablePlacement(request({ occupied }))).toBe('overlap');
  });

  it('refuses the owner their hundred-and-first deployable', () => {
    expect(validateDeployablePlacement(request({ ownerDeployableCount: DEPLOYABLES_PER_OWNER - 1 }))).toBeNull();
    expect(validateDeployablePlacement(request({ ownerDeployableCount: DEPLOYABLES_PER_OWNER }))).toBe('owner_cap');
  });

  it('refuses a placement that would pass the world entity cap', () => {
    expect(validateDeployablePlacement(request({ worldEntityCount: WORLD_ENTITY_CAP - 1 }))).toBeNull();
    expect(validateDeployablePlacement(request({ worldEntityCount: WORLD_ENTITY_CAP }))).toBe('world_cap');
  });

  it('reports the reason nearest the player when several apply', () => {
    // Standing far away from a spot that is also occupied: being told the
    // crate would overlap something you cannot even see is unhelpful.
    const refusal = validateDeployablePlacement(
      request({ position: { x: 40, y: 0, z: 0 }, occupied: [{ x: 40, y: 0, z: 0 }] }),
    );
    expect(refusal).toBe('out_of_range');
  });
});
