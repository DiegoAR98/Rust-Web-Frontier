export interface RecipeDefinition {
  /**
   * The recipe's own identity, which is what the protocol's `recipeId` names.
   * Distinct from outputId because two recipes may produce the same item --
   * a bench variant with a shorter durationS, say -- and keying lookup on the
   * output would make the second one permanently unreachable.
   */
  id: string;
  outputId: string;
  outputQuantityPerUnit: number;
  inputs: Record<string, number>;
  durationS: number;
}

// Transcribed from CONTENT.md section 2, added as each vertical makes a
// recipe reachable rather than all at once.
export const RECIPES: RecipeDefinition[] = [
  {
    id: 'stone_hatchet',
    outputId: 'stone_hatchet',
    outputQuantityPerUnit: 1,
    inputs: { wood: 15, stone: 10 },
    durationS: 10,
  },
  {
    id: 'small_crate',
    outputId: 'small_crate',
    outputQuantityPerUnit: 1,
    inputs: { wood: 40 },
    durationS: 10,
  },
];

export function getRecipe(recipeId: string): RecipeDefinition | undefined {
  return RECIPES.find((recipe) => recipe.id === recipeId);
}
