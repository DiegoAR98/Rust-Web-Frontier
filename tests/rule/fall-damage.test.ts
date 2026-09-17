import { describe, expect, it } from 'vitest';
import { computeFallDamage } from '@rwf/sim';

describe('computeFallDamage', () => {
  it('deals no damage above the -10 m/s threshold', () => {
    expect(computeFallDamage(-9.99)).toBe(0);
    expect(computeFallDamage(0)).toBe(0);
  });

  it('scales linearly with impact speed past the threshold', () => {
    expect(computeFallDamage(-15)).toBeCloseTo(8 * (15 - 10), 5);
  });

  it('caps damage at 100', () => {
    expect(computeFallDamage(-50)).toBe(100);
  });
});
