import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2603);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function takeItemCommand(sessionEpoch: number, itemInstanceId: string, sequence = 1) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'takeItem', itemInstanceId },
  };
}

describe('WorldRoom stale session rejection (T02)', () => {
  it('rejects a command carrying a session epoch a reconnect already replaced', async () => {
    const room = (await colyseus.createRoom('world', {})) as WorldRoom;
    room.spawnItem('item_1', 'wood');

    const first = await colyseus.connectTo(room, { accountId: 'acct_a' });
    const { sessionEpoch: staleEpoch } = await first.waitForMessage('session');
    // The old connection is not told to leave; it simply becomes a delayed
    // duplicate sender, exactly like a lagging packet from a dropped socket.

    const second = await colyseus.connectTo(room, { accountId: 'acct_a' });
    await second.waitForMessage('session');

    first.send('command', takeItemCommand(staleEpoch, 'item_1'));
    const result = await first.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('stale_session');

    await first.waitForNextPatch();
    expect(first.state.items.get('item_1')!.claimedBy).toBe('');

    first.leave();
    second.leave();
  });
});
