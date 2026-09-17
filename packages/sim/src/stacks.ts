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
