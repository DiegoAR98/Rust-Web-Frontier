import { addToInventory } from './stacks.js';
import type { ItemStack, Slot } from './stacks.js';

/** GDD section 12: "Corpses hold 40 slots plus a noninteractive overflow manifest". */
export const CORPSE_SLOTS = 40;

export interface CorpseInventory {
  /** Always CORPSE_SLOTS long. These are the slots a looter can interact with. */
  slots: Slot[];
  /**
   * What did not fit. A looter cannot touch this directly; it pages into the
   * slots as they empty, which is what stops a death from destroying items
   * the player was legitimately carrying.
   */
  overflow: ItemStack[];
}

function fill(slots: Slot[], stacks: ItemStack[], stackLimitOf: (definitionId: string) => number) {
  let next = slots;
  const overflow: ItemStack[] = [];
  for (const stack of stacks) {
    const limit = stackLimitOf(stack.definitionId);
    const result = addToInventory(next, stack.definitionId, stack.quantity, limit);
    next = result.slots;
    if (result.overflow > 0) {
      overflow.push({ definitionId: stack.definitionId, quantity: result.overflow });
    }
  }
  return { slots: next, overflow };
}

/**
 * Builds the one corpse inventory that death moves a player's belongings
 * into (GDD section 12). Sources arrive as separate stacks -- the backpack's
 * slots and the refunded craft escrow are not the same list -- and are merged
 * here so two sources of the same item do not waste a slot each.
 */
export function buildCorpse(
  stacks: ItemStack[],
  stackLimitOf: (definitionId: string) => number,
): CorpseInventory {
  const empty: Slot[] = new Array(CORPSE_SLOTS).fill(null);
  return fill(empty, stacks, stackLimitOf);
}

/**
 * Moves as much of the manifest into the interactive slots as now fits.
 * Called after a looter removes something; a corpse whose slots are all
 * still full is returned unchanged.
 */
export function pageOverflowIn(
  corpse: CorpseInventory,
  stackLimitOf: (definitionId: string) => number,
): CorpseInventory {
  if (corpse.overflow.length === 0) {
    return corpse;
  }
  const { slots, overflow } = fill(corpse.slots, corpse.overflow, stackLimitOf);
  return { slots, overflow };
}
