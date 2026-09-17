import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Meshes/Builders/groundBuilder';
import '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import { ColyseusSDK, getStateCallbacks, type Room } from '@colyseus/sdk';
import { PROTOCOL_VERSION } from '@rwf/protocol';
import { computeMoveIntent, type KeyState } from './input.js';
import { interpolateTransform, type Transform } from './interpolate.js';

/**
 * M0 stand-in for TECHNICAL section 5's real account/recovery flow: a
 * client-generated ID persisted in localStorage. Good enough to prove
 * reconnect resumes the same body; not the real invite-code/recovery-secret
 * system, which is later-milestone scope.
 */
function getOrCreateAccountId(): string {
  const key = 'rwf.accountId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

const MOVE_SEND_HZ = 20; // matches TECHNICAL section 3's simulation rate
const ITEM_WORLD_POSITION = new Vector3(2, 0.5, 2); // client-side placeholder; see note below
const NODE_WORLD_POSITION = new Vector3(-2, 0.5, 2); // client-side placeholder; matches server's node_1
const INTERACT_REACH_M = 2.5; // GDD section 5

const statusEl = document.getElementById('status')!;
const overlayEl = document.getElementById('enterOverlay')!;
const enterButton = document.getElementById('enterButton')!;
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);

const camera = new UniversalCamera('player', new Vector3(0, 1.7, 0), scene);
camera.minZ = 0.05;
camera.inputs.clear(); // movement is server-authoritative; no built-in WASD/mouse-look

new HemisphericLight('sun', new Vector3(0, 1, 0), scene);
MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, scene);

const remoteMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateCapsule>>();
const remoteLastTransform = new Map<string, Transform>();
const remoteTargetTransform = new Map<string, Transform>();

const itemMaterial = new StandardMaterial('itemMat', scene);
itemMaterial.diffuseColor = new Color3(0.7, 0.5, 0.2);
const itemMesh = MeshBuilder.CreateBox('item_1', { size: 0.4 }, scene);
itemMesh.position.copyFrom(ITEM_WORLD_POSITION);
itemMesh.material = itemMaterial;

const nodeMaterial = new StandardMaterial('nodeMat', scene);
nodeMaterial.diffuseColor = new Color3(0.4, 0.3, 0.15);
const nodeMesh = MeshBuilder.CreateBox('node_1', { width: 0.8, height: 0.5, depth: 0.8 }, scene);
nodeMesh.position.copyFrom(NODE_WORLD_POSITION);
nodeMesh.material = nodeMaterial;

const accountId = getOrCreateAccountId();
let sessionEpoch = 0;
let sequence = 0;
let room: Room | undefined;
let entered = false;
let inventorySlots: Array<{ definitionId: string; quantity: number } | null> = [];

const keys: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  sprint: false,
  crouch: false,
  jump: false,
};

function setKey(code: string, pressed: boolean): void {
  switch (code) {
    case 'KeyW': keys.forward = pressed; break;
    case 'KeyS': keys.back = pressed; break;
    case 'KeyA': keys.left = pressed; break;
    case 'KeyD': keys.right = pressed; break;
    case 'ShiftLeft': case 'ShiftRight': keys.sprint = pressed; break;
    case 'ControlLeft': case 'ControlRight': keys.crouch = pressed; break;
    case 'Space': keys.jump = pressed; break;
  }
}

window.addEventListener('keydown', (e) => setKey(e.code, true));
window.addEventListener('keyup', (e) => setKey(e.code, false));

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') attemptTakeItem();
});

document.addEventListener('pointerlockchange', () => {
  entered = document.pointerLockElement === canvas;
});

window.addEventListener('mousemove', (e) => {
  if (!entered) return;
  const sensitivity = 0.0025;
  camera.rotation.y += e.movementX * sensitivity;
});

// GDD section 5: "Use/aim | Left/right mouse". Gathering is a tool-use
// action, not the E interact key that takeItem uses.
window.addEventListener('mousedown', (e) => {
  if (entered && e.button === 0) attemptHitNode();
});

// Mouse-look needs pointer lock, but a lock rejection/delay must never block
// the connection or WASD movement: those are gated on `room`, not `entered`.
enterButton.addEventListener('click', async () => {
  overlayEl.style.display = 'none';
  if (!room) await connect();
  try {
    await canvas.requestPointerLock();
  } catch {
    // Mouse-look is unavailable until the user clicks the canvas below;
    // movement and everything else still works.
  }
});

// Re-acquire pointer lock after it's lost (Escape, alt-tab, devtools focus).
canvas.addEventListener('click', () => {
  if (!entered) canvas.requestPointerLock().catch(() => {});
});

async function connect(): Promise<void> {
  const client = new ColyseusSDK(`${location.protocol === 'https:' ? 'https' : 'http'}://${location.hostname}:2567`);
  const joined = await client.joinOrCreate('world', { accountId });
  room = joined;

  let sendingStarted = false;
  joined.onMessage('session', (payload: { sessionEpoch: number }) => {
    sessionEpoch = payload.sessionEpoch;
    // Don't start sending until the epoch is known: a command sent before
    // this arrives would carry the stale default (0) and be rejected as
    // stale_session forever if this message were ever lost, rather than
    // just for the first few commands.
    if (!sendingStarted) {
      sendingStarted = true;
      setInterval(sendMoveCommand, 1000 / MOVE_SEND_HZ);
    }
  });

  joined.onMessage('commandResult', (payload: { accepted: boolean; reasonCode: string }) => {
    statusEl.dataset.lastResult = `${payload.accepted ? 'ok' : payload.reasonCode}`;
  });

  joined.onMessage('inventory', (payload: { slots: typeof inventorySlots }) => {
    inventorySlots = payload.slots;
  });

  // Without sharing @rwf/server's concrete schema classes (deliberately not
  // a client dependency), the callback proxy's type falls back to a shape
  // TS can't prove has `.players`; it does at runtime.
  const $ = getStateCallbacks(joined);
  $(joined.state).players!.onAdd((player: Transform, key: string) => {
    if (key === accountId) return; // local player is the camera; never rendered as a mesh
    const mesh = MeshBuilder.CreateCapsule(`player_${key}`, { height: 1.8, radius: 0.35 }, scene);
    remoteMeshes.set(key, mesh);
    const transform = { x: player.x, y: player.y, z: player.z, yaw: player.yaw };
    remoteLastTransform.set(key, transform);
    remoteTargetTransform.set(key, transform);
  });

  $(joined.state).players!.onRemove((_player: Transform, key: string) => {
    remoteMeshes.get(key)?.dispose();
    remoteMeshes.delete(key);
    remoteLastTransform.delete(key);
    remoteTargetTransform.delete(key);
  });

  joined.onStateChange(() => {
    const local = joined.state.players.get(accountId);
    if (local) {
      camera.position.set(local.x, local.y + 1.7, local.z); // snap, no local prediction
    }
    for (const [key, target] of remoteTargetTransform) {
      const player = joined.state.players.get(key);
      if (!player) continue;
      remoteLastTransform.set(key, target);
      remoteTargetTransform.set(key, { x: player.x, y: player.y, z: player.z, yaw: player.yaw });
    }
  });
}

function sendMoveCommand(): void {
  if (!room) return;
  const intent = computeMoveIntent(keys);
  sequence += 1;
  room.send('command', {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'move', ...intent, yaw: camera.rotation.y },
  });
}

function attemptTakeItem(): void {
  if (!room) return;
  if (Vector3.Distance(camera.position, ITEM_WORLD_POSITION) > INTERACT_REACH_M) return;
  sequence += 1;
  room.send('command', {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'takeItem', itemInstanceId: 'item_1' },
  });
}

function attemptHitNode(): void {
  if (!room) return;
  if (Vector3.Distance(camera.position, NODE_WORLD_POSITION) > INTERACT_REACH_M) return;
  sequence += 1;
  room.send('command', {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'hitNode', nodeId: 'node_1' },
  });
}

engine.runRenderLoop(() => {
  const alpha = 0.5; // fixed blend factor between the last two patches; good enough for M0
  for (const [key, mesh] of remoteMeshes) {
    const from = remoteLastTransform.get(key);
    const to = remoteTargetTransform.get(key);
    if (!from || !to) continue;
    const blended = interpolateTransform(from, to, alpha);
    mesh.position.set(blended.x, blended.y + 0.9, blended.z);
    mesh.rotation.y = blended.yaw;
  }

  const item = room?.state.items?.get('item_1');
  itemMesh.setEnabled(!item || item.claimedBy === '');

  const woodCount = inventorySlots.reduce((sum, slot) => sum + (slot?.definitionId === 'wood' ? slot.quantity : 0), 0);
  statusEl.textContent = room
    ? `account ${accountId.slice(0, 8)} epoch ${sessionEpoch} players ${room.state.players.size} wood ${woodCount} last:${statusEl.dataset.lastResult ?? '-'}${entered ? '' : ' (click canvas to look)'}`
    : 'not connected';

  scene.render();
});

window.addEventListener('resize', () => engine.resize());
