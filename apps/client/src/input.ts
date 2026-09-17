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

/** Converts raw held-key state into the bounded axis intent GDD section 5 specifies. */
export function computeMoveIntent(keys: KeyState): MoveIntent {
  const axisY = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const axisX = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  return { axisX, axisY, sprint: keys.sprint, crouch: keys.crouch, jump: keys.jump };
}
