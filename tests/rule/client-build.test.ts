import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '@rwf/sim';
import { snapToSite } from '@rwf/client/build';

/**
 * Turning where the player is looking into the grid site they meant. GDD
 * section 10 snaps every structural piece, so the client's job is to pick the
 * site, not a position -- the server is told the site directly.
 */
describe('snapping a build ghost to its site', () => {
  it('drops a foundation in the cell the player is aiming at', () => {
    expect(snapToSite('foundation', { x: 1, z: 3 })).toEqual({
      form: 'foundation',
      storey: 0,
      i: 0,
      k: 0,
      axis: null,
    });
    expect(snapToSite('foundation', { x: 9, z: 5 })).toMatchObject({ i: 2, k: 1 });
  });

  it('handles negative ground without folding two cells into one', () => {
    // Truncating toward zero would make cells -1..1 all cell 0, and a base
    // built west of the origin would fight itself.
    expect(snapToSite('foundation', { x: -1, z: -1 })).toMatchObject({ i: -1, k: -1 });
    expect(snapToSite('foundation', { x: -5, z: -5 })).toMatchObject({ i: -2, k: -2 });
  });

  it('snaps a pillar to the nearest corner, not the containing cell', () => {
    expect(snapToSite('pillar', { x: 0.5, z: 0.5 })).toMatchObject({ i: 0, k: 0 });
    // Past the middle of the cell, the far corner is nearer.
    expect(snapToSite('pillar', { x: 3.5, z: 3.5 })).toMatchObject({ i: 1, k: 1 });
  });

  it('snaps a ceiling to the cell the same way a foundation does', () => {
    expect(snapToSite('ceiling', { x: 5, z: 5 })).toMatchObject({ form: 'ceiling', i: 1, k: 1 });
  });

  it('picks the edge the player is standing nearest', () => {
    // Just inside cell (0,0) against its z = 0 side.
    expect(snapToSite('wall', { x: 2, z: 0.2 })).toEqual({ form: 'wall', storey: 0, i: 0, k: 0, axis: 'x' });
    // ...and against its far side, which is the x-edge of the next row.
    expect(snapToSite('wall', { x: 2, z: 3.8 })).toMatchObject({ i: 0, k: 1, axis: 'x' });
    // Against the x = 0 side.
    expect(snapToSite('wall', { x: 0.2, z: 2 })).toMatchObject({ i: 0, k: 0, axis: 'z' });
    // ...and the far one.
    expect(snapToSite('wall', { x: 3.8, z: 2 })).toMatchObject({ i: 1, k: 0, axis: 'z' });
  });

  it('gives a doorway the same edges as a wall', () => {
    const wall = snapToSite('wall', { x: 2, z: 0.2 });
    const doorway = snapToSite('doorway', { x: 2, z: 0.2 });
    expect({ ...doorway, form: 'wall' }).toEqual(wall);
  });

  it('keeps every site on the four-metre lattice', () => {
    for (const x of [0.1, 3.9, 7.5, -2.2, 13.3]) {
      const site = snapToSite('foundation', { x, z: x });
      expect(Number.isInteger(site.i)).toBe(true);
      expect(site.i * CELL_SIZE_M).toBeLessThanOrEqual(x);
    }
  });
});
