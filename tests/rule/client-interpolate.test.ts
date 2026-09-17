import { describe, expect, it } from 'vitest';
import { interpolateTransform, type Transform } from '@rwf/client/interpolate';

describe('interpolateTransform', () => {
  it('returns the starting transform at alpha 0', () => {
    const from: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
    const to: Transform = { x: 10, y: 0, z: 10, yaw: 1 };
    expect(interpolateTransform(from, to, 0)).toEqual(from);
  });

  it('returns the target transform at alpha 1', () => {
    const from: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
    const to: Transform = { x: 10, y: 0, z: 10, yaw: 1 };
    expect(interpolateTransform(from, to, 1)).toEqual(to);
  });

  it('linearly blends position at the midpoint', () => {
    const from: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
    const to: Transform = { x: 10, y: 4, z: -10, yaw: 0 };
    expect(interpolateTransform(from, to, 0.5)).toEqual({ x: 5, y: 2, z: -5, yaw: 0 });
  });

  it('takes the short way around the wraparound boundary instead of spinning the long way', () => {
    const from: Transform = { x: 0, y: 0, z: 0, yaw: 3.0 };
    const to: Transform = { x: 0, y: 0, z: 0, yaw: -3.0 };
    // The short arc from 3.0 to -3.0 crosses +/-pi, not through 0.
    const result = interpolateTransform(from, to, 0.5);
    expect(Math.abs(result.yaw)).toBeGreaterThan(3.0);
  });

  it('clamps alpha outside 0..1', () => {
    const from: Transform = { x: 0, y: 0, z: 0, yaw: 0 };
    const to: Transform = { x: 10, y: 0, z: 0, yaw: 0 };
    expect(interpolateTransform(from, to, -1)).toEqual(from);
    expect(interpolateTransform(from, to, 2)).toEqual(to);
  });
});
