import { addToInventory, type Slot } from './stacks.js';

export type StationKind = 'furnace' | 'campfire';

/** What one unit of an accepted input becomes, per fuel quantum. */
export interface Conversion {
  output: string;
  perCycle: number;
}

export interface StationSpec {
  cycleSeconds: number;
  inputSlots: number;
  outputSlots: number;
  conversions: Record<string, Conversion>;
}

/**
 * CONTENT section 3's station table. Wood is deliberately absent from every
 * `conversions` map: it is fuel only, which is what enforces the same
 * section's "no charcoal duplication from simultaneously counting wood as
 * input and fuel".
 */
export const STATION_SPECS: Record<StationKind, StationSpec> = {
  furnace: {
    cycleSeconds: 5,
    inputSlots: 2,
    outputSlots: 3,
    conversions: {
      metal_ore: { output: 'metal', perCycle: 2 },
      sulfur_ore: { output: 'sulfur', perCycle: 2 },
    },
  },
  campfire: {
    cycleSeconds: 10,
    inputSlots: 1,
    outputSlots: 2,
    conversions: {
      raw_meat: { output: 'cooked_meat', perCycle: 1 },
    },
  },
};

/**
 * Not modeled yet: CONTENT section 3's overcook rule -- "cooked food left in a
 * lit campfire output for 60 consecutive processing seconds becomes burnt one
 * unit at a time, oldest first", with removal resetting a stack's exposure and
 * merging retaining the older timestamp so stack juggling cannot erase it.
 * That needs a per-stack age this slot model does not carry, and T09 does not
 * gate it. Cooked meat currently sits in a campfire indefinitely.
 */

/** The only fuel in this baseline; CONTENT section 3 excludes rendered fuel. */
export const FUEL_DEFINITION_ID = 'wood';
export const FUEL_OUTPUT_ID = 'charcoal';

export interface StationState {
  lit: boolean;
  inputs: Slot[];
  fuel: Slot;
  outputs: Slot[];
  progressS: number;
}

/**
 * Everything one fuel quantum would produce: a charcoal from the fuel itself,
 * plus each input slot's conversion. Capacity for all of it has to exist
 * before any of it is consumed.
 */
function plannedOutputs(state: StationState, spec: StationSpec): Array<[string, number]> {
  const planned: Array<[string, number]> = [[FUEL_OUTPUT_ID, 1]];
  for (const slot of state.inputs) {
    if (!slot) continue;
    const conversion = spec.conversions[slot.definitionId];
    if (conversion) planned.push([conversion.output, conversion.perCycle]);
  }
  return planned;
}

/**
 * Returns the output slots after taking one quantum's worth, or null if any
 * part of it has nowhere to go -- the whole quantum is refused in that case,
 * never partially applied.
 */
function reserveOutputs(
  outputs: Slot[],
  planned: Array<[string, number]>,
  stackLimitOf: (definitionId: string) => number,
): Slot[] | null {
  let next = outputs;
  for (const [definitionId, quantity] of planned) {
    const result = addToInventory(next, definitionId, quantity, stackLimitOf(definitionId));
    if (result.overflow > 0) return null;
    next = result.slots;
  }
  return next;
}

/** Takes one unit off a slot, emptying it to null rather than leaving a zero. */
function consumeOne(slot: Slot): Slot {
  if (!slot) return null;
  return slot.quantity <= 1 ? null : { definitionId: slot.definitionId, quantity: slot.quantity - 1 };
}

/**
 * Runs one whole fuel quantum, or returns null if the station cannot: unlit,
 * out of fuel, or with any destination full. CONTENT section 3 makes the
 * quantum atomic across the station -- "reserves output capacity for
 * food/metal/sulfur and charcoal before each fuel quantum. At a fully blocked
 * output, pause the entire station and do not consume fuel" -- so a blocked
 * charcoal slot stalls the ore as well, and vice versa.
 */
function runCycle(
  state: StationState,
  spec: StationSpec,
  stackLimitOf: (definitionId: string) => number,
): StationState | null {
  if (!state.lit || !state.fuel) return null;

  const outputs = reserveOutputs(state.outputs, plannedOutputs(state, spec), stackLimitOf);
  if (!outputs) return null;

  const inputs = state.inputs.map((slot) =>
    slot && spec.conversions[slot.definitionId] ? consumeOne(slot) : slot,
  );

  return { ...state, inputs, fuel: consumeOne(state.fuel), outputs };
}

/**
 * Steps a furnace or campfire by dt seconds. Partial progress toward the next
 * quantum carries over rather than producing a fraction of one; a station that
 * cannot run at all banks no time either, so pausing it does not let elapsed
 * seconds pile up into a burst when it resumes.
 *
 * Time only ever enters through dt, which the room supplies from its own fixed
 * timestep -- that is what stops fuel advancing while the host is down (T17).
 */
export function stepStation(
  state: StationState,
  spec: StationSpec,
  stackLimitOf: (definitionId: string) => number,
  dt: number,
): StationState {
  if (!runCycle(state, spec, stackLimitOf)) return state;

  let next: StationState = { ...state, progressS: state.progressS + dt };
  while (next.progressS >= spec.cycleSeconds) {
    const completed = runCycle(next, spec, stackLimitOf);
    if (!completed) break;
    next = { ...completed, progressS: next.progressS - spec.cycleSeconds };
  }
  return next;
}
