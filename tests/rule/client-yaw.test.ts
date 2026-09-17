import { describe, expect, it } from 'vitest';
import { clampPitch, MAX_PITCH_RAD, wrapYaw } from '@rwf/client/input';
import { MoveIntentSchema } from '@rwf/protocol';

/**
 * The camera's rotation accumulates without bound as the player turns, but
 * MoveIntentSchema bounds yaw to [-PI, PI] and Colyseus DISCONNECTS a client
 * whose message fails validation (RoomMessages.ts catches the throw with
 * client.leave(CloseCode.WITH_ERROR)) rather than dropping the message. So an
 * unwrapped yaw is not a rejected command -- it kicks the player out of the
 * game after roughly half a turn of normal mouse-look.
 */
describe('wrapYaw', () => {
  it('leaves an already-legal angle untouched', () => {
    expect(wrapYaw(0)).toBe(0);
    expect(wrapYaw(1)).toBeCloseTo(1, 12);
    expect(wrapYaw(-1)).toBeCloseTo(-1, 12);
  });

  it('wraps an angle past +PI back into range', () => {
    expect(wrapYaw(Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5, 12);
  });

  it('wraps an angle past -PI back into range', () => {
    expect(wrapYaw(-Math.PI - 0.5)).toBeCloseTo(Math.PI - 0.5, 12);
  });

  it('keeps many full turns inside the range the protocol accepts', () => {
    // A real session accumulates rotation indefinitely; every value it can
    // reach must still pass the wire schema.
    for (const turns of [1, 2, 5, 37, -1, -3, -60]) {
      const raw = turns * 2 * Math.PI + 0.25;
      const wrapped = wrapYaw(raw);
      expect(wrapped).toBeGreaterThanOrEqual(-Math.PI);
      expect(wrapped).toBeLessThanOrEqual(Math.PI);
      expect(
        MoveIntentSchema.safeParse({
          type: 'move',
          axisX: 0,
          axisY: 0,
          yaw: wrapped,
          sprint: false,
          crouch: false,
          jump: false,
        }).success,
      ).toBe(true);
    }
  });

  it('preserves the facing direction it wrapped', () => {
    // Wrapping must be a pure representation change: cos/sin of the wrapped
    // angle have to match the original, or the player would visibly snap.
    const raw = 9 * Math.PI + 0.3;
    const wrapped = wrapYaw(raw);
    expect(Math.cos(wrapped)).toBeCloseTo(Math.cos(raw), 10);
    expect(Math.sin(wrapped)).toBeCloseTo(Math.sin(raw), 10);
  });

  it('clamps a non-finite angle to a value the protocol accepts', () => {
    // Babylon can produce NaN if a rotation is ever fed a bad delta; NaN must
    // not reach the wire, because that too is a disconnect rather than a drop.
    expect(wrapYaw(Number.NaN)).toBe(0);
    expect(wrapYaw(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

/**
 * Pitch is clamped rather than wrapped: looking past straight up should stop
 * at straight up, not roll the camera over onto its back. Just short of
 * vertical, because exactly +/-90 degrees makes the view matrix's up vector
 * degenerate and the view rolls unpredictably.
 */
describe('clampPitch', () => {
  it('leaves an ordinary angle untouched', () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(0.5)).toBeCloseTo(0.5, 12);
    expect(clampPitch(-0.5)).toBeCloseTo(-0.5, 12);
  });

  it('stops at the limit instead of tipping over the top', () => {
    expect(clampPitch(Math.PI)).toBe(MAX_PITCH_RAD);
    expect(clampPitch(-Math.PI)).toBe(-MAX_PITCH_RAD);
  });

  it('never reaches exactly straight up or down', () => {
    expect(MAX_PITCH_RAD).toBeLessThan(Math.PI / 2);
    expect(clampPitch(1e9)).toBeLessThan(Math.PI / 2);
    expect(clampPitch(-1e9)).toBeGreaterThan(-Math.PI / 2);
  });

  it('clamps a non-finite angle to level', () => {
    expect(clampPitch(Number.NaN)).toBe(0);
    expect(clampPitch(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
