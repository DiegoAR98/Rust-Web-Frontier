import { describe, expect, it } from 'vitest';
import {
  EXPLOSIVES,
  STRUCTURE_MELEE_MULTIPLIER,
  chargesToBreak,
  characterBlastDamage,
  structuralMeleeDamage,
  structuralSplashDamage,
} from '@rwf/sim';

/**
 * CONTENT section 8: "satchel | 8 s ... | Contact structure damage 600" and
 * "Structural splash is the contact amount scaled linearly to zero at 3 m for
 * satchels and 4 m for bombs, subject to pre-explosion occlusion."
 */
describe('explosive structural damage (CONTENT section 8)', () => {
  it('gives a satchel its full contact damage at the surface', () => {
    expect(structuralSplashDamage(EXPLOSIVES.satchel, 0)).toBe(600);
  });

  it('falls linearly to nothing at the splash radius', () => {
    const { satchel } = EXPLOSIVES;
    expect(structuralSplashDamage(satchel, satchel.splashRadiusM / 2)).toBe(300);
    expect(structuralSplashDamage(satchel, satchel.splashRadiusM)).toBe(0);
    expect(structuralSplashDamage(satchel, satchel.splashRadiusM + 1)).toBe(0);
  });

  it('gives a powder bomb a wider but weaker blast', () => {
    const { powder_bomb: bomb } = EXPLOSIVES;
    expect(bomb.splashRadiusM).toBeGreaterThan(EXPLOSIVES.satchel.splashRadiusM);
    expect(structuralSplashDamage(bomb, 0)).toBe(100);
    expect(structuralSplashDamage(bomb, 2)).toBe(50);
  });

  /** T12: "Minimum contact satchels 1/2/2/4" for the four named pieces. */
  it('matches CONTENT s stated satchel counts for every barrier it names', () => {
    const satchel = EXPLOSIVES.satchel.contactDamage;
    // "At full health and contact: wood door 1 satchel, wood wall/ceiling or
    // metal door 2, metal wall/ceiling 4."
    expect(chargesToBreak(500, satchel)).toBe(1); // wood_door
    expect(chargesToBreak(1000, satchel)).toBe(2); // wood wall/ceiling
    expect(chargesToBreak(1000, satchel)).toBe(2); // metal_door, same HP
    expect(chargesToBreak(2000, satchel)).toBe(4); // metal wall/ceiling
  });

  it('never claims a barrier can be broken with no charges at all', () => {
    expect(chargesToBreak(1, EXPLOSIVES.satchel.contactDamage)).toBe(1);
  });
});

/** CONTENT section 8's character damage column: "100 at <=1 m, linear to 0 at 4 m". */
describe('explosive damage to people (CONTENT section 8)', () => {
  it('gives a satchel its full character damage anywhere inside a metre', () => {
    expect(characterBlastDamage(EXPLOSIVES.satchel, 0)).toBe(100);
    expect(characterBlastDamage(EXPLOSIVES.satchel, 1)).toBe(100);
  });

  it('falls away between one metre and four', () => {
    // Halfway along the 1 m to 4 m span.
    expect(characterBlastDamage(EXPLOSIVES.satchel, 2.5)).toBe(50);
    expect(characterBlastDamage(EXPLOSIVES.satchel, 4)).toBe(0);
    expect(characterBlastDamage(EXPLOSIVES.satchel, 10)).toBe(0);
  });

  it('reaches people further than it reaches walls', () => {
    // CONTENT gives the two radii separately: 3 m structural, 4 m character.
    // A charge that cannot touch the wall behind you can still kill you.
    const { satchel } = EXPLOSIVES;
    expect(satchel.characterRadiusM).toBeGreaterThan(satchel.splashRadiusM);
    expect(structuralSplashDamage(satchel, 3.5)).toBe(0);
    expect(characterBlastDamage(satchel, 3.5)).toBeGreaterThan(0);
  });

  it('gives a powder bomb the wider, weaker version', () => {
    expect(characterBlastDamage(EXPLOSIVES.powder_bomb, 0)).toBe(80);
    expect(characterBlastDamage(EXPLOSIVES.powder_bomb, 5)).toBe(0);
  });
});

/**
 * CONTENT section 8: "Tools deal their base melee damage x0.5 to wood and
 * x0.05 to metal ... Armor does not apply to structures."
 */
describe('melee damage against a structure (CONTENT section 8)', () => {
  it('halves a tool s damage against wood', () => {
    expect(structuralMeleeDamage(10, 'wood')).toBe(5);
    expect(STRUCTURE_MELEE_MULTIPLIER.wood).toBe(0.5);
  });

  it('makes a tool nearly useless against metal', () => {
    // A 2000 HP metal wall at 0.5 a swing is 4000 swings: the rule is what
    // makes explosives the way in rather than patience.
    expect(structuralMeleeDamage(10, 'metal')).toBeCloseTo(0.5, 6);
  });
});
