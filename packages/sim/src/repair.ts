/**
 * GDD section 10: "Hold interact on an owned damaged piece for 2 seconds to
 * restore up to 100 HP, paying ceil(original material cost x restoredHP /
 * maxHP x 0.5) of each resource."
 */
export const REPAIR_CHANNEL_S = 2;
export const REPAIR_MAX_HP = 100;

/** How much one repair puts back: the cap, or whatever is missing if that is less. */
export function repairableHp(health: number, maxHealth: number): number {
  return Math.max(0, Math.min(REPAIR_MAX_HP, maxHealth - health));
}

/**
 * What that repair costs, from the piece's own recipe. Rounded up per
 * resource, which is what stops a huge cheap piece being topped up for
 * nothing; a repair that restored nothing costs nothing.
 */
export function repairCost(
  inputs: Record<string, number>,
  restoredHp: number,
  maxHealth: number,
): Record<string, number> {
  const cost: Record<string, number> = {};
  if (restoredHp <= 0 || maxHealth <= 0) return cost;
  for (const [definitionId, quantity] of Object.entries(inputs)) {
    cost[definitionId] = Math.ceil((quantity * restoredHp * 0.5) / maxHealth);
  }
  return cost;
}
