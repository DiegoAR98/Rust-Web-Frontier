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

/**
 * A dead player's body (GDD section 12). Its existence and position are
 * public -- a corpse is something anyone can walk up to and loot -- while its
 * contents stay off the schema like every other container (TECHNICAL
 * section 3). The owner rides along so a player can recognise their own body.
 */
export const CorpseState = schema(
  {
    ownerAccountId: t.string().default(''),
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
  },
  'CorpseState',
);
export type CorpseState = SchemaType<typeof CorpseState>;

/**
 * A placed deployable (GDD section 10). Existence, position, owner and health
 * are public -- a crate is something anyone can walk up to, and section 8 is
 * explicit that "boxes are not magically private". Its contents are not here:
 * they travel as targeted messages like every other container (TECHNICAL
 * section 3). The owner is carried for the per-owner cap and for decay, not
 * for access control.
 */
export const DeployableState = schema(
  {
    definitionId: t.string().default(''),
    ownerAccountId: t.string().default(''),
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
    health: t.number().default(0),
  },
  'DeployableState',
);
export type DeployableState = SchemaType<typeof DeployableState>;

export const WorldState = schema(
  {
    players: t.map(PlayerState),
    items: t.map(WorldItemState),
    creatures: t.map(CreatureState),
    carcasses: t.map(CarcassState),
    corpses: t.map(CorpseState),
    deployables: t.map(DeployableState),
    tick: t.number().default(0),
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;
