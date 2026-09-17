import { describe, expect, it } from 'vitest';
import { CALORIE_SPAWN, computeStarvationDamage, drainCalories } from '@rwf/sim';

describe('drainCalories (T05)', () => {
  it('drains 0.25/s while walking: 1200 calories for 60s -> 1185', () => {
    expect(drainCalories(CALORIE_SPAWN, 60, false)).toBeCloseTo(1185, 5);
  });

  it('drains 0.75/s while sprinting: 1185 calories for 60s -> 1140', () => {
    expect(drainCalories(1185, 60, true)).toBeCloseTo(1140, 5);
  });

  it('never drains below zero', () => {
    expect(drainCalories(5, 60, true)).toBe(0);
  });
});

describe('computeStarvationDamage (T05)', () => {
  it('deals 0.5 HP/s at exactly zero calories', () => {
    expect(computeStarvationDamage(0, 1)).toBeCloseTo(0.5, 5);
  });

  it('deals no damage above zero calories', () => {
    expect(computeStarvationDamage(0.01, 1)).toBe(0);
    expect(computeStarvationDamage(1200, 1)).toBe(0);
  });
});
