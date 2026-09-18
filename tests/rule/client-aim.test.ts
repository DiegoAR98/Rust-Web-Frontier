import { describe, expect, it } from 'vitest';
import { AIM_CONE_RAD, bearingLabel, pickAimed } from '@rwf/client/aim';

const EYE = { x: 0, y: 1.7, z: 0 };
/** Yaw 0 faces +z, the same convention stepMovement integrates with. */
const FACING_NORTH = 0;

const at = (x: number, z: number, value: string) => ({ value, position: { x, y: 0, z } });

describe('picking what a swing lands on', () => {
  it('hits what the player is facing, not what is behind them', () => {
    // The whole complaint: a wood pile two metres behind you used to win
    // against the wolf you were looking at.
    const aimed = pickAimed(EYE, FACING_NORTH, [at(0, -2, 'behind'), at(0, 4, 'ahead')], AIM_CONE_RAD);
    expect(aimed).toBe('ahead');
  });

  it('takes the nearer of two things in front', () => {
    // Nearest-in-front rather than nearest-to-centre: the server refuses
    // anything out of reach, so preferring a distant target dead ahead over a
    // close one slightly off would spend the swing on a refusal.
    const aimed = pickAimed(EYE, FACING_NORTH, [at(0, 8, 'far'), at(1, 2, 'near')], AIM_CONE_RAD);
    expect(aimed).toBe('near');
  });

  it('hits nothing when the player is facing empty ground', () => {
    expect(pickAimed(EYE, FACING_NORTH, [at(0, -3, 'behind')], AIM_CONE_RAD)).toBeUndefined();
    expect(pickAimed(EYE, FACING_NORTH, [at(5, 0, 'beside')], AIM_CONE_RAD)).toBeUndefined();
  });

  it('hits what the player is standing on top of', () => {
    // A body underfoot has no bearing to compare against; it is not behind you.
    expect(pickAimed(EYE, FACING_NORTH, [at(0, 0, 'underfoot')], AIM_CONE_RAD)).toBe('underfoot');
  });

  it('follows the player around', () => {
    const targets = [at(0, 4, 'north'), at(4, 0, 'east')];
    expect(pickAimed(EYE, 0, targets, AIM_CONE_RAD)).toBe('north');
    expect(pickAimed(EYE, Math.PI / 2, targets, AIM_CONE_RAD)).toBe('east');
    expect(pickAimed(EYE, Math.PI, targets, AIM_CONE_RAD)).toBeUndefined();
  });
});

describe('telling the player which way to turn', () => {
  it('calls the swing arc ahead, so what the HUD calls ahead is what a click hits', () => {
    expect(bearingLabel(0, 0, 5)).toBe('ahead');
    expect(bearingLabel(0, 1, 1.01)).toBe('ahead'); // just inside the 45 degree edge
  });

  it('separates left from right', () => {
    expect(bearingLabel(0, 5, 0)).toBe('right');
    expect(bearingLabel(0, -5, 0)).toBe('left');
  });

  it('calls the arc directly behind behind', () => {
    expect(bearingLabel(0, 0, -5)).toBe('behind');
  });

  it('turns with the player', () => {
    // Facing east, the thing to the north is now on the left.
    expect(bearingLabel(Math.PI / 2, 0, 5)).toBe('left');
    expect(bearingLabel(Math.PI / 2, 5, 0)).toBe('ahead');
  });
});
