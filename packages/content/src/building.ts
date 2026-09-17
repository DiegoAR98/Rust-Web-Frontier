/**
 * The structural pieces a player can craft and snap into the grid.
 * Transcribed from CONTENT section 7's catalog table; the support rules that
 * decide where each may go are GDD section 10's, in @rwf/sim.
 *
 * Wood only, and only the five forms CONTENT's 1x1 cabin needs. The metal tier
 * is Learn/Bench and there is no research system; windows, stairs, ramps and
 * steps arrive with the verticals that make them reachable.
 */
export interface BuildingPieceDefinition {
  id: string;
  /** Matches PieceForm in @rwf/sim; the grid decides where each form may go. */
  form: 'foundation' | 'pillar' | 'wall' | 'doorway' | 'ceiling';
  placedHp: number;
  /**
   * CONTENT section 7's "Combat immune" column. GDD section 10 calls it
   * deliberate: "Foundation and pillar combat immunity is intentional."
   */
  combatImmune: boolean;
}

export const BUILDING_PIECES: BuildingPieceDefinition[] = [
  { id: 'wood_foundation', form: 'foundation', placedHp: 2000, combatImmune: true },
  { id: 'wood_pillar', form: 'pillar', placedHp: 1000, combatImmune: true },
  { id: 'wood_wall', form: 'wall', placedHp: 1000, combatImmune: false },
  { id: 'wood_doorway', form: 'doorway', placedHp: 1000, combatImmune: false },
  { id: 'wood_ceiling', form: 'ceiling', placedHp: 1000, combatImmune: false },
];

export function getBuildingPiece(id: string): BuildingPieceDefinition | undefined {
  return BUILDING_PIECES.find((piece) => piece.id === id);
}
