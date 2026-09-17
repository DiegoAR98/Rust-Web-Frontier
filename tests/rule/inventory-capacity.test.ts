import { describe, expect, it } from 'vitest';
import { countFreeCapacity, addToInventory, type Slot } from '@rwf/sim';

function emptySlots(n = 24): Slot[] {
  return new Array(n).fill(null);
}

/**
 * Callers that mutate the world before adding an item (decrementing a node's
 * budget, completing a craft unit) need to know how much will actually fit
 * BEFORE they commit, or the surplus is destroyed with the cost already paid.
 */
describe('countFreeCapacity', () => {
  it('counts every empty slot at the full stack limit', () => {
    expect(countFreeCapacity(emptySlots(24), 'wood', 250)).toBe(24 * 250);
  });

  it('counts headroom in existing partial stacks of the same item', () => {
    const slots = emptySlots(2);
    slots[0] = { definitionId: 'wood', quantity: 200 };
    // 50 headroom in the partial stack, plus one empty slot at 250.
    expect(countFreeCapacity(slots, 'wood', 250)).toBe(50 + 250);
  });

  it('ignores headroom belonging to a different item', () => {
    const slots = emptySlots(2);
    slots[0] = { definitionId: 'stone', quantity: 10 };
    expect(countFreeCapacity(slots, 'wood', 250)).toBe(250);
  });

  it('returns 0 when every slot is full', () => {
    const slots: Slot[] = new Array(24).fill(null).map(() => ({ definitionId: 'wood', quantity: 250 }));
    expect(countFreeCapacity(slots, 'wood', 250)).toBe(0);
  });

  it('gives unstackable items one unit of capacity per empty slot', () => {
    const slots = emptySlots(24);
    slots[0] = { definitionId: 'stone_hatchet', quantity: 1 };
    // stack:1 means a full slot has no headroom; only the 23 empty ones count.
    expect(countFreeCapacity(slots, 'stone_hatchet', 1)).toBe(23);
  });

  it('agrees with what addToInventory actually accepts', () => {
    // The whole point of the function: capacity must predict overflow exactly.
    const slots = emptySlots(3);
    slots[0] = { definitionId: 'wood', quantity: 240 };
    const capacity = countFreeCapacity(slots, 'wood', 250);

    expect(addToInventory(slots, 'wood', capacity, 250).overflow).toBe(0);
    expect(addToInventory(slots, 'wood', capacity + 1, 250).overflow).toBe(1);
  });
});
