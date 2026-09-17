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
import { clampPitch, computeMoveIntent, wrapYaw, type KeyState } from './input.js';
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
let sendTimer: number | undefined;
let disconnectReason: string | undefined;
let lookError: string | undefined;
let crafting: { recipeId: string | null; completedUnits: number; totalUnits: number; progressS: number } | undefined;
let vitals = { calories: 0, health: 0, exposure: 0 };
let yaw = 0;
let pitch = 0;

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
  // GDD section 9's crafting queue. One recipe exists so far, so this is a
  // direct keybind rather than a recipe browser; the browser arrives with the
  // rest of the catalog.
  if (e.code === 'KeyC') attemptCraft('stone_hatchet', 1);
});

document.addEventListener('pointerlockchange', () => {
  entered = document.pointerLockElement === canvas;
  if (entered) lookError = undefined;
});

// Pointer lock failing used to be completely silent, which made a dead
// mouse-look indistinguishable from a broken camera. Now it says so.
document.addEventListener('pointerlockerror', () => {
  lookError = 'pointer lock refused';
});

/**
 * Requests pointer lock defensively. Two things bite here:
 * - the API returns a Promise in current Chrome but `undefined` in older
 *   browsers, so calling .catch() on the result throws a TypeError and takes
 *   the surrounding click handler down with it;
 * - it must be called while the user activation from the click is still live,
 *   so callers must not await anything first.
 */
function requestLook(): void {
  try {
    const result = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        lookError = 'pointer lock refused';
      });
    }
  } catch {
    lookError = 'pointer lock unavailable';
  }
}

window.addEventListener('mousemove', (e) => {
  if (!entered) return;
  const sensitivity = 0.0025;
  yaw = wrapYaw(yaw + e.movementX * sensitivity);
  // Vertical look was simply absent before: only yaw was applied, so moving
  // the mouse up or down did nothing at all.
  pitch = clampPitch(pitch + e.movementY * sensitivity);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
});

// GDD section 5: "Use/aim | Left/right mouse". Gathering is a tool-use
// action, not the E interact key that takeItem uses.
window.addEventListener('mousedown', (e) => {
  if (entered && e.button === 0) attemptHitNode();
});

// Mouse-look needs pointer lock, but a lock rejection/delay must never block
// the connection or WASD movement: those are gated on `room`, not `entered`.
enterButton.addEventListener('click', () => {
  overlayEl.style.display = 'none';
  // Requested FIRST and synchronously. Awaiting connect() here -- a real
  // WebSocket handshake -- meant the browser no longer saw a live user
  // activation by the time pointer lock was asked for, so it was refused and
  // the game came up with working WASD and a frozen camera.
  requestLook();
  if (!room) void connect();
});

// Re-acquire pointer lock after it's lost (Escape, alt-tab, devtools focus).
canvas.addEventListener('click', () => {
  if (!entered) requestLook();
});

async function connect(): Promise<void> {
  const client = new ColyseusSDK(`${location.protocol === 'https:' ? 'https' : 'http'}://${location.hostname}:2567`);
  const joined = await client.joinOrCreate('world', { accountId });
  room = joined;

  joined.onMessage('session', (payload: { sessionEpoch: number }) => {
    sessionEpoch = payload.sessionEpoch;
    // Don't start sending until the epoch is known: a command sent before
    // this arrives would carry the stale default (0) and be rejected as
    // stale_session forever if this message were ever lost, rather than
    // just for the first few commands.
    if (sendTimer === undefined) {
      sendTimer = window.setInterval(sendMoveCommand, 1000 / MOVE_SEND_HZ);
    }
  });

  // Without this the page keeps calling room.send 20x/s on a dead room
  // forever and the HUD still reads "connected" off stale state -- a frozen
  // game that looks fine. The server can and does close the connection
  // (an invalid command is a disconnect, not a dropped message), so this is
  // a normal path, not an edge case.
  const handleDisconnect = (reason: string) => {
    if (sendTimer !== undefined) {
      clearInterval(sendTimer);
      sendTimer = undefined;
    }
    room = undefined;
    disconnectReason = reason;
  };
  joined.onLeave((code: number) => handleDisconnect(`disconnected (code ${code})`));
  joined.onError((code: number, message?: string) => handleDisconnect(`error ${code}: ${message ?? ''}`));

  joined.onMessage('commandResult', (payload: { accepted: boolean; reasonCode: string }) => {
    statusEl.dataset.lastResult = `${payload.accepted ? 'ok' : payload.reasonCode}`;
  });

  joined.onMessage('inventory', (payload: { slots: typeof inventorySlots }) => {
    inventorySlots = payload.slots;
  });

  joined.onMessage('crafting', (payload: typeof crafting) => {
    crafting = payload;
  });

  // Vitals are private per TECHNICAL section 3, so they arrive as a targeted
  // message rather than on the shared state. They were already being sent
  // every tick and simply thrown away by the client.
  joined.onMessage('vitals', (payload: typeof vitals) => {
    vitals = payload;
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
    action: { type: 'move', ...intent, yaw: wrapYaw(yaw) },
  });
}

function attemptCraft(recipeId: string, quantity: number): void {
  if (!room) return;
  sequence += 1;
  room.send('command', {
    protocolVersion: PROTOCOL_VERSION,
    sessionEpoch,
    sequence,
    clientTick: 0,
    action: { type: 'craft', recipeId, quantity },
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

/** Sums each distinct item in the pack, so the HUD is not wood-only. */
function describeInventory(): string {
  const totals = new Map<string, number>();
  for (const slot of inventorySlots) {
    if (!slot) continue;
    totals.set(slot.definitionId, (totals.get(slot.definitionId) ?? 0) + slot.quantity);
  }
  if (totals.size === 0) return 'empty';
  return [...totals].map(([id, qty]) => `${id} ${qty}`).join(', ');
}

function describeCrafting(): string {
  if (!crafting || crafting.recipeId === null) return 'idle';
  const { recipeId, completedUnits, totalUnits } = crafting;
  return `${recipeId} ${completedUnits}/${totalUnits}`;
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

  statusEl.textContent = room
    ? [
        `account ${accountId.slice(0, 8)}  epoch ${sessionEpoch}  players ${room.state.players.size}`,
        `hp ${vitals.health.toFixed(0)}  cal ${vitals.calories.toFixed(0)}  exposure ${vitals.exposure.toFixed(0)}`,
        `pack: ${describeInventory()}`,
        `craft: ${describeCrafting()}`,
        `last:${statusEl.dataset.lastResult ?? '-'}${entered ? '' : `  (${lookError ?? 'click canvas to look'})`}`,
        'WASD move : shift sprint : space jump : LMB gather : E take : C craft hatchet',
      ].join('\n')
    : disconnectReason
      ? `${disconnectReason} -- reload to reconnect`
      : 'not connected';

  scene.render();
});

window.addEventListener('resize', () => engine.resize());
