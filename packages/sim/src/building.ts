import type { Point3 } from './wildlife.js';

/** GDD section 10: "Grid cells are 4 m square and 3 m high with four corner pillars." */
export const CELL_SIZE_M = 4;
export const STOREY_HEIGHT_M = 3;
/** GDD section 10: "Build height is six storeys." Storeys are counted from 0. */
export const MAX_STOREYS = 6;
/** GDD section 10: "max 400 structural pieces ... per owner". */
export const PIECES_PER_OWNER = 400;
/** GDD section 10: "max 1000 pieces in one connected building". */
export const PIECES_PER_BUILDING = 1000;

/**
 * The forms a cabin needs. CONTENT section 7 also gives windows, stairs,
 * ramps and steps; each arrives with the vertical that makes it reachable,
 * the way the large crate did.
 */
export type PieceForm = 'foundation' | 'pillar' | 'wall' | 'doorway' | 'ceiling';

/** Which of a cell's two edge directions a wall spans. */
export type EdgeAxis = 'x' | 'z';

/**
 * Where a piece goes, in grid terms rather than metres. Cells and corners
 * share the integer lattice: cell (i,k) has corners (i,k), (i+1,k), (i,k+1)
 * and (i+1,k+1), and edge (i,k,'x') runs from corner (i,k) to corner (i+1,k).
 *
 * Deliberately not a position. A piece is snapped, so a float triple would
 * have to be reverse-engineered back into a cell, and rounding at a cell
 * boundary is a whole bug class that simply does not exist if the client
 * names the site.
 */
export interface PieceSite {
  form: PieceForm;
  storey: number;
  i: number;
  k: number;
  /** Walls and doorways only; null for everything that sits on a cell or corner. */
  axis: EdgeAxis | null;
}

export type SiteRefusal = 'occupied' | 'unsupported' | 'too_high';

export function siteKey(site: PieceSite): string {
  // Walls and doorways share the edge lattice, so they share a key space: a
  // doorway and a wall cannot occupy the same edge.
  const slot = site.form === 'wall' || site.form === 'doorway' ? 'edge' : site.form;
  return `${slot}:${site.storey}:${site.i}:${site.k}:${site.axis ?? '-'}`;
}

/** The four cells that meet at corner (i,k). */
function cellsAtCorner(i: number, k: number): Array<{ i: number; k: number }> {
  return [
    { i: i - 1, k: k - 1 },
    { i, k: k - 1 },
    { i: i - 1, k },
    { i, k },
  ];
}

/** The two corners a wall on this edge spans. */
function cornersOfEdge(site: PieceSite): Array<{ i: number; k: number }> {
  return site.axis === 'x'
    ? [
        { i: site.i, k: site.k },
        { i: site.i + 1, k: site.k },
      ]
    : [
        { i: site.i, k: site.k },
        { i: site.i, k: site.k + 1 },
      ];
}

/** The four corners of a cell, in the order a ceiling needs them. */
function cornersOfCell(i: number, k: number): Array<{ i: number; k: number }> {
  return [
    { i, k },
    { i: i + 1, k },
    { i, k: k + 1 },
    { i: i + 1, k: k + 1 },
  ];
}

interface SupportRequirement {
  keys: string[];
  /** 'any' -- a pillar will hang off whichever one of them exists. */
  mode: 'any' | 'all';
}

function supportRequirement(site: PieceSite): SupportRequirement {
  if (site.form === 'foundation') {
    // "Foundations anchor to permitted terrain" -- nothing holds them up.
    return { keys: [], mode: 'all' };
  }
  if (site.form === 'pillar') {
    // "pillars attach to foundation or supported ceiling corners"
    const below = site.storey === 0 ? 'foundation' : 'ceiling';
    const storey = site.storey === 0 ? 0 : site.storey - 1;
    return {
      keys: cellsAtCorner(site.i, site.k).map((cell) =>
        siteKey({ form: below, storey, i: cell.i, k: cell.k, axis: null }),
      ),
      mode: 'any',
    };
  }
  if (site.form === 'ceiling') {
    // "Ceilings require four pillars below."
    return {
      keys: cornersOfCell(site.i, site.k).map((corner) =>
        siteKey({ form: 'pillar', storey: site.storey, i: corner.i, k: corner.k, axis: null }),
      ),
      mode: 'all',
    };
  }
  // "Walls, doorways and windows require the two adjacent pillars."
  return {
    keys: cornersOfEdge(site).map((corner) =>
      siteKey({ form: 'pillar', storey: site.storey, i: corner.i, k: corner.k, axis: null }),
    ),
    mode: 'all',
  };
}

/**
 * Whether a piece may be placed here (GDD section 10's support rules), given
 * the keys of everything already standing. Returns the refusal, or null when
 * the site is legal.
 */
export function validatePieceSite(site: PieceSite, placed: ReadonlySet<string>): SiteRefusal | null {
  if (placed.has(siteKey(site))) return 'occupied';
  if (site.storey < 0 || site.storey >= MAX_STOREYS) return 'too_high';
  if (site.form === 'foundation') {
    return site.storey === 0 ? null : 'unsupported';
  }

  const { keys, mode } = supportRequirement(site);
  const satisfied =
    mode === 'any' ? keys.some((key) => placed.has(key)) : keys.every((key) => placed.has(key));
  return satisfied ? null : 'unsupported';
}

/**
 * Everything this site is structurally attached to. Used to work out which
 * connected building a piece belongs to, which section 10 needs twice: for
 * "only a building owner or explicit builder can attach to its grid" and for
 * the 1000-pieces-per-building cap.
 *
 * Derived rather than stored: a cluster id would go stale the moment a
 * collapse splits a building in two.
 *
 * A foundation links to all eight neighbouring foundation cells. Sharing an
 * edge and sharing a corner are both 0 m apart, so both are attachments -- and
 * that makes "not adjacent" and section 10's "at least 1 m from any existing
 * foundation edge" the same test, since one clear cell is 4 m.
 */
export function linkedSiteKeys(site: PieceSite): string[] {
  if (site.form !== 'foundation') {
    return supportRequirement(site).keys;
  }
  const links: string[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dk = -1; dk <= 1; dk++) {
      if (di === 0 && dk === 0) continue;
      links.push(siteKey({ form: 'foundation', storey: site.storey, i: site.i + di, k: site.k + dk, axis: null }));
    }
  }
  return links;
}

/** Where a site actually is, for drawing it and for measuring reach to it. */
export function worldPositionOf(site: PieceSite): Point3 {
  const y = site.storey * STOREY_HEIGHT_M;
  if (site.form === 'foundation') {
    return { x: (site.i + 0.5) * CELL_SIZE_M, y, z: (site.k + 0.5) * CELL_SIZE_M };
  }
  if (site.form === 'ceiling') {
    // The top of its storey: a ceiling is also the floor above it.
    return { x: (site.i + 0.5) * CELL_SIZE_M, y: y + STOREY_HEIGHT_M, z: (site.k + 0.5) * CELL_SIZE_M };
  }
  if (site.form === 'pillar') {
    return { x: site.i * CELL_SIZE_M, y, z: site.k * CELL_SIZE_M };
  }
  // Midway along the edge it spans, halfway up the storey.
  return site.axis === 'x'
    ? { x: (site.i + 0.5) * CELL_SIZE_M, y: y + STOREY_HEIGHT_M / 2, z: site.k * CELL_SIZE_M }
    : { x: site.i * CELL_SIZE_M, y: y + STOREY_HEIGHT_M / 2, z: (site.k + 0.5) * CELL_SIZE_M };
}
