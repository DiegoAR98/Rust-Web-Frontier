/**
 * The world clock, GDD section 20: "Each 60-minute online day contains 45
 * minutes of light and 15 of darkness. Start the world at morning."
 *
 * Everything here is a pure function of the simulation tick, never of
 * wall-clock time. That is what makes stopping the host freeze the day along
 * with every other gameplay timer instead of resuming hours later in the
 * wrong phase (T17).
 */

/** Simulation rate these lengths are expressed in; matches TECHNICAL section 3. */
const TICK_RATE_HZ = 20;

export const DAY_LENGTH_TICKS = 60 * 60 * TICK_RATE_HZ;
export const DAYLIGHT_TICKS = 45 * 60 * TICK_RATE_HZ;

export type DayPhase = 'day' | 'night';

/** How far through the current day a tick sits, 0 at morning up to just under 1. */
export function timeOfDayFraction(tick: number): number {
  return ((tick % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS / DAY_LENGTH_TICKS;
}

export function dayPhase(tick: number): DayPhase {
  const intoDay = ((tick % DAY_LENGTH_TICKS) + DAY_LENGTH_TICKS) % DAY_LENGTH_TICKS;
  return intoDay < DAYLIGHT_TICKS ? 'day' : 'night';
}

/**
 * GDD section 6: "Lowlands have pressure 0 by day and 20 by night". The map is
 * a single flat lowland plane for now; Ironback Ridge's 30 by day / 60 at
 * night, and rain's +10, arrive with real regional terrain and weather.
 */
export function lowlandColdPressure(phase: DayPhase): number {
  return phase === 'night' ? 20 : 0;
}
