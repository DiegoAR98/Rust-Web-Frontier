import { describe, expect, it } from 'vitest';
import { stepConversion, type ConversionState } from '@rwf/sim';

function state(overrides: Partial<ConversionState> = {}): ConversionState {
  return { inputRemaining: 0, outputCapacityRemaining: Infinity, progressS: 0, producedOutput: 0, ...overrides };
}

describe('stepConversion (T09)', () => {
  it('converts one furnace ore slot: 12 ore every 5s -> 24 metal (2 per ore) in 60s', () => {
    const result = stepConversion(state({ inputRemaining: 12 }), 5, 2, 60);
    expect(result.producedOutput).toBe(24);
    expect(result.inputRemaining).toBe(0);
  });

  it('two ore slots together produce the CONTENT worked example: 48 metal in 60s', () => {
    const slotA = stepConversion(state({ inputRemaining: 12 }), 5, 2, 60);
    const slotB = stepConversion(state({ inputRemaining: 12 }), 5, 2, 60);
    expect(slotA.producedOutput + slotB.producedOutput).toBe(48);
  });

  it('the shared fuel cycle converts 12 wood every 5s -> 12 charcoal in 60s, consuming all fuel', () => {
    const fuel = stepConversion(state({ inputRemaining: 12 }), 5, 1, 60);
    expect(fuel.producedOutput).toBe(12);
    expect(fuel.inputRemaining).toBe(0);
  });

  it('a fully blocked output pauses the whole cycle: no consumption, and no time banked toward the next one', () => {
    const result = stepConversion(state({ inputRemaining: 12, outputCapacityRemaining: 0 }), 5, 2, 60);
    expect(result.producedOutput).toBe(0);
    expect(result.inputRemaining).toBe(12);
    expect(result.progressS).toBe(0);
  });

  it('stops converting once input runs out, even with time and output capacity remaining', () => {
    const result = stepConversion(state({ inputRemaining: 2 }), 5, 2, 60);
    expect(result.inputRemaining).toBe(0);
    expect(result.producedOutput).toBe(4);
  });

  it('never converts a fraction of a cycle: partial progress carries over instead of producing early', () => {
    const result = stepConversion(state({ inputRemaining: 12 }), 5, 2, 7);
    expect(result.producedOutput).toBe(2); // one full 5s cycle only
    expect(result.progressS).toBeCloseTo(2, 5); // 2s carried into the next cycle
  });
});
