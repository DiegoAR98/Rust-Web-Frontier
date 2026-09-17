export interface WorldItem {
  instanceId: string;
  definitionId: string;
  claimedBy: string | null;
}

export type TakeItemOutcome =
  | { outcome: 'taken'; item: WorldItem }
  | { outcome: 'not_found' }
  | { outcome: 'already_taken' };

/**
 * Claims a world item instance for a player. Mutates the shared registry in
 * place so that, when commands are processed one at a time in received
 * order (TECHNICAL section 2), exactly one competing claim can ever succeed.
 */
export function takeItem(
  items: Map<string, WorldItem>,
  instanceId: string,
  playerId: string,
): TakeItemOutcome {
  const item = items.get(instanceId);
  if (!item) {
    return { outcome: 'not_found' };
  }
  if (item.claimedBy !== null) {
    return { outcome: 'already_taken' };
  }
  item.claimedBy = playerId;
  return { outcome: 'taken', item };
}
