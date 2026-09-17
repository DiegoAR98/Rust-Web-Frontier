export interface ConversionState {
  inputRemaining: number;
  outputCapacityRemaining: number;
  progressS: number;
  producedOutput: number;
}

/**
 * Steps one station conversion queue (a furnace ore slot, or the shared
 * wood-to-charcoal fuel cycle) by dt seconds. Reserves output capacity
 * before consuming input for each cycle: a fully blocked output pauses the
 * whole cycle and consumes nothing, matching CONTENT section 3's rule that
 * a blocked station "consumes no inputs/fuel". Partial progress toward the
 * next cycle carries over rather than producing a fractional output.
 */
export function stepConversion(
  state: ConversionState,
  cycleSeconds: number,
  outputPerCycle: number,
  dt: number,
): ConversionState {
  if (state.inputRemaining <= 0 || state.outputCapacityRemaining < outputPerCycle) {
    return state; // fully paused: time does not bank toward the next cycle either
  }

  let { inputRemaining, outputCapacityRemaining, progressS, producedOutput } = state;
  progressS += dt;

  while (progressS >= cycleSeconds && inputRemaining > 0 && outputCapacityRemaining >= outputPerCycle) {
    inputRemaining -= 1;
    outputCapacityRemaining -= outputPerCycle;
    producedOutput += outputPerCycle;
    progressS -= cycleSeconds;
  }

  return { inputRemaining, outputCapacityRemaining, progressS, producedOutput };
}
