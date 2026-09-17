/**
 * What a placed deployable is, once it stops being an inventory item.
 * Transcribed from CONTENT section 7's insert/deployable table: "small_crate /
 * large_crate / stash | 250 / 500 / 150 | 12 / 30 / 6 slots".
 *
 * Only the crate a player can actually craft and place is listed. The large
 * crate is Learn/Bench and there is no research system; bedrolls and cots are
 * spawn anchors rather than containers and need their own rules; the stash is
 * buried, which is its whole point. Each arrives with the vertical that makes
 * it reachable.
 */
export interface DeployableDefinition {
  id: string;
  /** Container capacity. */
  slots: number;
  placedHp: number;
}

export const DEPLOYABLES: DeployableDefinition[] = [{ id: 'small_crate', slots: 12, placedHp: 250 }];

export function getDeployable(id: string): DeployableDefinition | undefined {
  return DEPLOYABLES.find((deployable) => deployable.id === id);
}
