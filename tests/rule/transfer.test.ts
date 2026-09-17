import { describe, expect, it } from 'vitest';
import { moveAllThatFits, type Slot } from '@rwf/sim';

/**
 * The move-what-fits rule shared by every "empty that into my pack" action:
 * a furnace's outputs, a corpse's slots and a crate's contents all behave the
 * same way. GDD section 8 is the constraint in all three cases -- what will
 * not fit stays where it was rather than being dropped.
 */

const LIMITS: Record<string, number> = { wood: 250, stone_hatchet: 1 };
const limitOf = (id: string) => LIMITS[id] ?? 1;

const empty = (size: number): Slot[] => new Array(size).fill(null);

describe('moveAllThatFits (GDD section 8)', () => {
  it('moves everything when there is room for it', () => {
    const source: Slot[] = [{ definitionId: 'wood', quantity: 40 }, null, { definitionId: 'wood', quantity: 10 }];

    const result = moveAllThatFits(source, empty(4), limitOf);

    expect(result.moved).toBe(50);
    expect(result.source).toEqual([null, null, null]);
    expect(result.destination.filter((s) => s !== null)).toEqual([{ definitionId: 'wood', quantity: 50 }]);
  });

  it('leaves behind exactly what did not fit', () => {
    const source: Slot[] = [
      { definitionId: 'stone_hatchet', quantity: 1 },
      { definitionId: 'stone_hatchet', quantity: 1 },
      { definitionId: 'stone_hatchet', quantity: 1 },
    ];

    const result = moveAllThatFits(source, empty(2), limitOf);

    expect(result.moved).toBe(2);
    expect(result.destination.filter((s) => s !== null)).toHaveLength(2);
    // The third is still in the source, and still in a slot of its own.
    expect(result.source.filter((s) => s !== null)).toEqual([{ definitionId: 'stone_hatchet', quantity: 1 }]);
  });

  it('splits a partly-fitting stack rather than refusing the whole of it', () => {
    const source: Slot[] = [{ definitionId: 'wood', quantity: 300 }];
    const destination: Slot[] = [{ definitionId: 'wood', quantity: 200 }];

    const result = moveAllThatFits(source, destination, limitOf);

    expect(result.moved).toBe(50);
    expect(result.source).toEqual([{ definitionId: 'wood', quantity: 250 }]);
    expect(result.destination).toEqual([{ definitionId: 'wood', quantity: 250 }]);
  });

  it('moves nothing and changes nothing when the destination is full', () => {
    const source: Slot[] = [{ definitionId: 'wood', quantity: 5 }];
    const destination: Slot[] = [{ definitionId: 'stone_hatchet', quantity: 1 }];

    const result = moveAllThatFits(source, destination, limitOf);

    expect(result.moved).toBe(0);
    expect(result.source).toEqual(source);
    expect(result.destination).toEqual(destination);
  });

  it('keeps the source the same length so its slots stay where they were', () => {
    const source: Slot[] = [null, { definitionId: 'wood', quantity: 5 }, null];

    const result = moveAllThatFits(source, empty(4), limitOf);

    expect(result.source).toHaveLength(3);
  });
});
