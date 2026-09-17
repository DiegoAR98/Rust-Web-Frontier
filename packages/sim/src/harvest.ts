export interface ResourceNode {
  nodeId: string;
  remaining: number;
}

export interface HarvestResult {
  granted: number;
  remaining: number;
}

/**
 * Applies one harvest hit against a finite node budget (GDD section 7).
 * Clamping to the node's remaining amount guarantees the total granted
 * across any number of sequential hits never exceeds its original budget,
 * even when two competing hits race to take the final yield.
 */
export function harvestNode(
  node: ResourceNode,
  yieldPerHit: number,
): { node: ResourceNode; result: HarvestResult } {
  const granted = Math.min(yieldPerHit, node.remaining);
  const remaining = node.remaining - granted;
  return { node: { ...node, remaining }, result: { granted, remaining } };
}
