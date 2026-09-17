/**
 * Splits a resource total across 4 harvest hits, one quarter each, with the
 * integer-division remainder assigned to the final hit (GDD section 7).
 */
export function harvestPortion(total: number, hitIndex: 1 | 2 | 3 | 4): number {
  const perHit = Math.floor(total / 4);
  return hitIndex < 4 ? perHit : total - perHit * 3;
}

export interface CarcassState {
  hitsUsed: number;
}

export type ResourceTotals = Record<string, number>;

export interface HarvestHitResult {
  state: CarcassState;
  granted: ResourceTotals;
}

/**
 * Applies one valid tool hit against a carcass's harvest pool. Once all 4
 * hits have been paid, further hits grant nothing -- the pool cannot be
 * double-paid regardless of how many players hit it (T20).
 */
export function harvestCarcassHit(state: CarcassState, totals: ResourceTotals): HarvestHitResult {
  if (state.hitsUsed >= 4) {
    return { state, granted: {} };
  }
  const hitIndex = (state.hitsUsed + 1) as 1 | 2 | 3 | 4;
  const granted: ResourceTotals = {};
  for (const [resource, total] of Object.entries(totals)) {
    granted[resource] = harvestPortion(total, hitIndex);
  }
  return { state: { hitsUsed: hitIndex }, granted };
}
