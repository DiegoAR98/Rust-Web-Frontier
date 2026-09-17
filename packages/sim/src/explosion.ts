/**
 * CONTENT section 8's explosive economy and structural damage multipliers.
 * The satchel item and its crafting chain are M3; the numbers and the rules
 * they drive are here because T12 gates the maths, not the recipe.
 */

export interface ExplosiveSpec {
  /** "Contact structure damage" at the surface. */
  contactDamage: number;
  /** Where the structural splash has fallen to zero. */
  splashRadiusM: number;
  /** What it does to a person standing on it. */
  characterDamage: number;
  /**
   * Character damage is flat inside this radius and falls off outside it:
   * CONTENT section 8 reads "100 at <=1 m, linear to 0 at 4 m".
   */
  characterFullRadiusM: number;
  characterRadiusM: number;
}

/**
 * CONTENT section 8: "powder_bomb ... 100 | satchel ... 600", and "Structural
 * splash is the contact amount scaled linearly to zero at 3 m for satchels and
 * 4 m for bombs".
 */
export const EXPLOSIVES: Record<'powder_bomb' | 'satchel', ExplosiveSpec> = {
  powder_bomb: {
    contactDamage: 100,
    splashRadiusM: 4,
    characterDamage: 80,
    characterFullRadiusM: 1,
    characterRadiusM: 5,
  },
  satchel: {
    contactDamage: 600,
    splashRadiusM: 3,
    characterDamage: 100,
    characterFullRadiusM: 1,
    // Deliberately wider than the structural splash: CONTENT gives the two
    // different radii, so a charge that cannot reach the wall behind you can
    // still kill you.
    characterRadiusM: 4,
  },
};

/**
 * CONTENT section 8: "Tools deal their base melee damage x0.5 to wood and
 * x0.05 to metal; bullets/arrows deal base damage x0.1 to wood and x0.02 to
 * metal."
 */
export const STRUCTURE_MELEE_MULTIPLIER = { wood: 0.5, metal: 0.05 } as const;
export const STRUCTURE_PROJECTILE_MULTIPLIER = { wood: 0.1, metal: 0.02 } as const;

export type StructureMaterial = 'wood' | 'metal';

export function structuralMeleeDamage(baseDamage: number, material: StructureMaterial): number {
  return baseDamage * STRUCTURE_MELEE_MULTIPLIER[material];
}

/**
 * How much a structure this far from the blast centre takes. Linear to zero at
 * the splash radius; a charge attached to its target is at distance 0 and takes
 * the full contact amount, which is CONTENT's "A directly attached satchel uses
 * full 600 damage on its target".
 */
export function structuralSplashDamage(spec: ExplosiveSpec, distanceM: number): number {
  if (distanceM >= spec.splashRadiusM) return 0;
  return spec.contactDamage * (1 - distanceM / spec.splashRadiusM);
}

/**
 * What a person this far from the blast takes (CONTENT section 8: "100 at
 * <=1 m, linear to 0 at 4 m"). Flat inside the full radius rather than
 * spiking, so standing exactly on a charge is no worse than standing beside
 * it -- which is what the "at <=1 m" in the table says.
 */
export function characterBlastDamage(spec: ExplosiveSpec, distanceM: number): number {
  if (distanceM <= spec.characterFullRadiusM) return spec.characterDamage;
  if (distanceM >= spec.characterRadiusM) return 0;
  const span = spec.characterRadiusM - spec.characterFullRadiusM;
  return spec.characterDamage * (1 - (distanceM - spec.characterFullRadiusM) / span);
}

/**
 * T12's "minimum contact satchels": how many charges at full contact damage a
 * full-health barrier needs. Rounded up, because a fraction of a satchel is
 * not a thing a raider can bring.
 */
export function chargesToBreak(maxHealth: number, contactDamage: number): number {
  return Math.ceil(maxHealth / contactDamage);
}
