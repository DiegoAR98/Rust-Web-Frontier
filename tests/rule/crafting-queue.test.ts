import { describe, expect, it } from 'vitest';
import { cancelQueueEntry, startQueueEntry, tickQueueEntry, type Recipe } from '@rwf/sim';

const hatchetRecipe: Recipe = {
  outputId: 'stone_hatchet',
  outputQuantityPerUnit: 1,
  inputs: { wood: 15, stone: 10 },
  durationS: 10,
};

describe('startQueueEntry', () => {
  it('starts at zero completed units and zero progress', () => {
    const entry = startQueueEntry(hatchetRecipe, 3);
    expect(entry).toMatchObject({ totalUnits: 3, completedUnits: 0, progressS: 0 });
  });
});

describe('tickQueueEntry', () => {
  it('produces one unit exactly when its duration elapses', () => {
    const entry = startQueueEntry(hatchetRecipe, 3);
    const { entry: after, producedUnits } = tickQueueEntry(entry, 10, Infinity);
    expect(producedUnits).toBe(1);
    expect(after.completedUnits).toBe(1);
  });

  it('produces multiple units in one step when dt covers several durations', () => {
    const entry = startQueueEntry(hatchetRecipe, 3);
    const { entry: after, producedUnits } = tickQueueEntry(entry, 25, Infinity);
    expect(producedUnits).toBe(2); // 25s / 10s = 2 full units, 5s carried over
    expect(after.completedUnits).toBe(2);
    expect(after.progressS).toBeCloseTo(5, 5);
  });

  it('never produces more than totalUnits even with excess time', () => {
    const entry = startQueueEntry(hatchetRecipe, 2);
    const { entry: after, producedUnits } = tickQueueEntry(entry, 1000, Infinity);
    expect(producedUnits).toBe(2);
    expect(after.completedUnits).toBe(2);
  });

  it('pauses output completion when the output capacity is full, retaining escrow (progress does not bank)', () => {
    const entry = startQueueEntry(hatchetRecipe, 3);
    const { entry: after, producedUnits } = tickQueueEntry(entry, 10, 0);
    expect(producedUnits).toBe(0);
    expect(after.completedUnits).toBe(0);
    expect(after.progressS).toBe(0);
  });

  it('stops mid-batch exactly at the output capacity limit', () => {
    const entry = startQueueEntry(hatchetRecipe, 3);
    // Capacity for only 1 more unit even though 2 units' worth of time passed.
    const { producedUnits } = tickQueueEntry(entry, 20, 1);
    expect(producedUnits).toBe(1);
  });
});

describe('cancelQueueEntry (refunds unstarted + incomplete unit in full, never completed output)', () => {
  it('refunds the full input cost of a freshly started entry (nothing completed yet)', () => {
    const entry = startQueueEntry(hatchetRecipe, 3);
    expect(cancelQueueEntry(entry)).toEqual({ wood: 45, stone: 30 });
  });

  it('refunds only the remaining units after some have completed, never the completed ones', () => {
    let entry = startQueueEntry(hatchetRecipe, 3);
    entry = tickQueueEntry(entry, 10, Infinity).entry; // 1 of 3 completed
    expect(cancelQueueEntry(entry)).toEqual({ wood: 30, stone: 20 }); // 2 remaining units
  });

  it('refunds nothing once every unit has completed', () => {
    let entry = startQueueEntry(hatchetRecipe, 1);
    entry = tickQueueEntry(entry, 10, Infinity).entry;
    expect(cancelQueueEntry(entry)).toEqual({ wood: 0, stone: 0 });
  });
});
