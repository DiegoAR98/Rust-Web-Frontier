import { describe, expect, it } from 'vitest';
import { CREATURE_SPECS, PATHING_GIVE_UP_S, spawnCreature, stepCreature, type CreatureState } from '@rwf/sim';

const ORIGIN = { x: 0, y: 0, z: 0 };

function at(x: number, z: number) {
  return { x, y: 0, z };
}

function creature(kind: 'deer' | 'wolf', overrides: Partial<CreatureState> = {}): CreatureState {
  return { ...spawnCreature(kind, ORIGIN), ...overrides };
}

/**
 * GDD section 7: "Animals use simple wander/flee/chase/attack/return states.
 * Prey flee when approached or hurt; predators detect by sight, proximity and
 * loud noise." CONTENT section 4 supplies every number.
 */
describe('creature specs (CONTENT section 4)', () => {
  it('matches the catalog for the two starting creatures', () => {
    expect(CREATURE_SPECS.deer.health).toBe(60);
    expect(CREATURE_SPECS.deer.speed).toBe(6.5);
    expect(CREATURE_SPECS.deer.attack).toBeNull(); // deer have no "Hit / interval"
    expect(CREATURE_SPECS.deer.harvest).toEqual({ raw_meat: 8, cloth: 8, hide: 4, fat: 4 });

    expect(CREATURE_SPECS.wolf.health).toBe(100);
    expect(CREATURE_SPECS.wolf.speed).toBe(6);
    expect(CREATURE_SPECS.wolf.attack).toEqual({ damage: 15, intervalS: 1.5 });
    expect(CREATURE_SPECS.wolf.harvest).toEqual({ raw_meat: 6, cloth: 6, hide: 8, fat: 4 });
    expect(CREATURE_SPECS.wolf.leashRange).toBe(80); // "Aggressive, leashes at 80 m"
  });

  it('uses the notice ranges GDD section 7 sets per role', () => {
    expect(CREATURE_SPECS.wolf.noticeRange).toBe(25); // "Predator notice range 25 m"
    expect(CREATURE_SPECS.deer.noticeRange).toBe(20); // "Prey notice range 20 m"
  });
});

describe('stepCreature: predators (GDD section 7)', () => {
  it('ignores a player beyond its notice range', () => {
    const wolf = creature('wolf');
    const { state } = stepCreature(wolf, CREATURE_SPECS.wolf, at(30, 0), 1);

    expect(state.mode).toBe('wander');
    expect(state.position).toEqual(ORIGIN);
  });

  it('chases a player inside its notice range, at its own speed', () => {
    const wolf = creature('wolf');
    const { state } = stepCreature(wolf, CREATURE_SPECS.wolf, at(20, 0), 1);

    expect(state.mode).toBe('chase');
    expect(state.position.x).toBeCloseTo(6, 5); // one second at 6 m/s
    expect(state.position.z).toBeCloseTo(0, 5);
  });

  it('never overshoots the player it is chasing', () => {
    const wolf = creature('wolf', { position: at(3, 0) });
    const { state } = stepCreature(wolf, CREATURE_SPECS.wolf, at(4, 0), 1);

    // 6 m/s would carry it 6 m past a player 1 m away.
    expect(state.position.x).toBeLessThanOrEqual(4);
  });

  it('bites once it is in melee reach, then waits out its interval', () => {
    const wolf = creature('wolf', { position: at(1, 0) });
    const first = stepCreature(wolf, CREATURE_SPECS.wolf, at(2, 0), 0.05);

    expect(first.state.mode).toBe('attack');
    expect(first.attackDamage).toBe(15);

    // CONTENT section 4: "15 / 1.5 s". A second bite one tick later would be
    // 20 bites a second.
    const second = stepCreature(first.state, CREATURE_SPECS.wolf, at(2, 0), 0.05);
    expect(second.attackDamage).toBe(0);
  });

  it('bites again once the interval has elapsed', () => {
    let state = creature('wolf', { position: at(1, 0) });
    let bites = 0;
    for (let i = 0; i < 40; i++) {
      const result = stepCreature(state, CREATURE_SPECS.wolf, at(2, 0), 0.05);
      state = result.state;
      if (result.attackDamage > 0) bites += 1;
    }
    // Two seconds at one bite per 1.5s: the opening bite and one more.
    expect(bites).toBe(2);
  });

  it('gives up and heads home once it is dragged past its leash', () => {
    // CONTENT section 4: wolves leash at 80 m. Without this a wolf follows a
    // player across the whole map.
    const wolf = creature('wolf', { position: at(90, 0), mode: 'chase' });
    const { state } = stepCreature(wolf, CREATURE_SPECS.wolf, at(91, 0), 1);

    expect(state.mode).toBe('return');
    expect(state.position.x).toBeLessThan(90); // moving back toward the anchor
  });

  it('settles back to wandering when it reaches its anchor', () => {
    const wolf = creature('wolf', { position: at(0.2, 0), mode: 'return' });
    const { state } = stepCreature(wolf, CREATURE_SPECS.wolf, null, 1);

    expect(state.mode).toBe('wander');
  });
});

describe('stepCreature: prey (GDD section 7)', () => {
  it('flees a player who comes too close, rather than closing in', () => {
    const deer = creature('deer', { position: at(5, 0) });
    const { state } = stepCreature(deer, CREATURE_SPECS.deer, at(0, 0), 1);

    expect(state.mode).toBe('flee');
    expect(state.position.x).toBeCloseTo(11.5, 5); // 5 + one second at 6.5 m/s
  });

  it('never attacks, even standing on top of a player', () => {
    const deer = creature('deer', { position: at(0.5, 0) });
    const { attackDamage } = stepCreature(deer, CREATURE_SPECS.deer, at(0, 0), 1);

    expect(attackDamage).toBe(0);
  });

  it('flees a player it cannot see after being hurt', () => {
    // GDD section 7: "Prey flee when approached or hurt". A deer shot from
    // 30 m away has to run, not graze.
    const deer = creature('deer', { position: at(0, 0), alarmS: 5 });
    const { state } = stepCreature(deer, CREATURE_SPECS.deer, at(30, 0), 1);

    expect(state.mode).toBe('flee');
    expect(state.position.x).toBeCloseTo(-6.5, 5); // directly away
    expect(state.alarmS).toBeCloseTo(4, 5);
  });

  it('goes home once it is calm again', () => {
    const deer = creature('deer', { position: at(10, 0), mode: 'flee' });
    const { state } = stepCreature(deer, CREATURE_SPECS.deer, null, 1);

    expect(state.mode).toBe('return');
    expect(state.position.x).toBeCloseTo(3.5, 5); // 10 - one second at 6.5 m/s
  });
});

/**
 * GDD section 7: "if pathfinding fails for 5 seconds, retreat rather than
 * teleport or hit through geometry." Before walls existed there was nothing
 * for a path to fail against, so this went unwritten. Now a wall stops an
 * animal, and without the rule a base collects a permanent collar of wolves
 * pressed against it -- unable to reach you and unwilling to leave.
 */
describe('stepCreature: an animal that cannot get at its target (GDD section 7)', () => {
  const blocked = (state: CreatureState, target: { x: number; y: number; z: number }, dt: number) =>
    stepCreature(state, CREATURE_SPECS.wolf, target, dt, false);

  it('keeps trying for the first few seconds', () => {
    const wolf = creature('wolf', { position: at(0, 0) });
    const step = blocked(wolf, at(0, 10), PATHING_GIVE_UP_S - 1);
    expect(step.state.mode).toBe('chase');
    expect(step.state.position.z).toBeGreaterThan(0);
  });

  it('gives up and heads home once the path has failed for five seconds', () => {
    const wolf = creature('wolf', { position: at(0, 10), anchor: at(0, 0) });
    const step = blocked(wolf, at(0, 12), PATHING_GIVE_UP_S);
    expect(step.state.mode).toBe('return');
    expect(step.state.position.z).toBeLessThan(10);
  });

  it('stays given up while the wall is still there', () => {
    // Otherwise it flips back to chase on the very next tick and the collar
    // of frozen wolves comes straight back.
    let wolf = creature('wolf', { position: at(0, 10), anchor: at(0, 0) });
    for (let i = 0; i < 200; i += 1) wolf = blocked(wolf, at(0, 12), 1 / 20).state;
    expect(wolf.mode).toBe('return');
  });

  it('takes up the chase again the moment the way is clear', () => {
    let wolf = creature('wolf', { position: at(0, 10), anchor: at(0, 0) });
    for (let i = 0; i < 200; i += 1) wolf = blocked(wolf, at(0, 12), 1 / 20).state;
    const step = stepCreature(wolf, CREATURE_SPECS.wolf, at(0, 12), 1 / 20, true);
    expect(step.state.mode).toBe('chase');
  });

  it('does not bite through the wall it is standing against', () => {
    // "rather than ... hit through geometry". The swing is spent either way:
    // CONTENT section 4's interval is a rate of attacking, not of connecting.
    const wolf = creature('wolf', { position: at(0, 0) });
    const step = blocked(wolf, at(0, 1), 1 / 20);
    expect(step.state.mode).toBe('attack');
    expect(step.attackDamage).toBe(0);
    expect(step.state.attackCooldownS).toBe(CREATURE_SPECS.wolf.attack!.intervalS);
  });

  it('still bites when nothing is in the way', () => {
    const wolf = creature('wolf', { position: at(0, 0) });
    expect(stepCreature(wolf, CREATURE_SPECS.wolf, at(0, 1), 1 / 20, true).attackDamage).toBe(15);
  });
});
