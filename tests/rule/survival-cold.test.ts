import { describe, expect, it } from 'vitest';
import {
  coldBlocksRegeneration,
  computeColdCalorieDrainPerS,
  computeColdDamagePerS,
  computeColdDeficit,
} from '@rwf/sim';

describe('computeColdDeficit', () => {
  it('is pressure minus warmth', () => {
    expect(computeColdDeficit(20, 0)).toBe(20);
  });

  it('never goes negative when warmth exceeds pressure', () => {
    expect(computeColdDeficit(20, 20)).toBe(0);
    expect(computeColdDeficit(20, 40)).toBe(0);
  });
});

describe('cold penalties (T07)', () => {
  it('a naked player in a lowland night (deficit 20) blocks regeneration and adds 0.25 cal/s', () => {
    const deficit = computeColdDeficit(20, 0);
    expect(computeColdCalorieDrainPerS(deficit)).toBeCloseTo(0.25, 5);
    expect(coldBlocksRegeneration(deficit)).toBe(true);
  });

  it('a full cloth set (20 warmth) removes the cold penalty entirely', () => {
    const deficit = computeColdDeficit(20, 20);
    expect(computeColdCalorieDrainPerS(deficit)).toBe(0);
    expect(coldBlocksRegeneration(deficit)).toBe(false);
    expect(computeColdDamagePerS(deficit)).toBe(0);
  });

  it('deals 0.25 HP/s only once deficit reaches 40', () => {
    expect(computeColdDamagePerS(39)).toBe(0);
    expect(computeColdDamagePerS(40)).toBeCloseTo(0.25, 5);
  });

  it('drain rate steps at the 1/20/40 deficit boundaries', () => {
    expect(computeColdCalorieDrainPerS(0)).toBe(0);
    expect(computeColdCalorieDrainPerS(1)).toBeCloseTo(0.1, 5);
    expect(computeColdCalorieDrainPerS(19)).toBeCloseTo(0.1, 5);
    expect(computeColdCalorieDrainPerS(20)).toBeCloseTo(0.25, 5);
    expect(computeColdCalorieDrainPerS(39)).toBeCloseTo(0.25, 5);
    expect(computeColdCalorieDrainPerS(40)).toBeCloseTo(0.5, 5);
  });
});
