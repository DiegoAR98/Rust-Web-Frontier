export interface ItemStack {
  definitionId: string;
  quantity: number;
}

export type Slot = ItemStack | null;

/**
 * Adds a quantity of one item into a slot array (GDD section 8): tops up
 * existing partial stacks of the same item first, then fills empty slots,
 * splitting across as many stacks of `stackLimit` as needed. Whatever
 * cannot fit is reported as overflow rather than silently discarded --
 * callers route it to a gather bag, refuse the action, or similar, per
 * whichever GDD rule triggered the add.
 */
export function addToInventory(
  slots: Slot[],
  definitionId: string,
  quantity: number,
  stackLimit: number,
): { slots: Slot[]; overflow: number } {
  const next = slots.slice();
  let remaining = quantity;

  if (stackLimit > 1) {
    for (let i = 0; i < next.length && remaining > 0; i++) {
      const slot = next[i];
      if (slot && slot.definitionId === definitionId && slot.quantity < stackLimit) {
        const space = stackLimit - slot.quantity;
        const add = Math.min(space, remaining);
        next[i] = { definitionId, quantity: slot.quantity + add };
        remaining -= add;
      }
    }
  }

  for (let i = 0; i < next.length && remaining > 0; i++) {
    if (next[i] === null) {
      const add = Math.min(stackLimit, remaining);
      next[i] = { definitionId, quantity: add };
      remaining -= add;
    }
  }

  return { slots: next, overflow: remaining };
}

/**
 * Removes a quantity of one item from a slot array, draining across as many
 * stacks of that item as needed. Empties an exhausted stack to `null` rather
 * than leaving a zero-quantity stack behind. Never removes more than is
 * actually present -- `removed` may be less than requested if there wasn't
 * enough; it never goes negative or touches other items' stacks.
 */
export function removeFromInventory(
  slots: Slot[],
  definitionId: string,
  quantity: number,
): { slots: Slot[]; removed: number } {
  const next = slots.slice();
  let remaining = quantity;

  for (let i = 0; i < next.length && remaining > 0; i++) {
    const slot = next[i];
    if (slot && slot.definitionId === definitionId) {
      const take = Math.min(slot.quantity, remaining);
      const leftover = slot.quantity - take;
      next[i] = leftover > 0 ? { definitionId, quantity: leftover } : null;
      remaining -= take;
    }
  }

  return { slots: next, removed: quantity - remaining };
}

/**
 * How much of one item the slot array can still accept: headroom in existing
 * partial stacks plus every empty slot at the full stack limit. Callers that
 * change the world before adding (decrementing a node budget, completing a
 * craft unit) must check this first -- otherwise they pay the cost and
 * addToInventory reports an overflow that has nowhere to go.
 *
 * Exactly predicts addToInventory's overflow: adding this much overflows 0,
 * adding one more overflows 1.
 */
export function countFreeCapacity(slots: Slot[], definitionId: string, stackLimit: number): number {
  let capacity = 0;
  for (const slot of slots) {
    if (slot === null) {
      capacity += stackLimit;
    } else if (slot.definitionId === definitionId && stackLimit > 1) {
      capacity += Math.max(0, stackLimit - slot.quantity);
    }
  }
  return capacity;
}

/**
 * Empties one slot array into another, moving as much as will fit and leaving
 * the rest exactly where it was (GDD section 8). This is the shared rule
 * behind every "take what is in that" action -- a furnace's outputs, a
 * corpse's slots, a crate's contents -- which differ only in what they call
 * the source.
 *
 * The source keeps its length, so its remaining slots stay where they were;
 * callers that care about slot identity (a station's compartments) depend on
 * that.
 */
export function moveAllThatFits(
  source: Slot[],
  destination: Slot[],
  stackLimitOf: (definitionId: string) => number,
): { source: Slot[]; destination: Slot[]; moved: number } {
  const remaining: Slot[] = [];
  let next = destination;
  let moved = 0;

  for (const slot of source) {
    if (!slot) {
      remaining.push(null);
      continue;
    }
    const result = addToInventory(next, slot.definitionId, slot.quantity, stackLimitOf(slot.definitionId));
    next = result.slots;
    moved += slot.quantity - result.overflow;
    remaining.push(result.overflow > 0 ? { definitionId: slot.definitionId, quantity: result.overflow } : null);
  }

  // Nothing moved means nothing should have changed: returning the originals
  // rather than equivalent copies keeps a refused take from looking like a
  // state change to anything watching.
  if (moved === 0) {
    return { source, destination, moved: 0 };
  }
  return { source: remaining, destination: next, moved };
}

/** Sums quantity across every stack of one item. */
export function countInInventory(slots: Slot[], definitionId: string): number {
  let total = 0;
  for (const slot of slots) {
    if (slot && slot.definitionId === definitionId) {
      total += slot.quantity;
    }
  }
  return total;
}
