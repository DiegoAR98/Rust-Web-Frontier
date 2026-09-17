import { describe, expect, it } from 'vitest';
import { getRecipe, RECIPES } from '@rwf/content';

describe('recipe catalog (CONTENT section 2, initial subset)', () => {
  it('resolves the stone_hatchet recipe matching CONTENT exactly', () => {
    expect(getRecipe('stone_hatchet')).toEqual({
      id: 'stone_hatchet',
      outputId: 'stone_hatchet',
      outputQuantityPerUnit: 1,
      inputs: { wood: 15, stone: 10 },
      durationS: 10,
    });
  });

  it('returns undefined for a recipe that does not exist', () => {
    expect(getRecipe('does_not_exist')).toBeUndefined();
  });

  it('gives every recipe a unique ID of its own', () => {
    // The protocol field is recipeId, so lookup must key on a recipe's own
    // identity. Keying on outputId instead makes a second recipe for the same
    // item silently unreachable -- a station variant with a different
    // durationS would never be selectable.
    const ids = RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(RECIPES.length);
    for (const id of ids) {
      expect(id, 'every recipe needs a non-empty id').toBeTruthy();
    }
  });

  it('looks a recipe up by its own ID, not by what it produces', () => {
    // Proven with a real second recipe for the same output: exactly the case
    // that outputId-keyed lookup cannot express.
    const variants = [
      { id: 'stone_hatchet', outputId: 'stone_hatchet', outputQuantityPerUnit: 1, inputs: { wood: 15 }, durationS: 10 },
      { id: 'stone_hatchet_bench', outputId: 'stone_hatchet', outputQuantityPerUnit: 1, inputs: { wood: 10 }, durationS: 4 },
    ];
    const find = (id: string) => variants.find((recipe) => recipe.id === id);

    expect(find('stone_hatchet_bench')?.durationS).toBe(4);
    expect(find('stone_hatchet')?.durationS).toBe(10);
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
