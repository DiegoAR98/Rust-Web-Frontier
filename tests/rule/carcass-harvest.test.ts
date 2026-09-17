import { describe, expect, it } from 'vitest';
import { harvestCarcassHit, harvestPortion, type CarcassState } from '@rwf/sim';

describe('harvestPortion', () => {
  it('splits an evenly divisible total into four equal quarters', () => {
    expect(harvestPortion(8, 1)).toBe(2);
    expect(harvestPortion(8, 2)).toBe(2);
    expect(harvestPortion(8, 3)).toBe(2);
    expect(harvestPortion(8, 4)).toBe(2);
  });

  it('assigns the integer remainder to the fourth hit', () => {
    expect(harvestPortion(9, 1)).toBe(2);
    expect(harvestPortion(9, 2)).toBe(2);
    expect(harvestPortion(9, 3)).toBe(2);
    expect(harvestPortion(9, 4)).toBe(3);
  });

  it('gives a small total entirely to the fourth hit rather than losing it to rounding', () => {
    expect(harvestPortion(2, 1)).toBe(0);
    expect(harvestPortion(2, 2)).toBe(0);
    expect(harvestPortion(2, 3)).toBe(0);
    expect(harvestPortion(2, 4)).toBe(2);
  });
});

describe('harvestCarcassHit (T20 - finite harvest paid once)', () => {
  it('grants one quarter per hit across four hits, summing to the full pool', () => {
    let state: CarcassState = { hitsUsed: 0 };
    let totalGranted = 0;
    for (let i = 0; i < 4; i++) {
      const result = harvestCarcassHit(state, { raw_meat: 9 });
      state = result.state;
      totalGranted += result.granted.raw_meat ?? 0;
    }
    expect(totalGranted).toBe(9);
  });

  it('grants resources for multiple resource types on the same hit cadence', () => {
    const result = harvestCarcassHit({ hitsUsed: 0 }, { raw_meat: 8, cloth: 8, hide: 4 });
    expect(result.granted).toEqual({ raw_meat: 2, cloth: 2, hide: 1 });
  });

  it('grants nothing once four hits have already been paid, so a fifth hit cannot double-pay it', () => {
    let state: CarcassState = { hitsUsed: 0 };
    for (let i = 0; i < 4; i++) {
      state = harvestCarcassHit(state, { raw_meat: 8 }).state;
    }
    const fifthHit = harvestCarcassHit(state, { raw_meat: 8 });
    expect(fifthHit.granted).toEqual({});
    expect(fifthHit.state.hitsUsed).toBe(4);
  });
});
