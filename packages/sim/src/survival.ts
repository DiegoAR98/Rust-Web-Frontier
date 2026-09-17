// GDD section 6: survival tuning.

export const HEALTH_MAX = 100;
export const HEALTH_SPAWN = 100;
export const CALORIE_MAX = 3000;
export const CALORIE_SPAWN = 1200;
export const EXPOSURE_MAX = 3000;

export const WALK_CALORIE_DRAIN_PER_S = 0.25;
export const SPRINT_CALORIE_DRAIN_PER_S = 0.75;
export const MELEE_SWING_CALORIE_COST = 1;
export const STARVATION_DAMAGE_PER_S = 0.5;

/** Clamps at zero; calories never go negative regardless of drain duration. */
export function drainCalories(current: number, dt: number, sprinting: boolean): number {
  const rate = sprinting ? SPRINT_CALORIE_DRAIN_PER_S : WALK_CALORIE_DRAIN_PER_S;
  return Math.max(0, current - rate * dt);
}

/** No starvation damage above zero calories; at zero, 0.5 HP/s (GDD section 6). */
export function computeStarvationDamage(calories: number, dt: number): number {
  return calories <= 0 ? STARVATION_DAMAGE_PER_S * dt : 0;
}

export const EXPOSURE_ZONE_RATES = { low: 2, medium: 5, high: 10 } as const;
export const EXPOSURE_PROTECTION_CAP = 0.9;
export const EXPOSURE_DECAY_PER_S = 2;
export const EXPOSURE_SICKNESS_THRESHOLD = 500;
export const EXPOSURE_DAMAGE_CAP_PER_S = 5;
export const EXPOSURE_DAMAGE_RATE = 0.002;

/** Effective intake is rate x (1 - totalProtection), capped at 90% protection (GDD section 6). */
export function computeExposureIntake(zoneRate: number, totalProtection: number, dt: number): number {
  const protection = Math.min(EXPOSURE_PROTECTION_CAP, totalProtection);
  return zoneRate * (1 - protection) * dt;
}

/** min(5, max(0, exposure - 500) * 0.002) HP/s (GDD section 6). */
export function computeExposureDamage(exposure: number): number {
  return Math.min(EXPOSURE_DAMAGE_CAP_PER_S, Math.max(0, exposure - EXPOSURE_SICKNESS_THRESHOLD) * EXPOSURE_DAMAGE_RATE);
}

/** After 10s outside all positive-dose zones, exposure falls 2/s (GDD section 6). */
export function decayExposure(exposure: number, dt: number): number {
  return Math.max(0, exposure - EXPOSURE_DECAY_PER_S * dt);
}

/** Environment pressure minus clothing/fire/shelter warmth, floored at zero (GDD section 6). */
export function computeColdDeficit(pressure: number, warmth: number): number {
  return Math.max(0, pressure - warmth);
}

/** Deficit 1-19 adds 0.1 cal/s; 20-39 adds 0.25/s; 40+ adds 0.5/s (GDD section 6). */
export function computeColdCalorieDrainPerS(deficit: number): number {
  if (deficit >= 40) return 0.5;
  if (deficit >= 20) return 0.25;
  if (deficit >= 1) return 0.1;
  return 0;
}

/** Deficit 20+ blocks passive health regeneration (GDD section 6). */
export function coldBlocksRegeneration(deficit: number): boolean {
  return deficit >= 20;
}

/** Deficit 40+ deals 0.25 HP/s (GDD section 6). */
export function computeColdDamagePerS(deficit: number): number {
  return deficit >= 40 ? 0.25 : 0;
}

/**
 * GDD section 6: "Passive regeneration is 0.1 HP/s when calories are at least
 * 800, no damage was received in the previous 10 seconds, and no bleeding,
 * poisoning, exposure sickness or cold deficit of 20+ is active. A nearby
 * campfire raises regeneration to 0.4 HP/s under the same conditions. Each
 * regenerated HP consumes two additional calories."
 */
export const REGEN_CALORIE_THRESHOLD = 800;
export const REGEN_BASE_PER_S = 0.1;
export const REGEN_CAMPFIRE_PER_S = 0.4;
export const REGEN_CALORIE_COST_PER_HP = 2;
export const REGEN_DAMAGE_QUIET_S = 10;

export interface RegenConditions {
  calories: number;
  secondsSinceDamage: number;
  bleeding: boolean;
  poisoned: boolean;
  exposure: number;
  coldDeficit: number;
  nearCampfire: boolean;
}

/** HP per second a player regenerates right now; 0 if anything blocks it. */
export function computeRegenPerS(conditions: RegenConditions): number {
  if (conditions.calories < REGEN_CALORIE_THRESHOLD) return 0;
  if (conditions.secondsSinceDamage < REGEN_DAMAGE_QUIET_S) return 0;
  if (conditions.bleeding || conditions.poisoned) return 0;
  if (conditions.exposure >= EXPOSURE_SICKNESS_THRESHOLD) return 0;
  if (coldBlocksRegeneration(conditions.coldDeficit)) return 0;
  return conditions.nearCampfire ? REGEN_CAMPFIRE_PER_S : REGEN_BASE_PER_S;
}
