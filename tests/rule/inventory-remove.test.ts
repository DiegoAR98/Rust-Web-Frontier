import { describe, expect, it } from 'vitest';
import { countInInventory, removeFromInventory, type Slot } from '@rwf/sim';

describe('removeFromInventory', () => {
  it('removes a quantity from a single stack with enough on hand', () => {
    const slots: Slot[] = [{ definitionId: 'wood', quantity: 100 }];
    const { slots: after, removed } = removeFromInventory(slots, 'wood', 40);
    expect(after[0]).toEqual({ definitionId: 'wood', quantity: 60 });
    expect(removed).toBe(40);
  });

  it('empties a stack to null rather than leaving a zero-quantity stack', () => {
    const slots: Slot[] = [{ definitionId: 'wood', quantity: 40 }];
    const { slots: after } = removeFromInventory(slots, 'wood', 40);
    expect(after[0]).toBeNull();
  });

  it('draws from multiple stacks of the same item to satisfy the amount', () => {
    const slots: Slot[] = [{ definitionId: 'wood', quantity: 10 }, { definitionId: 'wood', quantity: 10 }];
    const { slots: after, removed } = removeFromInventory(slots, 'wood', 15);
    expect(removed).toBe(15);
    expect(after[0]).toBeNull();
    expect(after[1]).toEqual({ definitionId: 'wood', quantity: 5 });
  });

  it('removes as much as available and reports a short amount instead of going negative', () => {
    const slots: Slot[] = [{ definitionId: 'wood', quantity: 10 }];
    const { slots: after, removed } = removeFromInventory(slots, 'wood', 40);
    expect(removed).toBe(10);
    expect(after[0]).toBeNull();
  });

  it('never touches a stack of a different item', () => {
    const slots: Slot[] = [{ definitionId: 'stone', quantity: 10 }];
    const { slots: after, removed } = removeFromInventory(slots, 'wood', 5);
    expect(removed).toBe(0);
    expect(after[0]).toEqual({ definitionId: 'stone', quantity: 10 });
  });
});

describe('countInInventory', () => {
  it('sums quantity across every stack of one item', () => {
    const slots: Slot[] = [{ definitionId: 'wood', quantity: 10 }, null, { definitionId: 'wood', quantity: 5 }];
    expect(countInInventory(slots, 'wood')).toBe(15);
  });

  it('returns zero for an item with no stacks at all', () => {
    expect(countInInventory([null, null], 'wood')).toBe(0);
  });
});
