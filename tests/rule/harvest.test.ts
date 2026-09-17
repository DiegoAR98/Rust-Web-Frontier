import { describe, expect, it } from 'vitest';
import { harvestNode } from '@rwf/sim';
import type { ResourceNode } from '@rwf/sim';

describe('harvestNode', () => {
  it('grants the full per-hit yield while the node has enough remaining', () => {
    const node: ResourceNode = { nodeId: 'pile_1', remaining: 150 };

    const { node: after, result } = harvestNode(node, 10);

    expect(result.granted).toBe(10);
    expect(after.remaining).toBe(140);
  });

  it('clamps the final hit to whatever remains, never paying out more than the budget', () => {
    const node: ResourceNode = { nodeId: 'pile_1', remaining: 6 };

    const { node: after, result } = harvestNode(node, 10);

    expect(result.granted).toBe(6);
    expect(after.remaining).toBe(0);
  });

  it('grants nothing once depleted, so two racing hits can never double-pay the node', () => {
    const node: ResourceNode = { nodeId: 'pile_1', remaining: 10 };

    const { node: afterFirst, result: first } = harvestNode(node, 10);
    const { node: afterSecond, result: second } = harvestNode(afterFirst, 10);

    expect(first.granted + second.granted).toBe(10);
    expect(second.granted).toBe(0);
    expect(afterSecond.remaining).toBe(0);
  });
});
