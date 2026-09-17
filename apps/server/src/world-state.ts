import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Interest-scoped public replication state only (TECHNICAL section 3):
 * transforms and existence, never private inventory contents or account
 * secrets. Those travel through targeted messages instead.
 */
export const PlayerState = schema(
  {
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
    yaw: t.number().default(0),
    grounded: t.boolean().default(true),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const WorldItemState = schema(
  {
    definitionId: t.string().default(''),
    claimedBy: t.string().default(''),
  },
  'WorldItemState',
);
export type WorldItemState = SchemaType<typeof WorldItemState>;

export const WorldState = schema(
  {
    players: t.map(PlayerState),
    items: t.map(WorldItemState),
    tick: t.number().default(0),
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;
