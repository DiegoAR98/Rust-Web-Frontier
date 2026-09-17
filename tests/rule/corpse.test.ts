import { describe, expect, it } from 'vitest';
import { CORPSE_SLOTS, buildCorpse, pageOverflowIn, type ItemStack } from '@rwf/sim';

/**
 * GDD section 12: "Death atomically ... moves backpack, belt, worn gear,
 * loaded weapons and craft escrow into one corpse inventory ... Corpses hold
 * 40 slots plus a noninteractive overflow manifest that pages into those
 * slots as items are removed; overflow cannot be lost due to queued crafting."
 */

const LIMITS: Record<string, number> = { wood: 250, stone_hatchet: 1, rock: 1 };
const limitOf = (id: string) => LIMITS[id] ?? 1;

describe('corpse inventory (GDD section 12)', () => {
  it('holds everything the player was carrying in forty slots', () => {
    const carried: ItemStack[] = [
      { definitionId: 'wood', quantity: 120 },
      { definitionId: 'rock', quantity: 1 },
    ];

    const corpse = buildCorpse(carried, limitOf);

    expect(corpse.slots).toHaveLength(CORPSE_SLOTS);
    expect(corpse.overflow).toEqual([]);
    expect(corpse.slots.filter((s) => s?.definitionId === 'wood')).toEqual([
      { definitionId: 'wood', quantity: 120 },
    ]);
    expect(corpse.slots.filter((s) => s?.definitionId === 'rock')).toHaveLength(1);
  });

  it('merges the same item arriving from two places into one stack', () => {
    // The backpack's wood and the craft escrow's refunded wood are separate
    // sources; a corpse that kept them apart would waste slots a real death
    // needs.
    const corpse = buildCorpse(
      [
        { definitionId: 'wood', quantity: 100 },
        { definitionId: 'wood', quantity: 60 },
      ],
      limitOf,
    );

    expect(corpse.slots.filter((s) => s !== null)).toEqual([
      { definitionId: 'wood', quantity: 160 },
    ]);
  });

  it('splits a stack larger than the item stack limit across slots', () => {
    const corpse = buildCorpse([{ definitionId: 'wood', quantity: 300 }], limitOf);

    expect(corpse.slots.filter((s) => s !== null)).toEqual([
      { definitionId: 'wood', quantity: 250 },
      { definitionId: 'wood', quantity: 50 },
    ]);
    expect(corpse.overflow).toEqual([]);
  });

  it('holds what will not fit in the manifest instead of losing it', () => {
    // Forty-two unstackable hatchets: forty fit, two do not.
    const carried: ItemStack[] = Array.from({ length: 42 }, () => ({
      definitionId: 'stone_hatchet',
      quantity: 1,
    }));

    const corpse = buildCorpse(carried, limitOf);

    expect(corpse.slots.filter((s) => s !== null)).toHaveLength(CORPSE_SLOTS);
    expect(corpse.overflow).toEqual([
      { definitionId: 'stone_hatchet', quantity: 1 },
      { definitionId: 'stone_hatchet', quantity: 1 },
    ]);
  });

  it('pages the manifest in as slots are emptied', () => {
    const carried: ItemStack[] = Array.from({ length: 42 }, () => ({
      definitionId: 'stone_hatchet',
      quantity: 1,
    }));
    const corpse = buildCorpse(carried, limitOf);

    // A looter takes the contents of the first three slots.
    const looted = { ...corpse, slots: corpse.slots.map((s, i) => (i < 3 ? null : s)) };
    const paged = pageOverflowIn(looted, limitOf);

    expect(paged.overflow).toEqual([]);
    expect(paged.slots.filter((s) => s !== null)).toHaveLength(39);
  });

  it('pages in only as much as the freed room allows', () => {
    const carried: ItemStack[] = Array.from({ length: 45 }, () => ({
      definitionId: 'stone_hatchet',
      quantity: 1,
    }));
    const corpse = buildCorpse(carried, limitOf);
    expect(corpse.overflow).toHaveLength(5);

    const looted = { ...corpse, slots: corpse.slots.map((s, i) => (i < 2 ? null : s)) };
    const paged = pageOverflowIn(looted, limitOf);

    expect(paged.overflow).toHaveLength(3);
    expect(paged.slots.filter((s) => s !== null)).toHaveLength(CORPSE_SLOTS);
  });

  it('leaves the manifest untouched while every slot is still full', () => {
    const carried: ItemStack[] = Array.from({ length: 41 }, () => ({
      definitionId: 'stone_hatchet',
      quantity: 1,
    }));
    const corpse = buildCorpse(carried, limitOf);

    expect(pageOverflowIn(corpse, limitOf)).toEqual(corpse);
  });
});
