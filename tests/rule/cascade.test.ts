import { describe, expect, it } from 'vitest';
import { cascadeRemoval, isSupported, siteKey, type PieceSite } from '@rwf/sim';

/**
 * GDD section 10: "Removing a support by decay or allowed demolition cascades
 * removal to dependents in a deterministic order and spills container contents
 * once. No floating loot-bearing rooms, duplication or infinite support
 * cycles."
 */

const foundation = (i = 0, k = 0): PieceSite => ({ form: 'foundation', storey: 0, i, k, axis: null });
const pillar = (i: number, k: number, storey = 0): PieceSite => ({ form: 'pillar', storey, i, k, axis: null });
const wall = (i: number, k: number, axis: 'x' | 'z', storey = 0): PieceSite => ({ form: 'wall', storey, i, k, axis });
const ceiling = (i = 0, k = 0, storey = 0): PieceSite => ({ form: 'ceiling', storey, i, k, axis: null });

function world(...sites: PieceSite[]): Map<string, PieceSite> {
  return new Map(sites.map((site) => [siteKey(site), site]));
}

/** A closed 1x1 cabin: foundation, four pillars, three walls, a ceiling. */
const CABIN = [
  foundation(),
  pillar(0, 0),
  pillar(1, 0),
  pillar(0, 1),
  pillar(1, 1),
  wall(0, 0, 'x'),
  wall(0, 0, 'z'),
  wall(1, 0, 'z'),
  ceiling(),
];

describe('support after the fact (GDD section 10)', () => {
  it('says a standing piece is supported', () => {
    const placed = world(...CABIN);
    for (const site of CABIN) {
      expect(isSupported(site, new Set(placed.keys())), siteKey(site)).toBe(true);
    }
  });

  it('does not confuse being present with being supported', () => {
    // validatePieceSite refuses an occupied site; this asks a different
    // question -- whether what is already there still has anything holding
    // it up -- and a cascade needs the second one.
    const orphan = world(wall(0, 0, 'x'));
    expect(isSupported(wall(0, 0, 'x'), new Set(orphan.keys()))).toBe(false);
  });
});

describe('cascading a removal (GDD section 10)', () => {
  it('takes the wall down with the pillar it hung on', () => {
    const placed = world(...CABIN);

    const fallen = cascadeRemoval(siteKey(pillar(0, 0)), placed);

    // The pillar itself, plus the two walls that needed it and nothing else.
    expect(fallen).toContain(siteKey(pillar(0, 0)));
    expect(fallen).toContain(siteKey(wall(0, 0, 'x')));
    expect(fallen).toContain(siteKey(wall(0, 0, 'z')));
    expect(fallen).toContain(siteKey(ceiling()));
    // The far wall still has both its pillars.
    expect(fallen).not.toContain(siteKey(wall(1, 0, 'z')));
    expect(fallen).not.toContain(siteKey(foundation()));
  });

  it('brings the whole cabin down with its foundation', () => {
    const placed = world(...CABIN);

    const fallen = cascadeRemoval(siteKey(foundation()), placed);

    expect(new Set(fallen)).toEqual(new Set(CABIN.map(siteKey)));
  });

  it('takes a storey down with the ceiling it stood on', () => {
    const upstairs = [...CABIN, pillar(0, 0, 1), wall(0, 0, 'x', 1)];
    const placed = world(...upstairs);

    const fallen = cascadeRemoval(siteKey(ceiling()), placed);

    expect(fallen).toContain(siteKey(pillar(0, 0, 1)));
    expect(fallen).toContain(siteKey(wall(0, 0, 'x', 1)));
  });

  it('removes a support before whatever it was holding up', () => {
    // "a deterministic order": a client replaying the list must never see a
    // wall outlive its own pillar.
    const placed = world(...CABIN);

    const fallen = cascadeRemoval(siteKey(pillar(0, 0)), placed);

    expect(fallen.indexOf(siteKey(pillar(0, 0)))).toBeLessThan(fallen.indexOf(siteKey(wall(0, 0, 'x'))));
    expect(fallen.indexOf(siteKey(pillar(0, 0)))).toBeLessThan(fallen.indexOf(siteKey(ceiling())));
  });

  it('gives the same answer every time, whatever order the pieces went up in', () => {
    const forwards = cascadeRemoval(siteKey(pillar(0, 0)), world(...CABIN));
    const backwards = cascadeRemoval(siteKey(pillar(0, 0)), world(...[...CABIN].reverse()));

    expect(backwards).toEqual(forwards);
  });

  it('removes nothing at all for a site that was never there', () => {
    expect(cascadeRemoval(siteKey(pillar(9, 9)), world(...CABIN))).toEqual([]);
  });

  it('leaves a neighbouring building standing', () => {
    // Two cells apart: not adjacent, so nothing links them.
    const placed = world(...CABIN, foundation(3, 0), pillar(3, 0));

    const fallen = cascadeRemoval(siteKey(foundation()), placed);

    expect(fallen).not.toContain(siteKey(foundation(3, 0)));
    expect(fallen).not.toContain(siteKey(pillar(3, 0)));
  });
});
