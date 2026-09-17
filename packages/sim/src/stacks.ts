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
