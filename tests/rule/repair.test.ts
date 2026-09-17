import { describe, expect, it } from 'vitest';
import { REPAIR_CHANNEL_S, REPAIR_MAX_HP, repairCost, repairableHp } from '@rwf/sim';

/**
 * GDD section 10: "Hold interact on an owned damaged piece for 2 seconds to
 * restore up to 100 HP, paying ceil(original material cost x restoredHP /
 * maxHP x 0.5) of each resource."
 */
describe('repair cost (GDD section 10)', () => {
  it('charges half the material the restored fraction is worth, rounded up', () => {
    // A wood wall costs 40 and has 1000 HP, so 100 HP is a tenth of it:
    // ceil(40 x 0.1 x 0.5) = 2.
    expect(repairCost({ wood: 40 }, 100, 1000)).toEqual({ wood: 2 });
  });

  it('rounds a fraction of a unit up to a whole one', () => {
    // A foundation costs 60 over 2000 HP: ceil(60 x 0.05 x 0.5) = ceil(1.5).
    expect(repairCost({ wood: 60 }, 100, 2000)).toEqual({ wood: 2 });
  });

  it('charges every resource in the original recipe', () => {
    expect(repairCost({ wood: 50, metal: 10 }, 100, 1000)).toEqual({ wood: 3, metal: 1 });
  });

  it('never charges nothing for a repair that did something', () => {
    // Rounding up is what stops a huge, cheap piece being repaired for free.
    expect(repairCost({ wood: 1 }, 1, 4000)).toEqual({ wood: 1 });
  });

  it('charges nothing at all when nothing was restored', () => {
    expect(repairCost({ wood: 40 }, 0, 1000)).toEqual({});
  });

  it('scales with how much was actually restored, not with the cap', () => {
    const partial = repairCost({ wood: 400 }, 50, 1000);
    const full = repairCost({ wood: 400 }, 100, 1000);
    expect(partial).toEqual({ wood: 10 });
    expect(full).toEqual({ wood: 20 });
  });
});

describe('how much one repair restores (GDD section 10)', () => {
  it('restores up to a hundred at a time', () => {
    expect(repairableHp(500, 1000)).toBe(REPAIR_MAX_HP);
  });

  it('restores only what is missing when that is less', () => {
    expect(repairableHp(960, 1000)).toBe(40);
  });

  it('restores nothing on an undamaged piece', () => {
    expect(repairableHp(1000, 1000)).toBe(0);
  });

  it('holds interact for the two seconds the rule states', () => {
    expect(REPAIR_CHANNEL_S).toBe(2);
  });
});
