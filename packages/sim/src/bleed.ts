export interface BleedWound {
  ratePerS: number;
  remainingS: number;
}

/**
 * Repeat wounds take the maximum active rate and the latest expiry, never
 * additive stacking (GDD section 6): two simultaneous bleed sources cannot
 * multiply damage output.
 */
export function applyBleedWound(current: BleedWound | null, ratePerS: number, durationS: number): BleedWound {
  if (!current) return { ratePerS, remainingS: durationS };
  return {
    ratePerS: Math.max(current.ratePerS, ratePerS),
    remainingS: Math.max(current.remainingS, durationS),
  };
}

export function tickBleed(wound: BleedWound | null, dt: number): { wound: BleedWound | null; damage: number } {
  if (!wound) return { wound: null, damage: 0 };
  const damage = wound.ratePerS * dt;
  const remainingS = wound.remainingS - dt;
  return { wound: remainingS > 0 ? { ratePerS: wound.ratePerS, remainingS } : null, damage };
}

export interface ChannelState {
  durationS: number;
  elapsedS: number;
}

export function startChannel(durationS: number): ChannelState {
  return { durationS, elapsedS: 0 };
}

/**
 * Successful completion consumes one unit and applies effects atomically
 * (GDD section 6). Damage, sprint, death or disconnect must cancel the
 * channel outright via cancelChannel -- this function never partially
 * consumes.
 */
export function progressChannel(
  channel: ChannelState,
  dt: number,
): { channel: ChannelState | null; completed: boolean } {
  const elapsedS = channel.elapsedS + dt;
  if (elapsedS >= channel.durationS) {
    return { channel: null, completed: true };
  }
  return { channel: { durationS: channel.durationS, elapsedS }, completed: false };
}

/** Cancels an in-progress channel; the caller must not resume it afterward. */
export function cancelChannel(_channel: ChannelState): null {
  return null;
}
