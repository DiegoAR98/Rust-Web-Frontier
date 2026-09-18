export const WALK_SPEED = 3.5;
export const SPRINT_SPEED = 5.5;
export const CROUCH_SPEED = 1.8;
export const GRAVITY = 20;
export const JUMP_SPEED = 6;
export const GROUND_Y = 0;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MovementState {
  position: Vec3;
  velocityY: number;
  grounded: boolean;
}

export interface MovementInput {
  axisX: number;
  axisY: number;
  yaw: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
}

function horizontalSpeed(input: MovementInput): number {
  if (input.crouch) return CROUCH_SPEED;
  if (input.sprint) return SPRINT_SPEED;
  return WALK_SPEED;
}

export function stepMovement(state: MovementState, input: MovementInput, dt: number): MovementState {
  const speed = horizontalSpeed(input);

  // Clamp the intent vector to unit magnitude so diagonal input cannot exceed
  // the declared speed for any axis combination the protocol allows through.
  const magnitude = Math.hypot(input.axisX, input.axisY);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  const forward = input.axisY * scale;
  const strafe = input.axisX * scale;

  const sinYaw = Math.sin(input.yaw);
  const cosYaw = Math.cos(input.yaw);
  const worldX = strafe * cosYaw + forward * sinYaw;
  const worldZ = forward * cosYaw - strafe * sinYaw;

  const position: Vec3 = {
    x: state.position.x + worldX * speed * dt,
    y: state.position.y,
    z: state.position.z + worldZ * speed * dt,
  };

  let grounded = state.grounded;
  let baseVelocityY = state.velocityY;

  if (grounded && input.jump) {
    baseVelocityY = JUMP_SPEED;
    grounded = false;
  }

  let velocityY = baseVelocityY - GRAVITY * dt;
  position.y = state.position.y + velocityY * dt;

  if (position.y <= GROUND_Y) {
    position.y = GROUND_Y;
    velocityY = 0;
    grounded = true;
  }

  return { position, velocityY, grounded };
}

/**
 * Fall damage begins below a vertical impact velocity of -10 m/s (GDD section
 * 5). Deliberately not wired into the room yet, and that is not an oversight:
 * nothing in the world can reach -10 m/s. The ground is one flat plane, a jump
 * leaves at JUMP_SPEED 6 m/s and so lands at -6, and there is no vertical
 * collision to stand on top of anything with. It arrives with terrain, and the
 * rule is kept here so the number does not have to be rediscovered then. D93.
 */
export function computeFallDamage(impactVelocityY: number): number {
  if (impactVelocityY >= -10) return 0;
  return Math.min(100, 8 * (Math.abs(impactVelocityY) - 10));
}
