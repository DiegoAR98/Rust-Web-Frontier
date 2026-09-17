/**
 * What eating something does. Values come from CONTENT section 1's item table
 * ("cooked_meat ... +400 calories, +5 health") and GDD section 6's food
 * poisoning rule ("eating raw meat always applies 20 seconds of sickness at
 * 0.5 HP/s, blocks regeneration and gives only 50 calories").
 *
 * Channel lengths are GDD section 6's: "food/water/cleanser 1 second".
 *
 * Only what a player can actually obtain is listed. Beans, rations, water and
 * cleanser are loot-only in CONTENT section 12 and there is no loot yet, so
 * inventing rows for them would be data nobody can reach.
 */
export interface ConsumableEffect {
  calories: number;
  health: number;
  exposure: number;
  channelSeconds: number;
  /** Seconds of food-poisoning sickness this applies; refreshed, never stacked. */
  poisonSeconds: number;
}

const CONSUMABLES: Record<string, ConsumableEffect> = {
  cooked_meat: { calories: 400, health: 5, exposure: 0, channelSeconds: 1, poisonSeconds: 0 },
  raw_meat: { calories: 50, health: 0, exposure: 0, channelSeconds: 1, poisonSeconds: 20 },
};

export function getConsumable(definitionId: string): ConsumableEffect | undefined {
  return CONSUMABLES[definitionId];
}
