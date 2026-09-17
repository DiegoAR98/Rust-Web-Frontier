import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M, isReachBlocked, wallSegment, type PieceSite } from '@rwf/sim';

/**
 * T11: "Stranger attempts door operation, socket attachment and box access
 * through wall -> ... through-wall loot denied". GDD section 8 allows anyone
 * who "reaches a box" to open it; a wall is what stops them reaching.
 */

const wall = (i: number, k: number, axis: 'x' | 'z'): PieceSite => ({
  form: 'wall',
  storey: 0,
  i,
  k,
  axis,
});

describe('wall segments (GDD section 10)', () => {
  it('runs an x-axis wall along the cell edge it spans', () => {
    expect(wallSegment(wall(0, 0, 'x'))).toEqual({ x1: 0, z1: 0, x2: CELL_SIZE_M, z2: 0 });
  });

  it('runs a z-axis wall the other way', () => {
    expect(wallSegment(wall(0, 0, 'z'))).toEqual({ x1: 0, z1: 0, x2: 0, z2: CELL_SIZE_M });
  });
});

describe('reaching past a wall (T11)', () => {
  const southWall = wallSegment(wall(0, 0, 'x')); // along z = 0, from x 0 to 4

  it('lets a player reach something with nothing in the way', () => {
    expect(isReachBlocked({ x: 2, z: 1 }, { x: 2, z: 3 }, [southWall])).toBe(false);
  });

  it('stops a player reaching straight through a wall', () => {
    expect(isReachBlocked({ x: 2, z: -1 }, { x: 2, z: 1 }, [southWall])).toBe(true);
  });

  it('lets them reach round the end of it', () => {
    // Both points are past x = 4, where the wall stops.
    expect(isReachBlocked({ x: 6, z: -1 }, { x: 6, z: 1 }, [southWall])).toBe(false);
  });

  it('does not block a reach that runs alongside the wall', () => {
    expect(isReachBlocked({ x: 1, z: -1 }, { x: 3, z: -1 }, [southWall])).toBe(false);
  });

  it('blocks a diagonal reach that still crosses it', () => {
    expect(isReachBlocked({ x: 0.5, z: -1 }, { x: 3.5, z: 1 }, [southWall])).toBe(true);
  });

  it('is blocked by whichever barrier is in the way, not just the first', () => {
    const westWall = wallSegment(wall(0, 0, 'z')); // along x = 0
    expect(isReachBlocked({ x: -1, z: 2 }, { x: 1, z: 2 }, [southWall, westWall])).toBe(true);
  });

  it('treats an empty barrier list as open ground', () => {
    expect(isReachBlocked({ x: 0, z: 0 }, { x: 100, z: 100 }, [])).toBe(false);
  });

  it('does not block a player already standing in the doorway line', () => {
    // Standing exactly on the wall's line but past its end: touching the
    // infinite line is not crossing the wall.
    expect(isReachBlocked({ x: 5, z: 0 }, { x: 5, z: 2 }, [southWall])).toBe(false);
  });
});
