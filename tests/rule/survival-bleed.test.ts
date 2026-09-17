import { describe, expect, it } from 'vitest';
import { applyBleedWound, cancelChannel, progressChannel, startChannel, tickBleed } from '@rwf/sim';

describe('applyBleedWound (T08 - no additive bleed exploit)', () => {
  it('starts a fresh wound at the given rate and duration', () => {
    const wound = applyBleedWound(null, 1, 10);
    expect(wound).toEqual({ ratePerS: 1, remainingS: 10 });
  });

  it('a repeat wound of the same rate does not stack, only refreshes duration', () => {
    const first = applyBleedWound(null, 1, 10);
    const second = applyBleedWound(first, 1, 10);
    expect(second.ratePerS).toBe(1); // not 2
  });

  it('a repeat wound takes the maximum rate, not the sum', () => {
    const arrowWound = applyBleedWound(null, 1, 10); // arrow/bullet: 1 HP/s
    const meleeWound = applyBleedWound(arrowWound, 0.5, 10); // melee: 0.5 HP/s
    expect(meleeWound.ratePerS).toBe(1);
  });

  it('a repeat wound takes the latest (longer) expiry', () => {
    const wound = applyBleedWound(null, 1, 3);
    const refreshed = applyBleedWound(wound, 1, 10);
    expect(refreshed.remainingS).toBe(10);
  });
});

describe('tickBleed', () => {
  it('deals damage at the wound rate and counts down remaining duration', () => {
    const { wound, damage } = tickBleed({ ratePerS: 1, remainingS: 10 }, 1);
    expect(damage).toBe(1);
    expect(wound?.remainingS).toBe(9);
  });

  it('expires the wound once remaining duration reaches zero', () => {
    const { wound } = tickBleed({ ratePerS: 1, remainingS: 1 }, 1);
    expect(wound).toBeNull();
  });

  it('deals no damage once there is no active wound', () => {
    expect(tickBleed(null, 1)).toEqual({ wound: null, damage: 0 });
  });
});

describe('medical use channel (T08 - cancel consumes nothing)', () => {
  it('does not complete before its duration elapses', () => {
    const channel = startChannel(2);
    const result = progressChannel(channel, 1);
    expect(result.completed).toBe(false);
    expect(result.channel).not.toBeNull();
  });

  it('completes exactly when elapsed time reaches the channel duration', () => {
    let channel = startChannel(2);
    channel = progressChannel(channel, 1).channel!;
    const result = progressChannel(channel, 1);
    expect(result.completed).toBe(true);
    expect(result.channel).toBeNull();
  });

  it('a channel cancelled by damage before completion consumes nothing and cannot be resumed', () => {
    const channel = startChannel(2);
    const midway = progressChannel(channel, 1).channel!;
    const cancelled = cancelChannel(midway);
    expect(cancelled).toBeNull();
  });
});
