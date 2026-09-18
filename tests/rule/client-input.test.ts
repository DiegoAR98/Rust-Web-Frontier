import { describe, expect, it } from 'vitest';
import { NO_JUMP, computeMoveIntent, pressJump, releaseJump, takeJump, type KeyState } from '@rwf/client/input';

function keys(overrides: Partial<KeyState> = {}): KeyState {
  return {
    forward: false,
    back: false,
    left: false,
    right: false,
    sprint: false,
    crouch: false,
    jump: false,
    ...overrides,
  };
}

describe('computeMoveIntent', () => {
  it('maps forward to a positive Y axis', () => {
    expect(computeMoveIntent(keys({ forward: true }))).toMatchObject({ axisX: 0, axisY: 1 });
  });

  it('maps back to a negative Y axis', () => {
    expect(computeMoveIntent(keys({ back: true }))).toMatchObject({ axisX: 0, axisY: -1 });
  });

  it('cancels forward and back held together', () => {
    expect(computeMoveIntent(keys({ forward: true, back: true }))).toMatchObject({ axisY: 0 });
  });

  it('maps right to a positive X axis and left to negative', () => {
    expect(computeMoveIntent(keys({ right: true }))).toMatchObject({ axisX: 1 });
    expect(computeMoveIntent(keys({ left: true }))).toMatchObject({ axisX: -1 });
  });

  it('cancels left and right held together', () => {
    expect(computeMoveIntent(keys({ left: true, right: true }))).toMatchObject({ axisX: 0 });
  });

  it('passes sprint, crouch and jump through unchanged', () => {
    const intent = computeMoveIntent(keys({ sprint: true, crouch: true, jump: true }));
    expect(intent.sprint).toBe(true);
    expect(intent.crouch).toBe(true);
    expect(intent.jump).toBe(true);
  });
});

/**
 * Move intent is sampled on a 20 Hz timer, not per frame, so a press and
 * release that both happen inside one 50 ms window is never sent at all -- the
 * key was down for none of the samples. On a 144 Hz display that is seven
 * frames of holding space and no jump, which reads as the game ignoring you.
 */
describe('holding on to a tapped jump until it has been sent', () => {
  it('sends nothing when the key was never touched', () => {
    expect(takeJump(NO_JUMP).jump).toBe(false);
  });

  it('keeps jumping while the key is held', () => {
    // stepMovement only jumps a grounded player, so a held space bounces --
    // which is how it already behaved and is not what this changes.
    const held = pressJump(NO_JUMP);
    const first = takeJump(held);
    expect(first.jump).toBe(true);
    expect(takeJump(first.next).jump).toBe(true);
  });

  it('sends a tap that began and ended between two samples', () => {
    const tapped = releaseJump(pressJump(NO_JUMP));
    expect(takeJump(tapped).jump).toBe(true);
  });

  it('spends that tap exactly once', () => {
    // Or one press buys a jump on every sample until the player touches the
    // key again, which is worse than dropping it.
    const tapped = releaseJump(pressJump(NO_JUMP));
    const first = takeJump(tapped);
    expect(first.jump).toBe(true);
    expect(takeJump(first.next).jump).toBe(false);
  });
});
