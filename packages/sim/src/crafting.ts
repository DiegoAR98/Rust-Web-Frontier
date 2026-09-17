export interface Recipe {
  outputId: string;
  outputQuantityPerUnit: number;
  inputs: Record<string, number>;
  durationS: number;
}

export interface QueueEntry {
  recipe: Recipe;
  totalUnits: number;
  completedUnits: number;
  progressS: number;
}

export function startQueueEntry(recipe: Recipe, totalUnits: number): QueueEntry {
  return { recipe, totalUnits, completedUnits: 0, progressS: 0 };
}

/**
 * Steps one queue entry by dt seconds. Reserves output capacity before
 * completing each unit; a fully blocked output pauses the whole entry
 * (progress does not bank either), matching the same "pause the station"
 * semantics as stepConversion (GDD section 9: "Full inventory pauses
 * output completion with a visible reason and retains escrow").
 */
export function tickQueueEntry(
  entry: QueueEntry,
  dt: number,
  outputCapacityRemaining: number,
): { entry: QueueEntry; producedUnits: number } {
  if (entry.completedUnits >= entry.totalUnits || outputCapacityRemaining < entry.recipe.outputQuantityPerUnit) {
    return { entry, producedUnits: 0 };
  }

  let progressS = entry.progressS + dt;
  let completedUnits = entry.completedUnits;
  let producedUnits = 0;
  let capacity = outputCapacityRemaining;

  while (
    progressS >= entry.recipe.durationS &&
    completedUnits < entry.totalUnits &&
    capacity >= entry.recipe.outputQuantityPerUnit
  ) {
    completedUnits += 1;
    producedUnits += 1;
    capacity -= entry.recipe.outputQuantityPerUnit;
    progressS -= entry.recipe.durationS;
  }

  return { entry: { ...entry, completedUnits, progressS }, producedUnits };
}

/**
 * Cancellation refunds all unstarted units plus the current incomplete
 * unit in full; it never refunds completed output (GDD section 9). Inputs
 * are only considered "spent" once a unit actually completes, so this is
 * simply the remaining-units count times the per-unit cost.
 */
export function cancelQueueEntry(entry: QueueEntry): Record<string, number> {
  const remainingUnits = entry.totalUnits - entry.completedUnits;
  const refund: Record<string, number> = {};
  if (remainingUnits <= 0) {
    return refund;
  }
  for (const [id, qty] of Object.entries(entry.recipe.inputs)) {
    refund[id] = qty * remainingUnits;
  }
  return refund;
}
