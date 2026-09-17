import { describe, expect, it } from 'vitest';
import {
  STATION_SPECS,
  stepStation,
  type Slot,
  type StationState,
} from '@rwf/sim';

/** Every id these tests touch stacks to 250 except meat, which stacks to 20. */
const stackLimitOf = (definitionId: string): number =>
  definitionId === 'raw_meat' || definitionId === 'cooked_meat' ? 20 : 250;

function stack(definitionId: string, quantity: number): Slot {
  return { definitionId, quantity };
}

function station(overrides: Partial<StationState> = {}): StationState {
  return {
    lit: true,
    inputs: [null, null],
    fuel: null,
    outputs: [null, null, null],
    progressS: 0,
    ...overrides,
  };
}

function totalOf(slots: Slot[], definitionId: string): number {
  return slots.reduce((sum, slot) => sum + (slot?.definitionId === definitionId ? slot.quantity : 0), 0);
}

/**
 * CONTENT section 3's worked furnace check: "12 metal_ore in each input, 12
 * wood and clear outputs produce 48 metal and 12 charcoal after 60 seconds.
 * Inputs/fuel are empty." That is PRODUCTION's T09 gate.
 */
describe('stepStation: the furnace worked example (T09, CONTENT section 3)', () => {
  it('produces 48 metal and 12 charcoal in 60s and empties the inputs and fuel', () => {
    const result = stepStation(
      station({ inputs: [stack('metal_ore', 12), stack('metal_ore', 12)], fuel: stack('wood', 12) }),
      STATION_SPECS.furnace,
      stackLimitOf,
      60,
    );

    expect(totalOf(result.outputs, 'metal')).toBe(48);
    expect(totalOf(result.outputs, 'charcoal')).toBe(12);
    expect(result.inputs).toEqual([null, null]);
    expect(result.fuel).toBeNull();
  });

  it('smelts sulfur ore by the same rule, one input slot at a time', () => {
    const result = stepStation(
      station({ inputs: [stack('metal_ore', 12), stack('sulfur_ore', 12)], fuel: stack('wood', 12) }),
      STATION_SPECS.furnace,
      stackLimitOf,
      60,
    );

    expect(totalOf(result.outputs, 'metal')).toBe(24);
    expect(totalOf(result.outputs, 'sulfur')).toBe(24);
  });

  it('keeps making charcoal from fuel alone: an empty furnace still burns wood', () => {
    // CONTENT section 3: "An empty furnace can still convert wood into charcoal."
    const result = stepStation(station({ fuel: stack('wood', 12) }), STATION_SPECS.furnace, stackLimitOf, 60);

    expect(totalOf(result.outputs, 'charcoal')).toBe(12);
    expect(result.fuel).toBeNull();
  });
});

/**
 * The same model has to produce CONTENT's campfire check -- "a single burning
 * campfire converts 6 raw_meat plus 6 wood into 6 cooked_meat and 6 charcoal
 * in 60 seconds" -- from nothing but a different spec.
 */
describe('stepStation: the campfire worked example (CONTENT section 3)', () => {
  it('cooks 6 meat and makes 6 charcoal in 60s', () => {
    const result = stepStation(
      { lit: true, inputs: [stack('raw_meat', 6)], fuel: stack('wood', 6), outputs: [null, null], progressS: 0 },
      STATION_SPECS.campfire,
      stackLimitOf,
      60,
    );

    expect(totalOf(result.outputs, 'cooked_meat')).toBe(6);
    expect(totalOf(result.outputs, 'charcoal')).toBe(6);
    expect(result.inputs).toEqual([null]);
    expect(result.fuel).toBeNull();
  });
});

/**
 * CONTENT section 3: "Fire processing reserves output capacity for
 * food/metal/sulfur and charcoal before each fuel quantum. At a fully blocked
 * output, pause the entire station and do not consume fuel." A fuel quantum is
 * therefore all-or-nothing across the whole station, which is what T09's
 * second half checks.
 */
describe('stepStation: a blocked output pauses the whole station (T09)', () => {
  it('consumes no inputs or fuel, and banks no time, when the outputs are full', () => {
    const full: Slot[] = [stack('metal', 250), stack('metal', 250), stack('metal', 250)];
    const result = stepStation(
      station({ inputs: [stack('metal_ore', 12), null], fuel: stack('wood', 12), outputs: full }),
      STATION_SPECS.furnace,
      stackLimitOf,
      60,
    );

    expect(result.inputs[0]).toEqual(stack('metal_ore', 12));
    expect(result.fuel).toEqual(stack('wood', 12));
    expect(result.progressS).toBe(0);
  });

  it('pauses the ore conversion too when only the charcoal has nowhere to go', () => {
    // The rule that two independent per-slot conversions would get wrong: the
    // ore has room for its metal, but the quantum cannot complete, so it must
    // not run at all -- and in particular must not burn the wood.
    const outputs: Slot[] = [stack('metal', 248), stack('cooked_meat', 20), stack('sulfur', 250)];
    const result = stepStation(
      station({ inputs: [stack('metal_ore', 12), null], fuel: stack('wood', 12), outputs }),
      STATION_SPECS.furnace,
      stackLimitOf,
      5,
    );

    expect(result.inputs[0]).toEqual(stack('metal_ore', 12));
    expect(result.fuel).toEqual(stack('wood', 12));
    expect(totalOf(result.outputs, 'metal')).toBe(248);
  });

  it('does nothing without fuel, however much ore and time it is given', () => {
    const result = stepStation(
      station({ inputs: [stack('metal_ore', 12), null] }),
      STATION_SPECS.furnace,
      stackLimitOf,
      60,
    );

    expect(result.inputs[0]).toEqual(stack('metal_ore', 12));
    expect(totalOf(result.outputs, 'metal')).toBe(0);
    expect(result.progressS).toBe(0);
  });

  it('does nothing while unlit', () => {
    // CONTENT section 3: "Shut off the fire or transfer food to stop burning."
    const result = stepStation(
      station({ lit: false, inputs: [stack('metal_ore', 12), null], fuel: stack('wood', 12) }),
      STATION_SPECS.furnace,
      stackLimitOf,
      60,
    );

    expect(result.fuel).toEqual(stack('wood', 12));
    expect(totalOf(result.outputs, 'metal')).toBe(0);
  });
});

describe('stepStation: cycle accounting', () => {
  it('never converts a fraction of a cycle: partial progress carries over', () => {
    const result = stepStation(
      station({ inputs: [stack('metal_ore', 12), null], fuel: stack('wood', 12) }),
      STATION_SPECS.furnace,
      stackLimitOf,
      7,
    );

    expect(totalOf(result.outputs, 'metal')).toBe(2); // one full 5s cycle only
    expect(result.progressS).toBeCloseTo(2, 5);
  });

  it('stops smelting once the ore runs out, with fuel and time still left', () => {
    const result = stepStation(
      station({ inputs: [stack('metal_ore', 2), null], fuel: stack('wood', 12) }),
      STATION_SPECS.furnace,
      stackLimitOf,
      60,
    );

    expect(totalOf(result.outputs, 'metal')).toBe(4);
    expect(result.inputs[0]).toBeNull();
    // The fire keeps burning: fuel alone still yields charcoal.
    expect(totalOf(result.outputs, 'charcoal')).toBe(12);
  });

  it('does not count wood as both an input and its own fuel', () => {
    // CONTENT section 3: "No charcoal duplication from simultaneously counting
    // wood as input and fuel." Wood is not a furnace input at all, so a stack
    // of it sitting in an input slot converts to nothing.
    const result = stepStation(
      station({ inputs: [stack('wood', 12), null], fuel: stack('wood', 12) }),
      STATION_SPECS.furnace,
      stackLimitOf,
      60,
    );

    expect(totalOf(result.outputs, 'charcoal')).toBe(12); // from the fuel slot only
    expect(result.inputs[0]).toEqual(stack('wood', 12)); // untouched
  });
});
