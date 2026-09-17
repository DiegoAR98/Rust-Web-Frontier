import { describe, expect, it } from 'vitest';
import { CommandSchema, PROTOCOL_VERSION } from '@rwf/protocol';

function validMoveCommand(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence: 1,
    clientTick: 100,
    action: {
      type: 'move',
      axisX: 1,
      axisY: 0,
      yaw: 0,
      sprint: false,
      crouch: false,
      jump: false,
    },
    ...overrides,
  };
}

describe('CommandSchema', () => {
  it('accepts a well-formed move command', () => {
    const result = CommandSchema.safeParse(validMoveCommand());
    expect(result.success).toBe(true);
  });

  it('rejects an axis value forged outside the -1..1 range', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ action: { ...validMoveCommand().action, axisX: 999 } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a NaN axis value', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ action: { ...validMoveCommand().action, axisX: Number.NaN } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an Infinity axis value', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ action: { ...validMoveCommand().action, axisY: Number.POSITIVE_INFINITY } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a mismatched protocol version', () => {
    const result = CommandSchema.safeParse(validMoveCommand({ protocolVersion: 999 }));
    expect(result.success).toBe(false);
  });

  it('rejects a negative sequence number', () => {
    const result = CommandSchema.safeParse(validMoveCommand({ sequence: -1 }));
    expect(result.success).toBe(false);
  });

  it('rejects a sequence number beyond the float64 safe-integer range', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ sequence: Number.MAX_SAFE_INTEGER + 2 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a sessionEpoch number beyond the float64 safe-integer range', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ sessionEpoch: Number.MAX_SAFE_INTEGER + 2 }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed take-item command', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ action: { type: 'takeItem', itemInstanceId: 'item_123' } }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed hit-node command', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ action: { type: 'hitNode', nodeId: 'node_1' } }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed craft command', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ action: { type: 'craft', recipeId: 'stone_hatchet', quantity: 1 } }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a craft quantity outside 1..100 (GDD section 9: up to 100 units per entry)', () => {
    expect(
      CommandSchema.safeParse(
        validMoveCommand({ action: { type: 'craft', recipeId: 'stone_hatchet', quantity: 0 } }),
      ).success,
    ).toBe(false);
    expect(
      CommandSchema.safeParse(
        validMoveCommand({ action: { type: 'craft', recipeId: 'stone_hatchet', quantity: 101 } }),
      ).success,
    ).toBe(false);
  });

  it('accepts the three station commands (T09, CONTENT section 3)', () => {
    for (const action of [
      { type: 'stationInsert', stationId: 'furnace_1', definitionId: 'metal_ore', quantity: 12 },
      { type: 'stationTake', stationId: 'furnace_1' },
      { type: 'stationLight', stationId: 'furnace_1', lit: true },
    ]) {
      expect(CommandSchema.safeParse(validMoveCommand({ action })).success).toBe(true);
    }
  });

  it('rejects a station insert quantity outside one stack', () => {
    // CONTENT section 1's largest stack is 250; an insert moves at most one.
    for (const quantity of [0, 251, 1.5]) {
      expect(
        CommandSchema.safeParse(
          validMoveCommand({
            action: { type: 'stationInsert', stationId: 'furnace_1', definitionId: 'wood', quantity },
          }),
        ).success,
      ).toBe(false);
    }
  });

  it('rejects an unknown action type', () => {
    const result = CommandSchema.safeParse(
      validMoveCommand({ action: { type: 'noclip', itemInstanceId: 'item_123' } }),
    );
    expect(result.success).toBe(false);
  });
});
