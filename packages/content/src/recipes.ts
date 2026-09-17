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
  // CONTENT section 7's wood tier: "foundation | wood 60 / 15 s", "pillar |
  // wood 15 / 5 s", "wall | wood 40 / 10 s", "doorway | wood 40 / 10 s",
  // "ceiling | wood 50 / 15 s", plus section 2's "wood_door | wood 30 | 10".
  // These six sum to CONTENT's 360-wood 1x1 cabin.
  // CONTENT section 2: "bedroll | cloth 20 | 15 | Hand | Default".
  {
    id: 'bedroll',
    outputId: 'bedroll',
    outputQuantityPerUnit: 1,
    inputs: { cloth: 20 },
    durationS: 15,
  },
  {
    id: 'wood_foundation',
    outputId: 'wood_foundation',
    outputQuantityPerUnit: 1,
    inputs: { wood: 60 },
    durationS: 15,
  },
  {
    id: 'wood_pillar',
    outputId: 'wood_pillar',
    outputQuantityPerUnit: 1,
    inputs: { wood: 15 },
    durationS: 5,
  },
  {
    id: 'wood_wall',
    outputId: 'wood_wall',
    outputQuantityPerUnit: 1,
    inputs: { wood: 40 },
    durationS: 10,
  },
  {
    id: 'wood_doorway',
    outputId: 'wood_doorway',
    outputQuantityPerUnit: 1,
    inputs: { wood: 40 },
    durationS: 10,
  },
  {
    id: 'wood_ceiling',
    outputId: 'wood_ceiling',
    outputQuantityPerUnit: 1,
    inputs: { wood: 50 },
    durationS: 15,
  },
  {
    id: 'wood_door',
    outputId: 'wood_door',
    outputQuantityPerUnit: 1,
    inputs: { wood: 30 },
    durationS: 10,
  },
];

export function getRecipe(recipeId: string): RecipeDefinition | undefined {
  return RECIPES.find((recipe) => recipe.id === recipeId);
}
