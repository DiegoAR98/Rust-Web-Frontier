/**
 * What a placed deployable is, once it stops being an inventory item.
 * Transcribed from CONTENT section 7's insert/deployable table: "small_crate /
 * large_crate / stash | 250 / 500 / 150 | 12 / 30 / 6 slots".
 *
 * Only what a player can actually craft and place is listed. The large crate
 * and the cot are Learn/Bench and there is no research system; the stash is
 * buried, which is its whole point. Each arrives with the vertical that makes
 * it reachable.
 */
export interface DeployableDefinition {
  id: string;
  /** Container capacity; zero for a deployable that holds nothing. */
  slots: number;
  placedHp: number;
  /**
   * GDD section 12: "Bedroll cooldown is 300 seconds, cot 120." Null for
   * anything that is not a personal respawn anchor.
   */
  respawnCooldownS: number | null;
}

export const DEPLOYABLES: DeployableDefinition[] = [
  { id: 'small_crate', slots: 12, placedHp: 250, respawnCooldownS: null },
  { id: 'bedroll', slots: 0, placedHp: 200, respawnCooldownS: 300 },
];

export function getDeployable(id: string): DeployableDefinition | undefined {
  return DEPLOYABLES.find((deployable) => deployable.id === id);
}
