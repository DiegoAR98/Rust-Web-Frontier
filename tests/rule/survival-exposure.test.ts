import { describe, expect, it } from 'vitest';
import {
  EXPOSURE_ZONE_RATES,
  computeExposureDamage,
  computeExposureIntake,
  decayExposure,
} from '@rwf/sim';

describe('computeExposureIntake (T06)', () => {
  it('accumulates 500 exposure after 100s unprotected in a medium zone', () => {
    expect(computeExposureIntake(EXPOSURE_ZONE_RATES.medium, 0, 100)).toBeCloseTo(500, 5);
  });

  it('reaches 500 exposure only after 1000s wearing a full mining set (90% protection)', () => {
    expect(computeExposureIntake(EXPOSURE_ZONE_RATES.medium, 0.9, 1000)).toBeCloseTo(500, 5);
  });

  it('caps protection at 90% even if worn gear would imply more', () => {
    const capped = computeExposureIntake(EXPOSURE_ZONE_RATES.medium, 0.95, 100);
    const atCap = computeExposureIntake(EXPOSURE_ZONE_RATES.medium, 0.9, 100);
    expect(capped).toBeCloseTo(atCap, 5);
  });
});

describe('computeExposureDamage (T06)', () => {
  it('deals no damage at or below the 500 sickness threshold', () => {
    expect(computeExposureDamage(500)).toBe(0);
    expect(computeExposureDamage(200)).toBe(0);
  });

  it('deals 1 HP/s at 1000 exposure', () => {
    expect(computeExposureDamage(1000)).toBeCloseTo(1, 5);
  });

  it('caps damage at 5 HP/s', () => {
    expect(computeExposureDamage(10000)).toBe(5);
  });
});

describe('decayExposure', () => {
  it('falls at 2/s once outside all positive-dose zones', () => {
    expect(decayExposure(500, 100)).toBeCloseTo(300, 5);
  });

  it('never decays below zero', () => {
    expect(decayExposure(10, 100)).toBe(0);
  });
});
