import { describe, expect, it } from 'vitest';
import { ITEMS, getItem, validateItemCatalog } from '@rwf/content';

describe('item catalog (CONTENT section 1)', () => {
  it('has exactly 68 individually listed item definitions', () => {
    expect(ITEMS.length).toBe(68);
  });

  it('has no duplicate IDs', () => {
    const ids = new Set(ITEMS.map((i) => i.id));
    expect(ids.size).toBe(ITEMS.length);
  });

  it('gives every item a positive integer stack size', () => {
    for (const item of ITEMS) {
      expect(Number.isInteger(item.stack)).toBe(true);
      expect(item.stack).toBeGreaterThan(0);
    }
  });

  it('resolves a known item by ID', () => {
    expect(getItem('wood')).toMatchObject({ id: 'wood', stack: 250 });
  });

  it('returns undefined for an unknown ID rather than throwing', () => {
    expect(getItem('does_not_exist')).toBeUndefined();
  });

  it('marks every durable item (condition-bearing) as non-stacking', () => {
    for (const id of ['stone_hatchet', 'iron_hatchet', 'pickaxe', 'bow', 'revolver', 'coach_gun', 'repeater', 'carbine', 'precision_rifle', 'pipe_gun']) {
      expect(getItem(id)?.durable).toBe(true);
      expect(getItem(id)?.stack).toBe(1);
    }
  });

  it('spot-checks a few stack sizes and acquisitions against CONTENT section 1', () => {
    expect(getItem('cloth')).toMatchObject({ stack: 100 });
    expect(getItem('raw_meat')).toMatchObject({ stack: 20 });
    expect(getItem('bandage')).toMatchObject({ stack: 10 });
    expect(getItem('blood_kit')).toMatchObject({ stack: 1 });
    expect(getItem('gate')).toMatchObject({ stack: 10 });
  });
});

describe('validateItemCatalog (CONTENT section 10 reject-list)', () => {
  it('accepts the real catalog', () => {
    expect(() => validateItemCatalog(ITEMS)).not.toThrow();
  });

  it('rejects a nonpositive stack', () => {
    expect(() => validateItemCatalog([{ id: 'x', displayName: 'X', stack: 0, durable: false }])).toThrow();
  });

  it('rejects a duplicate ID', () => {
    const dupe = [
      { id: 'x', displayName: 'X', stack: 1, durable: false },
      { id: 'x', displayName: 'X2', stack: 1, durable: false },
    ];
    expect(() => validateItemCatalog(dupe)).toThrow();
  });
});
