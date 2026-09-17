import { CELL_SIZE_M, type PieceForm, type PieceSite } from '@rwf/sim';

/**
 * Turns the point the player is aiming at into the grid site they meant
 * (GDD section 10 snaps every structural piece). Only the ground plane
 * matters: every form the cabin needs sits on storey 0, and there are no
 * stairs to reach a second one with.
 *
 * The client picks the site and names it; it never sends a position, so
 * nothing downstream has to guess which cell a float belonged to.
 */
export function snapToSite(form: PieceForm, aim: { x: number; z: number }): PieceSite {
  const cx = aim.x / CELL_SIZE_M;
  const cz = aim.z / CELL_SIZE_M;

  if (form === 'foundation' || form === 'ceiling') {
    // Floor, not truncation: truncating toward zero folds cells -1..1 into
    // one, and a base built west of the origin fights itself.
    return { form, storey: 0, i: Math.floor(cx), k: Math.floor(cz), axis: null };
  }

  if (form === 'pillar') {
    return { form, storey: 0, i: Math.round(cx), k: Math.round(cz), axis: null };
  }

  // A wall goes on the nearest of the containing cell's four edges.
  const i = Math.floor(cx);
  const k = Math.floor(cz);
  const fx = cx - i;
  const fz = cz - k;
  const candidates: Array<{ distance: number; site: PieceSite }> = [
    { distance: fz, site: { form, storey: 0, i, k, axis: 'x' } },
    { distance: 1 - fz, site: { form, storey: 0, i, k: k + 1, axis: 'x' } },
    { distance: fx, site: { form, storey: 0, i, k, axis: 'z' } },
    { distance: 1 - fx, site: { form, storey: 0, i: i + 1, k, axis: 'z' } },
  ];
  return candidates.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best)).site;
}
