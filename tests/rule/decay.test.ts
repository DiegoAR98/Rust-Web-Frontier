import { describe, expect, it } from 'vitest';
import { DECAY_INTERVAL_S, WOOD_DECAY, stepDecay } from '@rwf/sim';

/**
 * GDD section 10: "Shelter grace is 3 online hours followed by 6 hours to
 * decay from full to zero; wood structures/deployables use 24+24 ... At each
 * minute after grace, subtract the appropriate fraction of max HP. Activity
 * refresh pauses future decay without healing."
 */

const GRACE_S = WOOD_DECAY.graceHours * 3600;

describe('decay (GDD section 10)', () => {
  it('takes nothing off a building inside its grace period', () => {
    expect(stepDecay(1000, 1000, 0, WOOD_DECAY)).toBe(1000);
    expect(stepDecay(1000, 1000, GRACE_S - 1, WOOD_DECAY)).toBe(1000);
  });

  it('starts taking a fraction of max HP off once grace is over', () => {
    // 24 hours to go from full to zero is 1440 minutes, so a 1000 HP wall
    // loses 1000/1440 of its maximum each minute.
    const after = stepDecay(1000, 1000, GRACE_S + 1, WOOD_DECAY);
    expect(after).toBeCloseTo(1000 - 1000 / 1440, 5);
  });

  it('measures the fraction against max HP, not what is left', () => {
    // Otherwise a half-ruined building decays half as fast and never quite
    // disappears.
    const fromHalf = stepDecay(500, 1000, GRACE_S + 1, WOOD_DECAY);
    expect(500 - fromHalf).toBeCloseTo(1000 / 1440, 5);
  });

  it('empties a full wall in exactly its stated decay time', () => {
    let health = 1000;
    let minutes = 0;
    while (health > 0 && minutes < 10000) {
      health = stepDecay(health, 1000, GRACE_S + 1, WOOD_DECAY);
      minutes += 1;
    }

    expect(minutes).toBe(WOOD_DECAY.decayHours * 60);
    expect(health).toBe(0);
  });

  it('never takes a building below zero', () => {
    expect(stepDecay(0.1, 1000, GRACE_S + 1, WOOD_DECAY)).toBe(0);
  });

  it('counts the grace from the last activity, not from placement', () => {
    // "Activity refresh pauses future decay without healing": a refreshed
    // building is inside grace again at whatever health it had reached.
    expect(stepDecay(400, 1000, 0, WOOD_DECAY)).toBe(400);
  });

  it('runs on a one-minute step, matching the rule it implements', () => {
    expect(DECAY_INTERVAL_S).toBe(60);
  });
});
