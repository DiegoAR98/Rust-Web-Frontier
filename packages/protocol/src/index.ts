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
  'busy',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface CommandResult {
  sequence: number;
  accepted: boolean;
  reasonCode: ReasonCode;
  serverTick: number;
  affectedRevisions?: Record<string, number>;
}
