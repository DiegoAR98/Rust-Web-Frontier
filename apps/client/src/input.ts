export interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
}

export interface MoveIntent {
  axisX: number;
  axisY: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
}

/**
 * Folds an accumulated camera angle into the [-PI, PI] range MoveIntentSchema
 * accepts, preserving the facing direction. Mouse-look adds to the camera's
 * rotation without bound, and Colyseus disconnects a client whose message
 * fails validation instead of dropping it, so sending the raw angle kicks the
 * player after about half a turn. A non-finite angle falls back to 0 for the
 * same reason: NaN on the wire is also a disconnect.
 */
export function wrapYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const TAU = 2 * Math.PI;
  const wrapped = ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  // The modulo can land exactly on +PI only via floating-point rounding at the
  // boundary; both ends are inside the schema's inclusive range regardless.
  return wrapped;
}

/** Converts raw held-key state into the bounded axis intent GDD section 5 specifies. */
export function computeMoveIntent(keys: KeyState): MoveIntent {
  const axisY = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const axisX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  return { axisX, axisY, sprint: keys.sprint, crouch: keys.crouch, jump: keys.jump };
}
