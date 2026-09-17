import { Room, type Client } from '@colyseus/core';
import { CommandSchema, type Command, type CommandResult } from '@rwf/protocol';
import { getItem } from '@rwf/content';
import {
  addToInventory,
  harvestNode,
  stepMovement,
  takeItem as simTakeItem,
  type MovementState,
  type ResourceNode,
  type Slot,
  type WorldItem,
} from '@rwf/sim';
import { WorldStore } from './persistence.js';
import { PlayerState, WorldItemState, WorldState } from './world-state.js';

/** Matches TECHNICAL section 3's simulation budget: 20 fixed ticks/s. */
const TICK_RATE_HZ = 20;
/** TECHNICAL section 7: continuous state checkpoints every 5 seconds. */
export const CHECKPOINT_INTERVAL_TICKS = 5 * TICK_RATE_HZ;
/** GDD section 8: 24 backpack slots per player. */
const BACKPACK_SLOTS = 24;
/**
 * Per-resource gather rate (CONTENT section 4). Keyed by the resource
 * produced rather than a node-type ID: today every node producing a given
 * resource shares one rate. Revisit with a real node-type lookup once a
 * second node type yields the same resource at a different rate (e.g.
 * standing_tree vs wood_pile both yielding wood).
 */
const DEFAULT_YIELD_PER_HIT: Record<string, number> = { wood: 10 };

interface ClientUserData {
  accountId: string;
  sessionEpoch: number;
}

interface NodeConfig {
  definitionId: string;
  yieldPerHit: number;
}

type RoomClient = Client<{ userData: ClientUserData }>;
type MoveAction = Extract<Command['action'], { type: 'move' }>;

export class WorldRoom extends Room<{ state: WorldState; client: RoomClient }> {
  private store!: WorldStore;
  private readonly worldItems = new Map<string, WorldItem>();
  private readonly movementByAccount = new Map<string, MovementState>();
  private readonly pendingMove = new Map<string, MoveAction>();
  private readonly resourceNodes = new Map<string, ResourceNode>();
  private readonly nodeConfigs = new Map<string, NodeConfig>();
  private readonly playerSlots = new Map<string, Slot[]>();

  onCreate(): void {
    // TECHNICAL section 17: the world keeps running even when nobody is
    // connected. It is stopped only by stopping the host process.
    this.autoDispose = false;
    // dbPath deliberately never comes from room-creation options: those
    // are reachable from a real client's joinOrCreate() call (see
    // MatchMaker's merge(clientOptions, handler.options)), and TECHNICAL
    // section 10 is explicit: never evaluate a client-supplied filesystem
    // path. Only the server process's own environment controls this.
    this.store = new WorldStore(process.env.RWF_DB_PATH ?? ':memory:');
    this.state = new WorldState();

    // Crash recovery (TECHNICAL section 7): resume from the last
    // checkpoint rather than starting a fresh world.
    this.state.tick = this.store.loadWorldTick();
    for (const [accountId, transform] of this.store.loadPlayerCheckpoints()) {
      const player = new PlayerState();
      player.x = transform.x;
      player.y = transform.y;
      player.z = transform.z;
      player.yaw = transform.yaw;
      player.grounded = transform.grounded;
      this.state.players.set(accountId, player);
      this.movementByAccount.set(accountId, {
        position: { x: transform.x, y: transform.y, z: transform.z },
        velocityY: 0,
        grounded: transform.grounded,
      });
    }
    for (const [instanceId, claim] of this.store.loadItemClaims()) {
      this.worldItems.set(instanceId, {
        instanceId,
        definitionId: claim.definitionId,
        claimedBy: claim.claimedBy,
      });
      const item = new WorldItemState();
      item.definitionId = claim.definitionId;
      item.claimedBy = claim.claimedBy ?? '';
      this.state.items.set(instanceId, item);
    }
    for (const [nodeId, node] of this.store.loadNodeStates()) {
      this.resourceNodes.set(nodeId, { nodeId, remaining: node.remaining });
      this.nodeConfigs.set(nodeId, {
        definitionId: node.definitionId,
        yieldPerHit: DEFAULT_YIELD_PER_HIT[node.definitionId] ?? 0,
      });
    }

    // Seed the M0/M1 proof-of-mechanism content on a genuinely fresh world
    // only -- never re-seed over a restored (possibly claimed/depleted)
    // item or node, which the restore loops above already populated.
    if (!this.worldItems.has('item_1')) {
      this.spawnItem('item_1', 'wood');
    }
    if (!this.resourceNodes.has('node_1')) {
      this.spawnNode('node_1', 'wood', 150, 10); // CONTENT section 4: wood pile
    }

    this.onMessage('command', CommandSchema, (client, command) => {
      this.handleCommand(client, command);
    });

    this.setFixedTimestep((ctx) => this.tick(ctx.dt), TICK_RATE_HZ);
  }

  onDispose(): void {
    this.checkpoint();
    this.store.close();
  }

  /** Persists the tick counter and every known player's transform. Public for tests/ops. */
  checkpoint(): void {
    this.store.saveWorldTick(this.state.tick);
    for (const [accountId, movement] of this.movementByAccount) {
      this.store.savePlayerCheckpoint(accountId, {
        x: movement.position.x,
        y: movement.position.y,
        z: movement.position.z,
        yaw: this.state.players.get(accountId)?.yaw ?? 0,
        grounded: movement.grounded,
      });
    }
  }

  /** Seeds a world item for tests/tools; not a player-facing command. */
  spawnItem(instanceId: string, definitionId: string): void {
    this.worldItems.set(instanceId, { instanceId, definitionId, claimedBy: null });
    this.store.saveItemClaim(instanceId, definitionId, null);
    const item = new WorldItemState();
    item.definitionId = definitionId;
    this.state.items.set(instanceId, item);
  }

  /** Seeds a gatherable resource node for tests/tools; not a player-facing command. */
  spawnNode(nodeId: string, definitionId: string, totalBudget: number, yieldPerHit: number): void {
    this.resourceNodes.set(nodeId, { nodeId, remaining: totalBudget });
    this.nodeConfigs.set(nodeId, { definitionId, yieldPerHit });
    this.store.saveNodeState(nodeId, definitionId, totalBudget);
  }

  onJoin(client: RoomClient, options: { accountId?: string }): void {
    const accountId = options?.accountId;
    if (!accountId) {
      throw new Error('accountId is required to join the world');
    }

    const sessionEpoch = this.store.beginSession(accountId);
    client.userData = { accountId, sessionEpoch };
    // Deferred one tick: sending synchronously from onJoin can race the
    // client SDK's own post-join message listener registration.
    this.clock.setTimeout(() => client.send('session', { sessionEpoch }), 0);

    if (!this.state.players.has(accountId)) {
      // Fresh player: spawn kit position, GDD section 5's ground level.
      this.state.players.set(accountId, new PlayerState());
      this.movementByAccount.set(accountId, {
        position: { x: 0, y: 0, z: 0 },
        velocityY: 0,
        grounded: true,
      });
    }
    // Reconnecting to an existing accountId resumes the same body: the
    // schema entry and movementByAccount state are left untouched.

    if (!this.playerSlots.has(accountId)) {
      this.playerSlots.set(accountId, this.store.loadPlayerSlots(accountId, BACKPACK_SLOTS));
    }
    // Private per TECHNICAL section 3: inventory contents never ride the
    // shared replicated schema. Sent the same tick as 'session' for the
    // same reason (avoid racing the client's post-join listener setup).
    this.clock.setTimeout(() => client.send('inventory', { slots: this.playerSlots.get(accountId) }), 0);
  }

  onLeave(client: RoomClient): void {
    const accountId = client.userData?.accountId;
    if (accountId) {
      this.pendingMove.delete(accountId);
    }
    // The player entity stays in state.players and movementByAccount: a
    // disconnect leaves a sleeper (GDD section 12), not a removed entity.
  }

  private handleCommand(client: RoomClient, command: Command): void {
    if (!client.userData) return;
    const { accountId, sessionEpoch } = client.userData;
    if (command.sessionEpoch !== sessionEpoch || !this.store.isSessionActive(accountId, command.sessionEpoch)) {
      // A delayed packet from a session a reconnect already replaced.
      const result: CommandResult = {
        sequence: command.sequence,
        accepted: false,
        reasonCode: 'stale_session',
        serverTick: this.state.tick,
      };
      client.send('commandResult', result);
      return;
    }

    if (command.action.type === 'move') {
      this.pendingMove.set(accountId, command.action);
      return;
    }

    const key = { accountId, sessionEpoch: command.sessionEpoch, sequence: command.sequence };

    if (command.action.type === 'takeItem') {
      const itemInstanceId = command.action.itemInstanceId;
      const encoded = this.store.commitOutcome(key, () =>
        JSON.stringify(this.resolveTakeItem(accountId, itemInstanceId, command.sequence)),
      );
      client.send('commandResult', JSON.parse(encoded) as CommandResult);
      return;
    }

    const nodeId = command.action.nodeId;
    const encoded = this.store.commitOutcome(key, () =>
      JSON.stringify(this.resolveHitNode(accountId, nodeId, command.sequence)),
    );
    client.send('commandResult', JSON.parse(encoded) as CommandResult);
    // The inventory changed (or didn't) as a side effect of resolveHitNode;
    // tell the owner their current contents either way, same as takeItem's
    // commandResult tells them the outcome of their own action.
    client.send('inventory', { slots: this.playerSlots.get(accountId) });
  }

  private resolveTakeItem(accountId: string, itemInstanceId: string, sequence: number): CommandResult {
    const outcome = simTakeItem(this.worldItems, itemInstanceId, accountId);
    const base = { sequence, serverTick: this.state.tick };
    if (outcome.outcome === 'taken') {
      const stateItem = this.state.items.get(itemInstanceId);
      if (stateItem) {
        stateItem.claimedBy = accountId;
        this.store.saveItemClaim(itemInstanceId, stateItem.definitionId, accountId);
      }
      return { ...base, accepted: true, reasonCode: 'ok' };
    }
    return { ...base, accepted: false, reasonCode: outcome.outcome };
  }

  private resolveHitNode(accountId: string, nodeId: string, sequence: number): CommandResult {
    const base = { sequence, serverTick: this.state.tick };
    const node = this.resourceNodes.get(nodeId);
    const config = this.nodeConfigs.get(nodeId);
    if (!node || !config) {
      return { ...base, accepted: false, reasonCode: 'not_found' };
    }

    const { node: nextNode, result } = harvestNode(node, config.yieldPerHit);
    this.resourceNodes.set(nodeId, nextNode);
    this.store.saveNodeState(nodeId, config.definitionId, nextNode.remaining);

    if (result.granted <= 0) {
      return { ...base, accepted: false, reasonCode: 'depleted' };
    }

    const stackLimit = getItem(config.definitionId)?.stack ?? 1;
    const currentSlots = this.playerSlots.get(accountId) ?? new Array(BACKPACK_SLOTS).fill(null);
    const { slots: nextSlots } = addToInventory(currentSlots, config.definitionId, result.granted, stackLimit);
    this.playerSlots.set(accountId, nextSlots);
    this.store.savePlayerSlots(accountId, nextSlots);

    return { ...base, accepted: true, reasonCode: 'ok' };
  }

  private tick(dt: number): void {
    this.state.tick += 1;

    for (const [accountId, action] of this.pendingMove) {
      const movement = this.movementByAccount.get(accountId);
      const player = this.state.players.get(accountId);
      if (!movement || !player) continue;

      const next = stepMovement(movement, action, dt);
      this.movementByAccount.set(accountId, next);

      player.x = next.position.x;
      player.y = next.position.y;
      player.z = next.position.z;
      player.yaw = action.yaw;
      player.grounded = next.grounded;
    }

    if (this.state.tick % CHECKPOINT_INTERVAL_TICKS === 0) {
      this.checkpoint();
    }
  }
}
