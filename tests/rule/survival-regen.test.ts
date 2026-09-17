import { describe, expect, it } from 'vitest';
import {
  computeRegenPerS,
  REGEN_BASE_PER_S,
  REGEN_CALORIE_COST_PER_HP,
  REGEN_CALORIE_THRESHOLD,
  REGEN_CAMPFIRE_PER_S,
  REGEN_DAMAGE_QUIET_S,
  type RegenConditions,
} from '@rwf/sim';

function healthy(overrides: Partial<RegenConditions> = {}): RegenConditions {
  return {
    calories: 1200,
    secondsSinceDamage: 30,
    bleeding: false,
    poisoned: false,
    exposure: 0,
    coldDeficit: 0,
    nearCampfire: false,
    ...overrides,
  };
}

/**
 * GDD section 6: "Passive regeneration is 0.1 HP/s when calories are at least
 * 800, no damage was received in the previous 10 seconds, and no bleeding,
 * poisoning, exposure sickness or cold deficit of 20+ is active. A nearby
 * campfire raises regeneration to 0.4 HP/s under the same conditions. Each
 * regenerated HP consumes two additional calories."
 */
describe('passive regeneration (GDD section 6)', () => {
  it('uses the rates and thresholds GDD states', () => {
    expect(REGEN_BASE_PER_S).toBe(0.1);
    expect(REGEN_CAMPFIRE_PER_S).toBe(0.4);
    expect(REGEN_CALORIE_THRESHOLD).toBe(800);
    expect(REGEN_DAMAGE_QUIET_S).toBe(10);
    expect(REGEN_CALORIE_COST_PER_HP).toBe(2);
  });

  it('heals a fed, unhurt, undisturbed player', () => {
    expect(computeRegenPerS(healthy())).toBe(0.1);
  });

  it('heals faster beside a campfire', () => {
    expect(computeRegenPerS(healthy({ nearCampfire: true }))).toBe(0.4);
  });

  it('stops below the calorie threshold', () => {
    expect(computeRegenPerS(healthy({ calories: 799 }))).toBe(0);
    expect(computeRegenPerS(healthy({ calories: 800 }))).toBe(0.1);
  });

  it('stops for ten seconds after taking damage', () => {
    expect(computeRegenPerS(healthy({ secondsSinceDamage: 9.9 }))).toBe(0);
    expect(computeRegenPerS(healthy({ secondsSinceDamage: 10 }))).toBe(0.1);
  });

  it('stops while bleeding or poisoned', () => {
    expect(computeRegenPerS(healthy({ bleeding: true }))).toBe(0);
    expect(computeRegenPerS(healthy({ poisoned: true }))).toBe(0);
  });

  it('stops at exposure sickness', () => {
    // GDD section 6: "At 500+ exposure regeneration stops".
    expect(computeRegenPerS(healthy({ exposure: 499 }))).toBe(0.1);
    expect(computeRegenPerS(healthy({ exposure: 500 }))).toBe(0);
  });

  it('stops at a cold deficit of 20 or more', () => {
    expect(computeRegenPerS(healthy({ coldDeficit: 19 }))).toBe(0.1);
    expect(computeRegenPerS(healthy({ coldDeficit: 20 }))).toBe(0);
  });

  it('a campfire does not override a blocking condition', () => {
    expect(computeRegenPerS(healthy({ nearCampfire: true, bleeding: true }))).toBe(0);
  });
});
