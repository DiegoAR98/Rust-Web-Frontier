import { describe, expect, it } from 'vitest';
import { getRecipe, RECIPES } from '@rwf/content';

describe('recipe catalog (CONTENT section 2, initial subset)', () => {
  it('resolves the stone_hatchet recipe matching CONTENT exactly', () => {
    expect(getRecipe('stone_hatchet')).toEqual({
      outputId: 'stone_hatchet',
      outputQuantityPerUnit: 1,
      inputs: { wood: 15, stone: 10 },
      durationS: 10,
    });
  });

  it('returns undefined for a recipe that does not exist', () => {
    expect(getRecipe('does_not_exist')).toBeUndefined();
  });

  it('every recipe input ID resolves to a known item (CONTENT section 10 reject-list)', async () => {
    const { getItem } = await import('@rwf/content');
    for (const recipe of RECIPES) {
      for (const inputId of Object.keys(recipe.inputs)) {
        expect(getItem(inputId), `unknown input ID: ${inputId}`).toBeDefined();
      }
      expect(getItem(recipe.outputId), `unknown output ID: ${recipe.outputId}`).toBeDefined();
    }
  });
});
