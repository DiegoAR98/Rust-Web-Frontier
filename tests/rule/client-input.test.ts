import { describe, expect, it } from 'vitest';
import { computeMoveIntent, type KeyState } from '@rwf/client/input';

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
