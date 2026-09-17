export interface Transform {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function shortestAngleDelta(from: number, to: number): number {
  const twoPi = 2 * Math.PI;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return delta;
}

/**
 * Blends a remote entity's last two replicated transforms for smooth
 * rendering between server patches. No client-side prediction: the local
 * player snaps directly to server state, and only remote entities use this.
 */
export function interpolateTransform(from: Transform, to: Transform, alpha: number): Transform {
  const t = Math.max(0, Math.min(1, alpha));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
    yaw: from.yaw + shortestAngleDelta(from.yaw, to.yaw) * t,
  };
}
