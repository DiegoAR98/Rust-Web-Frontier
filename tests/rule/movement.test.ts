import { describe, expect, it } from 'vitest';
import { GRAVITY, JUMP_SPEED, SPRINT_SPEED, WALK_SPEED, stepMovement } from '@rwf/sim';
import type { MovementState } from '@rwf/sim';

function grounded(overrides: Partial<MovementState> = {}): MovementState {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocityY: 0,
    grounded: true,
    ...overrides,
  };
}

function idleInput(overrides: Record<string, unknown> = {}) {
  return {
    axisX: 0,
    axisY: 0,
    yaw: 0,
    sprint: false,
    crouch: false,
    jump: false,
    ...overrides,
  };
}

describe('stepMovement', () => {
  it('walks forward exactly WALK_SPEED meters per second', () => {
    const next = stepMovement(grounded(), idleInput({ axisY: 1 }), 1);
    expect(Math.hypot(next.position.x, next.position.z)).toBeCloseTo(WALK_SPEED, 5);
  });

  it('never exceeds the max legal speed for a diagonal input, forged or not', () => {
    // A forged/naive client might send axisX=1, axisY=1 hoping for sqrt(2)x speed.
    const next = stepMovement(grounded(), idleInput({ axisX: 1, axisY: 1, sprint: true }), 1);
    const distance = Math.hypot(next.position.x, next.position.z);
    expect(distance).toBeLessThanOrEqual(SPRINT_SPEED + 1e-9);
  });

  it('sprinting moves at SPRINT_SPEED', () => {
    const next = stepMovement(grounded(), idleInput({ axisY: 1, sprint: true }), 1);
    expect(Math.hypot(next.position.x, next.position.z)).toBeCloseTo(SPRINT_SPEED, 5);
  });

  it('crouching overrides sprint and moves at the slower crouch speed', () => {
    const next = stepMovement(grounded(), idleInput({ axisY: 1, sprint: true, crouch: true }), 1);
    expect(Math.hypot(next.position.x, next.position.z)).toBeLessThan(WALK_SPEED);
  });

  it('jumping launches upward at JUMP_SPEED then falls back under gravity', () => {
    const afterJump = stepMovement(grounded(), idleInput({ jump: true }), 0.01);
    expect(afterJump.velocityY).toBeCloseTo(JUMP_SPEED - GRAVITY * 0.01, 5);
    expect(afterJump.grounded).toBe(false);
  });

  it('cannot jump again while airborne', () => {
    const airborne = grounded({ grounded: false, velocityY: 2, position: { x: 0, y: 1, z: 0 } });
    const next = stepMovement(airborne, idleInput({ jump: true }), 0.01);
    expect(next.velocityY).toBeCloseTo(2 - GRAVITY * 0.01, 5);
  });

  it('lands and zeroes vertical velocity when falling back to ground level', () => {
    const falling = grounded({ grounded: false, velocityY: -1, position: { x: 0, y: 0.001, z: 0 } });
    const next = stepMovement(falling, idleInput(), 1);
    expect(next.position.y).toBe(0);
    expect(next.grounded).toBe(true);
    expect(next.velocityY).toBe(0);
  });
});
