import { describe, expect, it } from 'vitest';
import { BUILDING_PIECES, getBuildingPiece, getItem, getRecipe, RECIPES } from '@rwf/content';

/**
 * CONTENT section 7: "| foundation | wood 60 / 15 s / 2000 | ... | pillar |
 * wood 15 / 5 s / 1000 | ... | wall | wood 40 / 10 s / 1000 | ... | doorway |
 * wood 40 / 10 s / 1000 | ... | ceiling | wood 50 / 15 s / 1000 |", and
 * section 2's "| wood_door | wood 30 | 10 | Hand | Default |".
 */
describe('building piece catalog (CONTENT section 7)', () => {
  it('resolves the wood foundation matching CONTENT exactly', () => {
    expect(getBuildingPiece('wood_foundation')).toEqual({
      id: 'wood_foundation',
      form: 'foundation',
      placedHp: 2000,
      combatImmune: true,
    });
  });

  it('marks foundations and pillars combat immune, and nothing else', () => {
    // CONTENT section 7's "Combat immune; decays" column, which GDD section 10
    // calls intentional: "Foundation and pillar combat immunity is
    // intentional. Other pieces can be damaged, including ceilings".
    const immune = BUILDING_PIECES.filter((piece) => piece.combatImmune).map((piece) => piece.form);
    expect(new Set(immune)).toEqual(new Set(['foundation', 'pillar']));
  });

  it('gives every building piece a real item and a recipe', () => {
    for (const piece of BUILDING_PIECES) {
      expect(getItem(piece.id), `no item for ${piece.id}`).toBeDefined();
      expect(getRecipe(piece.id), `no recipe for ${piece.id}`).toBeDefined();
    }
  });

  it('costs exactly 360 wood to build CONTENT s 1x1 cabin', () => {
    // CONTENT section 7: "One closed 1x1 wood cabin uses foundation 1,
    // pillars 4, walls 3, doorway 1, ceiling 1 and wood door 1: 360 wood".
    // Summed from the recipe table rather than asserted as a bare 360, so a
    // typo in any one row fails here rather than passing 360 === 360.
    const cabin: Array<[string, number]> = [
      ['wood_foundation', 1],
      ['wood_pillar', 4],
      ['wood_wall', 3],
      ['wood_doorway', 1],
      ['wood_ceiling', 1],
      ['wood_door', 1],
    ];

    let wood = 0;
    for (const [recipeId, count] of cabin) {
      const recipe = getRecipe(recipeId);
      expect(recipe, `no recipe for ${recipeId}`).toBeDefined();
      // Every piece in the cabin is wood-only; a metal input here would mean
      // the tier got mixed up.
      expect(Object.keys(recipe!.inputs)).toEqual(['wood']);
      wood += recipe!.inputs.wood! * count;
    }

    expect(wood).toBe(360);
  });

  it('keeps every recipe id unique after the building rows arrived', () => {
    const ids = RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(RECIPES.length);
  });
});
