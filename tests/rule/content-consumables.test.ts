import { describe, expect, it } from 'vitest';
import { getConsumable } from '@rwf/content';

/**
 * CONTENT section 1's consumable column, and GDD section 6's food-poisoning
 * rule: "Eating raw meat always applies 20 seconds of sickness at 0.5 HP/s,
 * blocks regeneration and gives only 50 calories."
 */
describe('consumables (CONTENT section 1, GDD section 6)', () => {
  it('gives cooked meat the catalog values', () => {
    expect(getConsumable('cooked_meat')).toEqual({
      calories: 400,
      health: 5,
      exposure: 0,
      channelSeconds: 1,
      poisonSeconds: 0,
    });
  });

  it('makes raw meat a bad idea rather than an impossible one', () => {
    const raw = getConsumable('raw_meat')!;
    expect(raw.calories).toBe(50);
    expect(raw.poisonSeconds).toBe(20);
    expect(raw.health).toBe(0);
  });

  it('does not invent effects for things that are not food', () => {
    expect(getConsumable('rock')).toBeUndefined();
    expect(getConsumable('metal')).toBeUndefined();
  });
});
