import { describe, expect, it } from 'vitest';
import { addToInventory, type Slot } from '@rwf/sim';

function emptySlots(count: number): Slot[] {
  return new Array(count).fill(null);
}

describe('addToInventory (GDD section 8)', () => {
  it('places a quantity within one stack limit into a single empty slot', () => {
    const { slots, overflow } = addToInventory(emptySlots(4), 'wood', 100, 250);
    expect(slots[0]).toEqual({ definitionId: 'wood', quantity: 100 });
    expect(overflow).toBe(0);
  });

  it('splits a quantity exceeding one stack across multiple empty slots', () => {
    const { slots, overflow } = addToInventory(emptySlots(4), 'wood', 300, 250);
    expect(slots[0]).toEqual({ definitionId: 'wood', quantity: 250 });
    expect(slots[1]).toEqual({ definitionId: 'wood', quantity: 50 });
    expect(overflow).toBe(0);
  });

  it('tops up an existing partial stack of the same item before opening a new slot', () => {
    const starting: Slot[] = [{ definitionId: 'wood', quantity: 200 }, null, null];
    const { slots, overflow } = addToInventory(starting, 'wood', 40, 250);
    expect(slots[0]).toEqual({ definitionId: 'wood', quantity: 240 });
    expect(slots[1]).toBeNull();
    expect(overflow).toBe(0);
  });

  it('never merges into a stack of a different item even with room to spare', () => {
    const starting: Slot[] = [{ definitionId: 'stone', quantity: 10 }, null];
    const { slots, overflow } = addToInventory(starting, 'wood', 10, 250);
    expect(slots[0]).toEqual({ definitionId: 'stone', quantity: 10 });
    expect(slots[1]).toEqual({ definitionId: 'wood', quantity: 10 });
    expect(overflow).toBe(0);
  });

  it('reports overflow instead of losing items when there is no room, conserving the total', () => {
    const { slots, overflow } = addToInventory(emptySlots(1), 'wood', 300, 250);
    expect(slots[0]).toEqual({ definitionId: 'wood', quantity: 250 });
    expect(overflow).toBe(50);
  });

  it('gives every unit of a non-stacking (durable) item, stack limit 1, its own slot', () => {
    const { slots, overflow } = addToInventory(emptySlots(3), 'stone_hatchet', 2, 1);
    expect(slots[0]).toEqual({ definitionId: 'stone_hatchet', quantity: 1 });
    expect(slots[1]).toEqual({ definitionId: 'stone_hatchet', quantity: 1 });
    expect(overflow).toBe(0);
  });
});
