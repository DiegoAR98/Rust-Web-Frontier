import { describe, expect, it } from 'vitest';
import {
  DAY_LENGTH_TICKS,
  DAYLIGHT_TICKS,
  dayPhase,
  lowlandColdPressure,
  timeOfDayFraction,
} from '@rwf/sim';

const TICK_RATE = 20;

/**
 * GDD section 20: "Each 60-minute online day contains 45 minutes of light and
 * 15 of darkness. Start the world at morning." Derived from the simulation
 * tick, never wall-clock, so stopping the host freezes the clock along with
 * every other timer (GDD section 20's downtime rule, proven by T17).
 */
describe('day/night clock (GDD section 20)', () => {
  it('runs a 60-minute day of 45 minutes light and 15 dark', () => {
    expect(DAY_LENGTH_TICKS).toBe(60 * 60 * TICK_RATE);
    expect(DAYLIGHT_TICKS).toBe(45 * 60 * TICK_RATE);
    expect(DAY_LENGTH_TICKS - DAYLIGHT_TICKS).toBe(15 * 60 * TICK_RATE);
  });

  it('starts the world at morning', () => {
    expect(dayPhase(0)).toBe('day');
    expect(timeOfDayFraction(0)).toBe(0);
  });

  it('turns to night after the daylight portion elapses', () => {
    expect(dayPhase(DAYLIGHT_TICKS - 1)).toBe('day');
    expect(dayPhase(DAYLIGHT_TICKS)).toBe('night');
    expect(dayPhase(DAY_LENGTH_TICKS - 1)).toBe('night');
  });

  it('wraps round to the next morning', () => {
    expect(dayPhase(DAY_LENGTH_TICKS)).toBe('day');
    expect(dayPhase(DAY_LENGTH_TICKS + DAYLIGHT_TICKS)).toBe('night');
    // A world restored at a large tick must land in the right phase, not
    // restart the cycle.
    expect(dayPhase(DAY_LENGTH_TICKS * 37 + DAYLIGHT_TICKS + 5)).toBe('night');
  });

  it('reports position through the day as a 0..1 fraction', () => {
    expect(timeOfDayFraction(DAY_LENGTH_TICKS / 2)).toBeCloseTo(0.5, 10);
    expect(timeOfDayFraction(DAY_LENGTH_TICKS)).toBe(0);
  });
});

/**
 * GDD section 6: "Lowlands have pressure 0 by day and 20 by night". The world
 * is a single flat lowland plane today; Ironback's 30/60 arrives with real
 * regional terrain.
 */
describe('lowland cold pressure (GDD section 6)', () => {
  it('applies no cold pressure by day', () => {
    expect(lowlandColdPressure('day')).toBe(0);
  });

  it('applies pressure 20 at night', () => {
    expect(lowlandColdPressure('night')).toBe(20);
  });
});
