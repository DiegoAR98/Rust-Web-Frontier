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

export const ActionPayloadSchema = z.discriminatedUnion('type', [
  MoveIntentSchema,
  TakeItemIntentSchema,
  HitNodeIntentSchema,
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
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export interface CommandResult {
  sequence: number;
  accepted: boolean;
  reasonCode: ReasonCode;
  serverTick: number;
  affectedRevisions?: Record<string, number>;
}
