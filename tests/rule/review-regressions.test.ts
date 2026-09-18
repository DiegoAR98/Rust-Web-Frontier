import { describe, expect, it } from 'vitest';
import { CommandSchema, JoinOptionsSchema } from '@rwf/protocol';
import { resolveMove, wallSegment, tickBleed, startQueueEntry, tickQueueEntry, stepStation, STATION_SPECS } from '@rwf/sim';

describe('review: protocol and simulation boundary cases', () => {
  it.each(['foundation', 'pillar', 'ceiling'])('rejects an axis on %s instead of allowing duplicate geometry', (form) => {
    expect(CommandSchema.safeParse({ protocolVersion: 1, sessionEpoch: 1, sequence: 1, clientTick: 0,
      action: { type: 'placeBuildingPiece', definitionId: `wood_${form}`, form, storey: 0, i: 0, k: 0, axis: 'x' },
    }).success).toBe(false);
  });
  it('rejects an edge without an axis and oversized account identifiers', () => {
    expect(CommandSchema.safeParse({ protocolVersion: 1, sessionEpoch: 1, sequence: 1, clientTick: 0,
      action: { type: 'placeBuildingPiece', definitionId: 'wood_wall', form: 'wall', storey: 0, i: 0, k: 0, axis: null },
    }).success).toBe(false);
    expect(JoinOptionsSchema.safeParse({ accountId: 'a'.repeat(65), accountToken: 'a'.repeat(64) }).success).toBe(false);
  });
  it('cannot pass through a sealed corner or land on a wall to cross it next step', () => {
    const wall = wallSegment({ form: 'wall', storey: 0, i: 0, k: 0, axis: 'x' });
    const west = wallSegment({ form: 'wall', storey: 0, i: 0, k: 0, axis: 'z' });
    expect(resolveMove({ x: 1, z: 1 }, { x: -1, z: -1 }, [wall, west])).toEqual({ x: 1, z: 1 });
    expect(resolveMove({ x: 2, z: -0.175 }, { x: 2, z: 0 }, [wall])).toEqual({ x: 2, z: -0.175 });
  });
  it('only applies the remaining lifetime of a bleed on a long step', () => {
    expect(tickBleed({ remainingS: 0.25, ratePerS: 2 }, 10)).toEqual({ wound: null, damage: 0.5 });
  });
  it('does not bank blocked crafting time after the last free slot fills', () => {
    const recipe = { id: 'tool', outputId: 'tool', inputs: { wood: 1 }, durationS: 5, outputQuantityPerUnit: 1 };
    const first = tickQueueEntry(startQueueEntry(recipe, 3), 30, 1);
    expect(first.producedUnits).toBe(1);
    expect(tickQueueEntry(first.entry, 0.1, 1).producedUnits).toBe(0);
  });
  it('does not bank station time after running out of fuel', () => {
    const first = stepStation({ lit: true, inputs: [null, null], fuel: { definitionId: 'wood', quantity: 1 },
      outputs: [null, null, null], progressS: 0 }, STATION_SPECS.furnace, () => 250, 30);
    const next = stepStation({ ...first, fuel: { definitionId: 'wood', quantity: 1 } }, STATION_SPECS.furnace, () => 250, 0.1);
    expect(next.fuel?.quantity).toBe(1);
  });
});
