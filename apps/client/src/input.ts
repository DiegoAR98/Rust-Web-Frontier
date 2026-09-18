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

/**
 * How far up or down the camera may look. Just short of vertical: at exactly
 * +/-90 degrees the view matrix's up vector degenerates and the view rolls.
 */
export const MAX_PITCH_RAD = Math.PI / 2 - 0.01;

/**
 * Clamps vertical look, rather than wrapping it the way yaw is wrapped:
 * looking past straight up must stop at straight up, not tip the camera over
 * onto its back.
 */
export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.min(MAX_PITCH_RAD, Math.max(-MAX_PITCH_RAD, pitch));
}

/**
 * A jump waiting to be sent. Move intent is sampled on a 20 Hz timer rather
 * than per frame, so a press and release that both land inside one 50 ms
 * window would otherwise never be sent: the key was down for none of the
 * samples. On a 144 Hz display that is seven frames of holding space and no
 * jump, which reads as the game ignoring you.
 *
 * `held` is the key's actual state, which keeps a held space bouncing exactly
 * as it did before. `pending` is the tap that has not been sent yet.
 */
export interface JumpLatch {
  held: boolean;
  pending: boolean;
}

export const NO_JUMP: JumpLatch = { held: false, pending: false };

export function pressJump(_latch: JumpLatch): JumpLatch {
  return { held: true, pending: true };
}

export function releaseJump(latch: JumpLatch): JumpLatch {
  // The pending tap survives the release; that is the whole point of it.
  return { held: false, pending: latch.pending };
}

/** What this sample should carry, and what is left for the next one. */
export function takeJump(latch: JumpLatch): { jump: boolean; next: JumpLatch } {
  return { jump: latch.held || latch.pending, next: { held: latch.held, pending: false } };
}

/** Converts raw held-key state into the bounded axis intent GDD section 5 specifies. */
export function computeMoveIntent(keys: KeyState): MoveIntent {
  const axisY = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const axisX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  return { axisX, axisY, sprint: keys.sprint, crouch: keys.crouch, jump: keys.jump };
}
