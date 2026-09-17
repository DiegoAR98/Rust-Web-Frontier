export interface RecipeDefinition {
  outputId: string;
  outputQuantityPerUnit: number;
  inputs: Record<string, number>;
  durationS: number;
}

// Transcribed from CONTENT.md section 2. Starting with the single recipe
// M1's crafting vertical needs; expand as later milestones need more.
export const RECIPES: RecipeDefinition[] = [
  { outputId: 'stone_hatchet', outputQuantityPerUnit: 1, inputs: { wood: 15, stone: 10 }, durationS: 10 },
];

export function getRecipe(outputId: string): RecipeDefinition | undefined {
  return RECIPES.find((recipe) => recipe.outputId === outputId);
}
