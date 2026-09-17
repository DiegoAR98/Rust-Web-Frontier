import { describe, expect, it } from 'vitest';
import {
  CELL_SIZE_M,
  MAX_STOREYS,
  STOREY_HEIGHT_M,
  linkedSiteKeys,
  siteKey,
  validatePieceSite,
  worldPositionOf,
  type PieceSite,
} from '@rwf/sim';

/**
 * GDD section 10: "Grid cells are 4 m square and 3 m high with four corner
 * pillars. Foundations anchor to permitted terrain; pillars attach to
 * foundation or supported ceiling corners. Walls, doorways and windows
 * require the two adjacent pillars. Ceilings require four pillars below ...
 * Build height is six storeys."
 */

const foundation = (i = 0, k = 0, storey = 0): PieceSite => ({ form: 'foundation', storey, i, k, axis: null });
const pillar = (i: number, k: number, storey = 0): PieceSite => ({ form: 'pillar', storey, i, k, axis: null });
const wall = (i: number, k: number, axis: 'x' | 'z', storey = 0): PieceSite => ({
  form: 'wall',
  storey,
  i,
  k,
  axis,
});
const ceiling = (i = 0, k = 0, storey = 0): PieceSite => ({ form: 'ceiling', storey, i, k, axis: null });

/** The four corner pillars of cell (0,0). */
const CABIN_PILLARS = [pillar(0, 0), pillar(1, 0), pillar(0, 1), pillar(1, 1)];

function placedSet(...sites: PieceSite[]): Set<string> {
  return new Set(sites.map(siteKey));
}

describe('building support rules (GDD section 10)', () => {
  it('lets a foundation stand on bare ground', () => {
    expect(validatePieceSite(foundation(), placedSet())).toBeNull();
  });

  it('refuses a foundation in the air', () => {
    // "Foundations anchor to permitted terrain" -- the ground is storey 0 and
    // nothing else is terrain.
    expect(validatePieceSite(foundation(0, 0, 1), placedSet())).toBe('unsupported');
  });

  it('refuses a second piece in a site that is already taken', () => {
    expect(validatePieceSite(foundation(), placedSet(foundation()))).toBe('occupied');
  });

  it('refuses anything above the sixth storey', () => {
    const tooHigh: PieceSite = { form: 'pillar', storey: MAX_STOREYS, i: 0, k: 0, axis: null };
    expect(validatePieceSite(tooHigh, placedSet())).toBe('too_high');
  });

  it('hangs a pillar off any corner of a foundation, and nowhere else', () => {
    const placed = placedSet(foundation());
    for (const site of CABIN_PILLARS) {
      expect(validatePieceSite(site, placed), `corner ${site.i},${site.k}`).toBeNull();
    }
    // Two cells away touches nothing.
    expect(validatePieceSite(pillar(3, 3), placed)).toBe('unsupported');
  });

  it('needs both of a wall s pillars, not one', () => {
    const oneCorner = placedSet(foundation(), pillar(0, 0));
    expect(validatePieceSite(wall(0, 0, 'x'), oneCorner)).toBe('unsupported');

    const bothCorners = placedSet(foundation(), pillar(0, 0), pillar(1, 0));
    expect(validatePieceSite(wall(0, 0, 'x'), bothCorners)).toBeNull();
  });

  it('holds a doorway to the same rule as a wall', () => {
    const placed = placedSet(foundation(), pillar(0, 0), pillar(1, 0));
    expect(validatePieceSite({ ...wall(0, 0, 'x'), form: 'doorway' }, placed)).toBeNull();
    expect(validatePieceSite({ ...wall(5, 5, 'x'), form: 'doorway' }, placed)).toBe('unsupported');
  });

  it('refuses a ceiling with three pillars under it', () => {
    const threePillars = placedSet(foundation(), pillar(0, 0), pillar(1, 0), pillar(0, 1));
    expect(validatePieceSite(ceiling(), threePillars)).toBe('unsupported');

    const fourPillars = placedSet(foundation(), ...CABIN_PILLARS);
    expect(validatePieceSite(ceiling(), fourPillars)).toBeNull();
  });

  it('stands a second storey on the ceiling below it, not on thin air', () => {
    const groundFloor = placedSet(foundation(), ...CABIN_PILLARS);
    expect(validatePieceSite(pillar(0, 0, 1), groundFloor)).toBe('unsupported');

    const withCeiling = placedSet(foundation(), ...CABIN_PILLARS, ceiling());
    expect(validatePieceSite(pillar(0, 0, 1), withCeiling)).toBeNull();
  });
});

describe('building site geometry (GDD section 10)', () => {
  it('measures cells at four metres and storeys at three', () => {
    expect(worldPositionOf(foundation(0, 0))).toEqual({ x: CELL_SIZE_M / 2, y: 0, z: CELL_SIZE_M / 2 });
    expect(worldPositionOf(foundation(2, 3))).toEqual({ x: 10, y: 0, z: 14 });
    expect(worldPositionOf(pillar(0, 0, 1)).y).toBe(STOREY_HEIGHT_M);
  });

  it('stands a pillar on the corner, not in the middle of the cell', () => {
    expect(worldPositionOf(pillar(1, 1))).toEqual({ x: CELL_SIZE_M, y: 0, z: CELL_SIZE_M });
  });

  it('puts a wall along the edge it spans', () => {
    expect(worldPositionOf(wall(0, 0, 'x'))).toEqual({ x: 2, y: 1.5, z: 0 });
    expect(worldPositionOf(wall(0, 0, 'z'))).toEqual({ x: 0, y: 1.5, z: 2 });
  });

  it('puts a ceiling at the top of its storey', () => {
    expect(worldPositionOf(ceiling(0, 0))).toEqual({ x: 2, y: STOREY_HEIGHT_M, z: 2 });
  });

  it('gives every distinct site a distinct key', () => {
    const keys = [
      foundation(0, 0),
      ceiling(0, 0),
      pillar(0, 0),
      wall(0, 0, 'x'),
      wall(0, 0, 'z'),
      pillar(0, 0, 1),
    ].map(siteKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * GDD section 10: "Only a building owner or explicit builder can attach to its
 * grid" and "max 1000 pieces in one connected building" both need to know what
 * counts as one building.
 */
describe('what counts as one building (GDD section 10)', () => {
  it('links a piece to whatever holds it up', () => {
    expect(linkedSiteKeys(wall(0, 0, 'x'))).toEqual([siteKey(pillar(0, 0)), siteKey(pillar(1, 0))]);
    expect(linkedSiteKeys(ceiling(0, 0))).toEqual(CABIN_PILLARS.map(siteKey));
  });

  it('links a foundation to the foundations it touches, including at a corner', () => {
    const links = linkedSiteKeys(foundation(1, 1));

    // Its eight neighbours: sharing an edge is 0 m apart, and so is sharing a
    // corner, so both are attachments rather than separate buildings.
    expect(links).toHaveLength(8);
    expect(links).toContain(siteKey(foundation(0, 1)));
    expect(links).toContain(siteKey(foundation(2, 1)));
    expect(links).toContain(siteKey(foundation(0, 0)));
    expect(links).not.toContain(siteKey(foundation(3, 1)));
  });

  it('leaves a foundation one cell away unlinked, which is section 10 s 1 m clearance', () => {
    // Adjacent cells share an edge at 0 m, which a detached foundation may not
    // do. One clear cell between them is 4 m, comfortably past the 1 m rule,
    // so "not adjacent" and "legally detached" are the same test.
    expect(linkedSiteKeys(foundation(0, 0))).not.toContain(siteKey(foundation(2, 0)));
    expect(CELL_SIZE_M).toBeGreaterThanOrEqual(1);
  });
});
