/**
 * GDD section 10's decay: "At each minute after grace, subtract the
 * appropriate fraction of max HP."
 */
export const DECAY_INTERVAL_S = 60;

export interface DecayProfile {
  /** Online hours of quiet before decay starts at all. */
  graceHours: number;
  /** Online hours from full to zero, once it has. */
  decayHours: number;
}

/**
 * GDD section 10: "wood structures/deployables use 24+24". The shelter's 3+6
 * and metal's 48+48 arrive with the lean-to and the metal tier.
 */
export const WOOD_DECAY: DecayProfile = { graceHours: 24, decayHours: 24 };

/**
 * One minute of decay. Returns the health after it, which is the same health
 * while the building is still inside its grace period -- section 10's
 * "activity refresh pauses future decay without healing" falls out of that:
 * a refreshed building is inside grace again at whatever health it reached.
 *
 * The fraction is of *max* health, not of what is left. Taking a fraction of
 * the remainder would make a half-ruined building decay half as fast and
 * never quite disappear.
 */
export function stepDecay(
  health: number,
  maxHealth: number,
  secondsSinceActivity: number,
  profile: DecayProfile,
): number {
  if (secondsSinceActivity <= profile.graceHours * 3600) return health;
  const perMinute = maxHealth / (profile.decayHours * 60);
  return Math.max(0, health - perMinute);
}
