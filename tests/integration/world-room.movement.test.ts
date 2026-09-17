import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { WALK_SPEED } from '@rwf/sim';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2601);
});

afterEach(async () => {
  await colyseus.cleanup();
});

afterAll(async () => {
  await colyseus.shutdown();
});

function moveCommand(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch: 1,
    sequence: 1,
    clientTick: 0,
    action: {
      type: 'move',
      axisX: 0,
      axisY: 1,
      yaw: 0,
      sprint: false,
      crouch: false,
      jump: false,
    },
    ...overrides,
  };
}

describe('WorldRoom movement (T01)', () => {
  it('replicates a freshly joined account to a DIFFERENT client, not just the server', async () => {
    const room = await colyseus.createRoom('world', {});
    const clientA = await colyseus.connectTo(room, { accountId: 'acct_a' });
    const clientB = await colyseus.connectTo(room, { accountId: 'acct_b' });
    await clientB.waitForNextPatch();

    // Read from clientB's own replicated view of the world, not room.state:
    // this is what a second real browser would actually see over the wire.
    expect(clientB.state.players.has('acct_a')).toBe(true);
    expect(clientB.state.players.has('acct_b')).toBe(true);
    expect(clientA.state.players.has('acct_b')).toBe(true);

    clientA.leave();
    clientB.leave();
  });

  it('replicates server-authoritative movement to a second browser, never trusting a client position', async () => {
    const room = await colyseus.createRoom('world', {});
    const mover = await colyseus.connectTo(room, { accountId: 'acct_a' });
    const observer = await colyseus.connectTo(room, { accountId: 'acct_b' });

    mover.send('command', moveCommand({ sessionEpoch: 1 }));
    await room.waitForNextTimestep();
    await room.waitForNextTimestep();
    await observer.waitForNextPatch();

    const observedMover = observer.state.players.get('acct_a');
    expect(observedMover).toBeDefined();
    expect(observedMover!.z).toBeGreaterThan(0);
    // Two 50ms ticks at WALK_SPEED bound the maximum legal displacement,
    // regardless of what the client claimed in its command.
    expect(observedMover!.z).toBeLessThanOrEqual(WALK_SPEED * 0.1 + 1e-6);

    mover.leave();
    observer.leave();
  });
});
