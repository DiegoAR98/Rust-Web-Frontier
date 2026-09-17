import { Room, type Client } from '@colyseus/core';
import { CommandSchema, type Command, type CommandResult } from '@rwf/protocol';
import {
  beginSession,
  commitOutcome,
  isSessionActive,
  stepMovement,
  takeItem as simTakeItem,
  type MovementState,
  type SessionRegistry,
  type TransactionLog,
  type WorldItem,
} from '@rwf/sim';
import { PlayerState, WorldItemState, WorldState } from './world-state.js';

/** Matches TECHNICAL section 3's simulation budget: 20 fixed ticks/s. */
const TICK_RATE_HZ = 20;

interface ClientUserData {
  accountId: string;
  sessionEpoch: number;
}

type RoomClient = Client<{ userData: ClientUserData }>;
type MoveAction = Extract<Command['action'], { type: 'move' }>;

export class WorldRoom extends Room<{ state: WorldState; client: RoomClient }> {
  private readonly sessionRegistry: SessionRegistry = { currentEpoch: new Map() };
  private readonly transactionLog: TransactionLog<CommandResult> = { committed: new Map() };
  private readonly worldItems = new Map<string, WorldItem>();
  private readonly movementByAccount = new Map<string, MovementState>();
  private readonly pendingMove = new Map<string, MoveAction>();

  onCreate(): void {
    // TECHNICAL section 17: the world keeps running even when nobody is
    // connected. It is stopped only by stopping the host process.
    this.autoDispose = false;
    this.state = new WorldState();

    this.onMessage('command', CommandSchema, (client, command) => {
      this.handleCommand(client, command);
    });

    this.setFixedTimestep((ctx) => this.tick(ctx.dt), TICK_RATE_HZ);
  }

  /** Seeds a world item for tests/tools; not a player-facing command. */
  spawnItem(instanceId: string, definitionId: string): void {
    this.worldItems.set(instanceId, { instanceId, definitionId, claimedBy: null });
    const item = new WorldItemState();
    item.definitionId = definitionId;
    this.state.items.set(instanceId, item);
  }

  onJoin(client: RoomClient, options: { accountId?: string }): void {
    const accountId = options?.accountId;
    if (!accountId) {
      throw new Error('accountId is required to join the world');
    }

    const sessionEpoch = beginSession(this.sessionRegistry, accountId);
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
    if (command.sessionEpoch !== sessionEpoch || !isSessionActive(this.sessionRegistry, accountId, command.sessionEpoch)) {
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

    const itemInstanceId = command.action.itemInstanceId;
    const key = { accountId, sessionEpoch: command.sessionEpoch, sequence: command.sequence };
    const result = commitOutcome<CommandResult>(this.transactionLog, key, () =>
      this.resolveTakeItem(accountId, itemInstanceId, command.sequence),
    );
    client.send('commandResult', result);
  }

  private resolveTakeItem(accountId: string, itemInstanceId: string, sequence: number): CommandResult {
    const outcome = simTakeItem(this.worldItems, itemInstanceId, accountId);
    const base = { sequence, serverTick: this.state.tick };
    if (outcome.outcome === 'taken') {
      const stateItem = this.state.items.get(itemInstanceId);
      if (stateItem) {
        stateItem.claimedBy = accountId;
      }
      return { ...base, accepted: true, reasonCode: 'ok' };
    }
    return { ...base, accepted: false, reasonCode: outcome.outcome };
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
  }
}
