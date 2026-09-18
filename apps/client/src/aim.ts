export interface Aimed<T> {
  value: T;
  position: { x: number; y: number; z: number };
}

/**
 * How far off centre a swing still counts, in radians. Half of a right angle,
 * so the arc in front of the player is a right angle wide: forgiving enough
 * that a melee swing does not demand pixel aim, narrow enough that nothing
 * beside or behind the player is ever in it.
 */
export const AIM_CONE_RAD = Math.PI / 4;

/**
 * Which way to turn to face something. A distance on its own does not help a
 * player find anything: "wolf 18 m" in a world of identically brown boxes with
 * no map is a number, not a direction.
 *
 * "Ahead" is exactly the swing's arc, so a target the HUD calls ahead is one a
 * click would land on.
 */
export function bearingLabel(yaw: number, dx: number, dz: number): 'ahead' | 'right' | 'left' | 'behind' {
  const TAU = 2 * Math.PI;
  // Signed, folded into [-PI, PI]: which side it is on is the whole answer.
  const relative = ((Math.atan2(dx, dz) - yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  if (Math.abs(relative) <= AIM_CONE_RAD) return 'ahead';
  if (Math.abs(relative) >= Math.PI - AIM_CONE_RAD) return 'behind';
  // Mouse-right increases yaw, and forward is (sin yaw, cos yaw), so a
  // positive relative bearing is a turn to the right.
  return relative > 0 ? 'right' : 'left';
}

/**
 * What one swing lands on: the nearest candidate the player is actually
 * facing. GDD section 5 puts use and aim on the mouse, and the previous rule
 * -- nearest of everything, in any direction -- meant clicking at a wolf
 * chopped a wood pile standing behind you instead.
 *
 * Nearest-in-front rather than nearest-to-centre, because the server refuses
 * anything out of reach: preferring a distant target dead ahead over a close
 * one slightly off centre would spend the swing on a refusal.
 *
 * Bearing is measured on the ground plane. Pitch is left out for the same
 * reason the placement ghost leaves it out -- everything a swing can reach
 * sits at roughly eye level or below, and folding pitch in would only make
 * looking at your own feet miss the carcass lying there.
 */
export function pickAimed<T>(
  from: { x: number; y: number; z: number },
  yaw: number,
  candidates: ReadonlyArray<Aimed<T>>,
  coneRad: number,
): T | undefined {
  // The forward vector stepMovement integrates with, so "in front" means the
  // same thing to the swing as it does to the walk.
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);
  const limit = Math.cos(coneRad);

  let best: T | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const dx = candidate.position.x - from.x;
    const dz = candidate.position.z - from.z;
    const ground = Math.hypot(dx, dz);
    // Something underfoot has no bearing to compare against, and is certainly
    // not behind you.
    if (ground > 0 && (dx * forwardX + dz * forwardZ) / ground < limit) continue;

    const dy = candidate.position.y - from.y;
    const distance = Math.hypot(ground, dy);
    if (distance >= bestDistance) continue;
    best = candidate.value;
    bestDistance = distance;
  }
  return best;
}
