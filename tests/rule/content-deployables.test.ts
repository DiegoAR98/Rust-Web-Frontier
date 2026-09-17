import { describe, expect, it } from 'vitest';
import { DEPLOYABLES, getDeployable, getItem, getRecipe } from '@rwf/content';

/**
 * CONTENT section 7's deployable table: "small_crate / large_crate / stash |
 * 250 / 500 / 150 | 12 / 30 / 6 slots", and section 2's recipe row
 * "small_crate | wood 40 | 10 | Hand | Default".
 */
describe('deployable catalog (CONTENT section 7)', () => {
  it('resolves the small crate matching CONTENT exactly', () => {
    expect(getDeployable('small_crate')).toEqual({ id: 'small_crate', slots: 12, placedHp: 250 });
  });

  it('returns undefined for something that is not a deployable', () => {
    expect(getDeployable('wood')).toBeUndefined();
  });

  it('gives every deployable a real item to be placed from', () => {
    // A deployable with no item is unobtainable, and an item is what a
    // placement actually consumes.
    for (const deployable of DEPLOYABLES) {
      expect(getItem(deployable.id), `no item for deployable ${deployable.id}`).toBeDefined();
    }
  });

  it('crafts a small crate for CONTENT section 2s forty wood', () => {
    expect(getRecipe('small_crate')).toEqual({
      id: 'small_crate',
      outputId: 'small_crate',
      outputQuantityPerUnit: 1,
      inputs: { wood: 40 },
      durationS: 10,
    });
  });
});
