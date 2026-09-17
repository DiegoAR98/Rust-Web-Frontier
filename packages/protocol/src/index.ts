import { z } from 'zod';

export const PROTOCOL_VERSION = 1;

const finite = () => z.number().finite();

export const MoveIntentSchema = z.object({
  type: z.literal('move'),
  axisX: finite().min(-1).max(1),
  axisY: finite().min(-1).max(1),
  yaw: finite().min(-Math.PI).max(Math.PI),
  sprint: z.boolean(),
  crouch: z.boolean(),
  jump: z.boolean(),
});
export type MoveIntent = z.infer<typeof MoveIntentSchema>;

export const TakeItemIntentSchema = z.object({
  type: z.literal('takeItem'),
  itemInstanceId: z.string().min(1).max(64),
});
export type TakeItemIntent = z.infer<typeof TakeItemIntentSchema>;

export const HitNodeIntentSchema = z.object({
  type: z.literal('hitNode'),
  nodeId: z.string().min(1).max(64),
});
export type HitNodeIntent = z.infer<typeof HitNodeIntentSchema>;

export const CraftIntentSchema = z.object({
  type: z.literal('craft'),
  recipeId: z.string().min(1).max(64),
  // GDD section 9: each queue entry holds up to 100 identical recipe units.
  quantity: z.number().int().min(1).max(100),
});
export type CraftIntent = z.infer<typeof CraftIntentSchema>;

/** A melee swing at an animal (GDD section 7); reach and rate are the server's. */
export const AttackCreatureIntentSchema = z.object({
  type: z.literal('attackCreature'),
  creatureId: z.string().min(1).max(64),
});
export type AttackCreatureIntent = z.infer<typeof AttackCreatureIntentSchema>;

/** One of the four tool hits a carcass's harvest pool is paid over. */
export const HarvestCarcassIntentSchema = z.object({
  type: z.literal('harvestCarcass'),
  carcassId: z.string().min(1).max(64),
});
export type HarvestCarcassIntent = z.infer<typeof HarvestCarcassIntentSchema>;

/**
 * Starts a use channel (GDD section 6). Names the item, not a slot: the
 * channel consumes one of whatever the player is holding of that kind, and
 * which slot it came out of is the server's business.
 */
export const UseItemIntentSchema = z.object({
  type: z.literal('useItem'),
  definitionId: z.string().min(1).max(64),
});
export type UseItemIntent = z.infer<typeof UseItemIntentSchema>;

/**
 * Asks for a new body (GDD section 12). Carries nothing: where a respawning
 * player lands is the server's choice among authored anchors, never the
 * client's.
 */
export const RespawnIntentSchema = z.object({
  type: z.literal('respawn'),
});
export type RespawnIntent = z.infer<typeof RespawnIntentSchema>;

/**
 * Empties a corpse into the actor's pack (GDD section 8: "Any person who
 * reaches a box can open it"). Like stationTake it names no slot -- the
 * server moves whatever fits and leaves the rest on the body.
 */
export const CorpseTakeIntentSchema = z.object({
  type: z.literal('corpseTake'),
  corpseId: z.string().min(1).max(64),
});
export type CorpseTakeIntent = z.infer<typeof CorpseTakeIntentSchema>;

/**
 * Places a crafted deployable at a point (GDD section 10: "equip it and place
 * its ghost. A server-accepted placement consumes one item"). The client
 * proposes where; the server checks reach, spacing and the caps, and is the
 * only thing that decides whether it happens.
 */
export const PlaceDeployableIntentSchema = z.object({
  type: z.literal('placeDeployable'),
  definitionId: z.string().min(1).max(64),
  x: finite(),
  y: finite(),
  z: finite(),
});
export type PlaceDeployableIntent = z.infer<typeof PlaceDeployableIntentSchema>;

/**
 * Places a structural piece at a grid site (GDD section 10). The site is named
 * in grid terms rather than metres because a piece is snapped: a position
 * would have to be reverse-engineered back into a cell, and rounding at a cell
 * boundary would decide which one. The server still checks that the builder
 * can reach it.
 */
export const PlaceBuildingPieceIntentSchema = z.object({
  type: z.literal('placeBuildingPiece'),
  definitionId: z.string().min(1).max(64),
  form: z.enum(['foundation', 'pillar', 'wall', 'doorway', 'ceiling']),
  // Bounded so a forged command cannot ask for a site at 1e300 and make the
  // server carry the number around.
  storey: z.number().int().min(0).max(16),
  i: z.number().int().min(-4096).max(4096),
  k: z.number().int().min(-4096).max(4096),
  axis: z.enum(['x', 'z']).nullable(),
});
export type PlaceBuildingPieceIntent = z.infer<typeof PlaceBuildingPieceIntentSchema>;

const containerId = () => z.string().min(1).max(64);

/** Moves items from the pack into a placed container (GDD section 8). */
export const ContainerInsertIntentSchema = z.object({
  type: z.literal('containerInsert'),
  containerId: containerId(),
  definitionId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(250),
});
export type ContainerInsertIntent = z.infer<typeof ContainerInsertIntentSchema>;

/** Empties a placed container into the pack, as far as it fits. */
export const ContainerTakeIntentSchema = z.object({
  type: z.literal('containerTake'),
  containerId: containerId(),
});
export type ContainerTakeIntent = z.infer<typeof ContainerTakeIntentSchema>;

const stationId = () => z.string().min(1).max(64);

/**
 * Moves items between the player's pack and a station (CONTENT section 3).
 * The destination slot is not named: no station in this baseline accepts wood
 * as an input, so wood can only mean the fuel slot and an ore or a raw food
 * can only mean an input slot. The server routes it.
 */
export const StationInsertIntentSchema = z.object({
  type: z.literal('stationInsert'),
  stationId: stationId(),
  definitionId: z.string().min(1).max(64),
  // One insert moves at most one stack; CONTENT section 1's largest is 250.
  quantity: z.number().int().min(1).max(250),
});
export type StationInsertIntent = z.infer<typeof StationInsertIntentSchema>;

export const StationTakeIntentSchema = z.object({
  type: z.literal('stationTake'),
  stationId: stationId(),
});
export type StationTakeIntent = z.infer<typeof StationTakeIntentSchema>;

export const StationLightIntentSchema = z.object({
  type: z.literal('stationLight'),
  stationId: stationId(),
  lit: z.boolean(),
});
export type StationLightIntent = z.infer<typeof StationLightIntentSchema>;

export const ActionPayloadSchema = z.discriminatedUnion('type', [
  MoveIntentSchema,
  TakeItemIntentSchema,
  HitNodeIntentSchema,
  CraftIntentSchema,
  StationInsertIntentSchema,
  StationTakeIntentSchema,
  StationLightIntentSchema,
  AttackCreatureIntentSchema,
  HarvestCarcassIntentSchema,
  UseItemIntentSchema,
  RespawnIntentSchema,
  CorpseTakeIntentSchema,
  PlaceDeployableIntentSchema,
  PlaceBuildingPieceIntentSchema,
  ContainerInsertIntentSchema,
  ContainerTakeIntentSchema,
]);
export type ActionPayload = z.infer<typeof ActionPayloadSchema>;

export const CommandSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionEpoch: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  clientTick: z.number().int().nonnegative(),
  action: ActionPayloadSchema,
});
export type Command = z.infer<typeof CommandSchema>;

export const REASON_CODES = [
  'ok',
  'stale_session',
  'invalid_schema',
  'duplicate_sequence',
  'out_of_range',
  'rate_limited',
  'not_found',
  'already_taken',
  'depleted',
  'insufficient_resources',
  // The actor has the items; the destination has nowhere to put them.
  // Distinct from insufficient_resources so a UI can say which it is.
  'no_space',
  'busy',
  // GDD section 12 marks the account dead: it has no live character to act
  // with until it respawns.
  'dead',
  // ...and a living player has no death to recover from.
  'not_dead',
  // GDD section 10's placement refusals, kept apart so the ghost can say
  // which rule it broke rather than just turning red.
  'overlap',
  'cap_reached',
  // GDD section 10's support rules: nothing holds this site up.
  'unsupported',
  // The actor is not the building's owner or an authorised builder.
  'forbidden',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface CommandResult {
  sequence: number;
  accepted: boolean;
  reasonCode: ReasonCode;
  serverTick: number;
  affectedRevisions?: Record<string, number>;
}
