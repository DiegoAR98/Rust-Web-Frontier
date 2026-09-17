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

/**
 * Animals and their carcasses are public: everyone in the world can see where
 * a wolf is and that a deer is dead. Only the carcass's remaining harvest pool
 * stays off the state, since that is container contents (TECHNICAL section 3).
 */
export const CreatureState = schema(
  {
    kind: t.string().default(''),
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
    health: t.number().default(0),
    mode: t.string().default('wander'),
  },
  'CreatureState',
);
export type CreatureState = SchemaType<typeof CreatureState>;

export const CarcassState = schema(
  {
    kind: t.string().default(''),
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
    hitsUsed: t.number().default(0),
  },
  'CarcassState',
);
export type CarcassState = SchemaType<typeof CarcassState>;

export const WorldState = schema(
  {
    players: t.map(PlayerState),
    items: t.map(WorldItemState),
    creatures: t.map(CreatureState),
    carcasses: t.map(CarcassState),
    tick: t.number().default(0),
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;
