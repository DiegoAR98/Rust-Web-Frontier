import { describe, expect, it } from 'vitest';
import { RESPAWN_ENEMY_CLEARANCE_M, chooseRespawnAnchor, type RespawnAnchor } from '@rwf/sim';

/**
 * GDD section 12: "Random respawn selects a valid Coyote Wash or Juniper
 * perimeter anchor, preferring one at least 75 m from active enemies and
 * outside structures/hazards. If none are safe, use the least exposed valid
 * anchor, communicate that the world is dangerous, and never spawn inside
 * collision."
 */

const anchors: RespawnAnchor[] = [
  { id: 'wash_n', position: { x: 0, y: 0, z: 0 } },
  { id: 'wash_s', position: { x: 100, y: 0, z: 0 } },
  { id: 'juniper_e', position: { x: 400, y: 0, z: 0 } },
];

describe('respawn anchor selection (GDD section 12)', () => {
  it('spawns nowhere when the world authored no anchors', () => {
    expect(chooseRespawnAnchor([], [], () => 0)).toBeNull();
  });

  it('treats every anchor as safe in an empty world', () => {
    const chosen = chooseRespawnAnchor(anchors, [], () => 0);

    expect(chosen!.safe).toBe(true);
    expect(chosen!.anchor.id).toBe('wash_n');
  });

  it('never drops a respawning player next to an enemy while a clear anchor exists', () => {
    // Someone is camping wash_n; wash_s is 100 m away from them and juniper_e
    // is further still.
    const enemies = [{ x: 0, y: 0, z: 0 }];

    for (const roll of [0, 0.4, 0.99]) {
      const chosen = chooseRespawnAnchor(anchors, enemies, () => roll);
      expect(chosen!.safe).toBe(true);
      expect(['wash_s', 'juniper_e']).toContain(chosen!.anchor.id);
    }
  });

  it('spreads its choice across the safe anchors rather than always picking one', () => {
    const enemies = [{ x: 0, y: 0, z: 0 }];

    expect(chooseRespawnAnchor(anchors, enemies, () => 0)!.anchor.id).toBe('wash_s');
    expect(chooseRespawnAnchor(anchors, enemies, () => 0.99)!.anchor.id).toBe('juniper_e');
  });

  it('measures the clearance at exactly 75 m as safe', () => {
    const enemies = [{ x: RESPAWN_ENEMY_CLEARANCE_M, y: 0, z: 0 }];
    const single: RespawnAnchor[] = [{ id: 'wash_n', position: { x: 0, y: 0, z: 0 } }];

    expect(chooseRespawnAnchor(single, enemies, () => 0)!.safe).toBe(true);
  });

  it('falls back to the least exposed anchor and says the world is dangerous', () => {
    // An enemy 10 m from wash_n, another 30 m from wash_s, a third 50 m from
    // juniper_e: no anchor has its 75 m, so the furthest-from-trouble wins.
    const enemies = [
      { x: 10, y: 0, z: 0 },
      { x: 130, y: 0, z: 0 },
      { x: 450, y: 0, z: 0 },
    ];

    const chosen = chooseRespawnAnchor(anchors, enemies, () => 0);

    expect(chosen!.safe).toBe(false);
    expect(chosen!.anchor.id).toBe('juniper_e');
  });

  it('is deterministic when every anchor is equally exposed', () => {
    const enemies = [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 400, y: 0, z: 0 },
    ];

    // A tie must not depend on the roll: an unsafe fallback is a decision
    // about exposure, not a lottery.
    expect(chooseRespawnAnchor(anchors, enemies, () => 0)!.anchor.id).toBe('wash_n');
    expect(chooseRespawnAnchor(anchors, enemies, () => 0.99)!.anchor.id).toBe('wash_n');
  });
});
