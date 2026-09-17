import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import appConfig from '@rwf/server/app.config';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { CELL_SIZE_M } from '@rwf/sim';
import type { WorldRoom } from '@rwf/server/world-room';

let colyseus: ColyseusTestServer;
let dir: string;

beforeAll(async () => {
  colyseus = await boot(appConfig, 2630);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rwf-build-'));
  process.env.RWF_DB_PATH = join(dir, 'world.sqlite');
});

afterEach(async () => {
  await colyseus.cleanup();
  delete process.env.RWF_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await colyseus.shutdown();
});

let sequence = 0;
function command(action: Record<string, unknown>, sessionEpoch = 1) {
  sequence += 1;
  return { protocolVersion: PROTOCOL_VERSION, sessionEpoch, sequence, clientTick: 0, action };
}

const CELL = { i: 10, k: 10 };
const CENTRE = { x: (CELL.i + 0.5) * CELL_SIZE_M, y: 0, z: (CELL.k + 0.5) * CELL_SIZE_M };

function placePiece(definitionId: string, form: string, i: number, k: number, sessionEpoch = 1) {
  return command({ type: 'placeBuildingPiece', definitionId, form, storey: 0, i, k, axis: null }, sessionEpoch);
}

/** T04's "placement" case again, for structural pieces rather than a crate. */
describe('WorldRoom buildings across a restart (T04, GDD section 10)', () => {
  it('leaves the foundation and its pillar standing', async () => {
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const client = await colyseus.connectTo(first, { accountId: 'acct_mason' });
    await client.waitForMessage('session');
    first.clearInventoryForTest('acct_mason');
    first.teleportForTest('acct_mason', CENTRE);
    first.grantForTest('acct_mason', 'wood_foundation', 1);
    first.grantForTest('acct_mason', 'wood_pillar', 1);

    client.send('command', placePiece('wood_foundation', 'foundation', CELL.i, CELL.k));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    client.send('command', placePiece('wood_pillar', 'pillar', CELL.i, CELL.k));
    expect((await client.waitForMessage('commandResult')).accepted).toBe(true);
    // Deliberately no checkpoint(): a placement is class-1.

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;

    expect(second.state.buildingPieces.size).toBe(2);
    const pieces = [...second.state.buildingPieces.values()];
    expect(pieces.map((p) => p.form).sort()).toEqual(['foundation', 'pillar']);
    expect(pieces.every((p) => p.ownerAccountId === 'acct_mason')).toBe(true);
    expect(pieces.find((p) => p.form === 'foundation')!.health).toBe(2000);
  });

  it('still knows whose building it is, so a stranger still cannot attach to it', async () => {
    // The ownership check walks the structural links. Those are rebuilt at
    // load; if they were not, a restart would silently open every base in the
    // world to anyone standing next to it.
    const first = (await colyseus.createRoom('world', {})) as WorldRoom;
    const owner = await colyseus.connectTo(first, { accountId: 'acct_keeper' });
    await owner.waitForMessage('session');
    first.clearInventoryForTest('acct_keeper');
    first.teleportForTest('acct_keeper', CENTRE);
    first.grantForTest('acct_keeper', 'wood_foundation', 1);
    owner.send('command', placePiece('wood_foundation', 'foundation', CELL.i, CELL.k));
    expect((await owner.waitForMessage('commandResult')).accepted).toBe(true);

    await colyseus.cleanup();

    const second = (await colyseus.createRoom('world', {})) as WorldRoom;
    const stranger = await colyseus.connectTo(second, { accountId: 'acct_passing' });
    const { sessionEpoch } = await stranger.waitForMessage('session');
    second.clearInventoryForTest('acct_passing');
    second.teleportForTest('acct_passing', CENTRE);
    second.grantForTest('acct_passing', 'wood_pillar', 1);

    stranger.send('command', placePiece('wood_pillar', 'pillar', CELL.i, CELL.k, sessionEpoch));
    const result = await stranger.waitForMessage('commandResult');

    expect(result.accepted).toBe(false);
    expect(result.reasonCode).toBe('forbidden');

    stranger.leave();
  });
});
