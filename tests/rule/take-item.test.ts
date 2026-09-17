import { describe, expect, it } from 'vitest';
import { takeItem } from '@rwf/sim';
import type { WorldItem } from '@rwf/sim';

describe('takeItem', () => {
  it('grants the item to the first claimant', () => {
    const items = new Map<string, WorldItem>([
      ['item_1', { instanceId: 'item_1', definitionId: 'wood', claimedBy: null }],
    ]);

    const result = takeItem(items, 'item_1', 'player_a');

    expect(result.outcome).toBe('taken');
    expect(items.get('item_1')?.claimedBy).toBe('player_a');
  });

  it('rejects a second claim on the same instance once taken, conserving exactly one grant', () => {
    const items = new Map<string, WorldItem>([
      ['item_1', { instanceId: 'item_1', definitionId: 'wood', claimedBy: null }],
    ]);

    const first = takeItem(items, 'item_1', 'player_a');
    const second = takeItem(items, 'item_1', 'player_b');

    expect(first.outcome).toBe('taken');
    expect(second.outcome).toBe('already_taken');
    expect(items.get('item_1')?.claimedBy).toBe('player_a');
  });

  it('reports not_found for a nonexistent or already-removed instance', () => {
    const items = new Map<string, WorldItem>();

    const result = takeItem(items, 'missing', 'player_a');

    expect(result.outcome).toBe('not_found');
  });
});
