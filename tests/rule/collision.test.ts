import { describe, expect, it } from 'vitest';
import { resolveMove, wallSegment, type GroundSegment, type PieceSite } from '@rwf/sim';

const wall = (i: number, k: number, axis: 'x' | 'z'): GroundSegment =>
  wallSegment({ form: 'wall', storey: 0, i, k, axis } as PieceSite);

/** The four walls of cell (0,0): a sealed 4 m room with no door in it. */
const SEALED_CELL: GroundSegment[] = [
  wall(0, 0, 'x'),
  wall(0, 1, 'x'),
  wall(0, 0, 'z'),
  wall(1, 0, 'z'),
];

/**
 * GDD section 5: "All collision meshes are shared in meaning between client
 * prediction and server simulation." A wall a player can walk through is not a
 * wall, and every rule M2 built on top of one -- door permissions, the broken
 * socket lockout, the cost of a satchel -- is bypassed by walking around it.
 */
describe('walking into a wall (GDD section 5)', () => {
  it('lets a player walk where nothing is in the way', () => {
    expect(resolveMove({ x: 1, z: 1 }, { x: 1.2, z: 1.3 }, [])).toEqual({ x: 1.2, z: 1.3 });
  });

  it('stops a player walking straight into a wall', () => {
    // Standing south of the wall on cell (0,0)'s south edge, walking north.
    const from = { x: 2, z: -0.5 };
    expect(resolveMove(from, { x: 2, z: 0.5 }, [wall(0, 0, 'x')])).toEqual(from);
  });

  it('slides a player along the wall they walked into at an angle', () => {
    // The whole point of the angle: hugging a wall has to keep working, or
    // every base is surrounded by a strip of ground that stops you dead.
    const moved = resolveMove({ x: 2, z: -0.5 }, { x: 2.4, z: 0.5 }, [wall(0, 0, 'x')]);
    expect(moved).toEqual({ x: 2.4, z: -0.5 });
  });

  it('lets a player walk through the gap between two walls', () => {
    // What an open door is, as far as movement is concerned: the caller simply
    // leaves it out of the barrier list.
    const barriers = [wall(0, 0, 'x'), wall(2, 0, 'x')];
    expect(resolveMove({ x: 6, z: -0.5 }, { x: 6, z: 0.5 }, barriers)).toEqual({ x: 6, z: 0.5 });
  });

  it('keeps a player sealed inside a room with no way out', () => {
    // Diagonally at the corner, where an axis-at-a-time slide would otherwise
    // leak a player out through the join.
    expect(resolveMove({ x: 1, z: 1 }, { x: -0.5, z: -1.5 }, SEALED_CELL)).toEqual({ x: 1, z: 1 });
  });

  it('never traps a player standing on a wall line', () => {
    // A wall raised on top of someone must not weld them in place; standing on
    // the line, both sides are still a step away.
    const barriers = [wall(0, 0, 'x')];
    expect(resolveMove({ x: 2, z: 0 }, { x: 2, z: -1 }, barriers)).toEqual({ x: 2, z: -1 });
    expect(resolveMove({ x: 2, z: 0 }, { x: 2, z: 1 }, barriers)).toEqual({ x: 2, z: 1 });
  });
});
