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
// Colyseus's own default patch rate (DEFAULT_PATCH_RATE = 1000/20), which the
// room does not override. Deliberately not derived from MOVE_SEND_HZ: the two
// happen to be equal, but one is how often we send and this is how often the
// server's state arrives, which is what the interpolation blends between.
const PATCH_INTERVAL_MS = 50;
const EYE_HEIGHT_M = 1.7; // matches the server's own eye height for reach
const ITEM_WORLD_POSITION = new Vector3(2, 0.5, 2); // client-side placeholder; see note below
const HUD_INTERVAL_MS = 100; // the HUD is read by a human; no reason to rebuild it per frame

/**
 * Where the server seeds the world's gatherables and stations. Mirrored here
 * only so the placeholder meshes stand in the right place and the HUD can name
 * what you are next to; the server is the authority on all of it, and refuses
 * anything out of its own reach.
 */
const NODES = [
  { id: 'node_1', label: 'wood pile', position: new Vector3(-2, 0.5, 2) },
  { id: 'rock_1', label: 'ore rock', position: new Vector3(0, 0.5, -6) },
];
const STATIONS = [
  { id: 'furnace_1', label: 'furnace', input: 'metal_ore', position: new Vector3(6, 0.5, 0) },
  { id: 'campfire_1', label: 'campfire', input: 'raw_meat', position: new Vector3(-6, 0.5, 0) },
];

const statusEl = document.getElementById('status')!;
const overlayEl = document.getElementById('enterOverlay')!;
const enterButton = document.getElementById('enterButton')!;
const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

const engine = new Engine(canvas, true);
const scene = new Scene(engine);

// Which GPU (if any) Chrome actually gave us. A renderer reading "SwiftShader"
// or "ANGLE ... Software" means WebGL fell back to the CPU, which caps the
// frame rate no matter what the scene contains -- worth ruling out first when
// rendering is slow.
console.log('[rwf] webgl renderer:', engine.getGlInfo().renderer);

const camera = new UniversalCamera('player', new Vector3(0, 1.7, 0), scene);
camera.minZ = 0.05;
camera.inputs.clear(); // movement is server-authoritative; no built-in WASD/mouse-look

new HemisphericLight('sun', new Vector3(0, 1, 0), scene);
MeshBuilder.CreateGround('ground', { width: 40, height: 40 }, scene);

const remoteMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateCapsule>>();
const remoteLastTransform = new Map<string, Transform>();
const remoteTargetTransform = new Map<string, Transform>();

const creatureMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const creaturePositions = new Map<string, Vector3>();
const carcassMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const carcassPositions = new Map<string, Vector3>();

const deerMaterial = new StandardMaterial('deerMat', scene);
deerMaterial.diffuseColor = new Color3(0.65, 0.5, 0.3);
const wolfMaterial = new StandardMaterial('wolfMat', scene);
wolfMaterial.diffuseColor = new Color3(0.35, 0.35, 0.38);
const carcassMaterial = new StandardMaterial('carcassMat', scene);
carcassMaterial.diffuseColor = new Color3(0.5, 0.15, 0.15);

const itemMaterial = new StandardMaterial('itemMat', scene);
itemMaterial.diffuseColor = new Color3(0.7, 0.5, 0.2);
const itemMesh = MeshBuilder.CreateBox('item_1', { size: 0.4 }, scene);
itemMesh.position.copyFrom(ITEM_WORLD_POSITION);
itemMesh.material = itemMaterial;

const nodeMaterial = new StandardMaterial('nodeMat', scene);
nodeMaterial.diffuseColor = new Color3(0.4, 0.3, 0.15);
for (const node of NODES) {
  const mesh = MeshBuilder.CreateBox(node.id, { width: 0.8, height: 0.5, depth: 0.8 }, scene);
  mesh.position.copyFrom(node.position);
  mesh.material = nodeMaterial;
}

const stationMaterial = new StandardMaterial('stationMat', scene);
stationMaterial.diffuseColor = new Color3(0.45, 0.45, 0.5); // cold stone; lit fires glow below
const litMaterial = new StandardMaterial('litMat', scene);
litMaterial.diffuseColor = new Color3(0.9, 0.45, 0.15);
const stationMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
for (const station of STATIONS) {
  const mesh = MeshBuilder.CreateBox(station.id, { width: 1, height: 1, depth: 1 }, scene);
  mesh.position.copyFrom(station.position);
  mesh.material = stationMaterial;
  stationMeshes.set(station.id, mesh);
}

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
interface StationPayload {
  stationId: string;
  kind: string;
  lit: boolean;
  progressS: number;
  inputs: Array<{ definitionId: string; quantity: number } | null>;
  fuel: { definitionId: string; quantity: number } | null;
  outputs: Array<{ definitionId: string; quantity: number } | null>;
}
const stationStates = new Map<string, StationPayload>();
let vitals = { calories: 0, health: 0, exposure: 0, coldDeficit: 0, phase: 'day' };
let yaw = 0;
let pitch = 0;
let localLastTransform: Transform | undefined;
let localTargetTransform: Transform | undefined;
let patchAtMs = 0;
let hudAtMs = 0;

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
  // CONTENT section 3's stations. Direct keys for the same reason: a real
  // slot-by-slot station panel arrives with M2's containers.
  if (e.code === 'KeyF') attemptStationInsert('wood');
  if (e.code === 'KeyR') attemptStationInsert(nearestStation()?.input);
  if (e.code === 'KeyT') attemptStationTake();
  if (e.code === 'KeyG') attemptStationLight();
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
  if (entered && e.button === 0) attemptSwing();
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

  // Station contents are container contents, which TECHNICAL section 3 keeps
  // off the shared state; the server sends them only to players standing at
  // the station.
  joined.onMessage('station', (payload: StationPayload) => {
    stationStates.set(payload.stationId, payload);
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

  // Animals and carcasses are public world state, so unlike station contents
  // they arrive on the replicated schema like other players do.
  interface ReplicatedCreature {
    kind: string;
    x: number;
    y: number;
    z: number;
  }
  $(joined.state).creatures!.onAdd((creature: ReplicatedCreature, key: string) => {
    const mesh = MeshBuilder.CreateBox(`creature_${key}`, { width: 0.7, height: 1, depth: 1.6 }, scene);
    mesh.material = creature.kind === 'wolf' ? wolfMaterial : deerMaterial;
    creatureMeshes.set(key, mesh);
  });
  $(joined.state).creatures!.onRemove((_creature: ReplicatedCreature, key: string) => {
    creatureMeshes.get(key)?.dispose();
    creatureMeshes.delete(key);
    creaturePositions.delete(key);
  });
  $(joined.state).carcasses!.onAdd((_carcass: ReplicatedCreature, key: string) => {
    const mesh = MeshBuilder.CreateBox(`carcass_${key}`, { width: 1.2, height: 0.4, depth: 1.6 }, scene);
    mesh.material = carcassMaterial;
    carcassMeshes.set(key, mesh);
  });
  $(joined.state).carcasses!.onRemove((_carcass: ReplicatedCreature, key: string) => {
    carcassMeshes.get(key)?.dispose();
    carcassMeshes.delete(key);
    carcassPositions.delete(key);
  });

  joined.onStateChange(() => {
    patchAtMs = performance.now();
    const local = joined.state.players.get(accountId);
    if (local) {
      const target = { x: local.x, y: local.y, z: local.z, yaw: local.yaw };
      // Still no client-side prediction: these are both server positions, and
      // the render loop only blends between the last two. Snapping straight
      // to each patch made every movement step at 20 Hz however fast the
      // renderer was running, which reads as a slideshow.
      localLastTransform = localTargetTransform ?? target;
      localTargetTransform = target;
    }
    for (const [key, target] of remoteTargetTransform) {
      const player = joined.state.players.get(key);
      if (!player) continue;
      remoteLastTransform.set(key, target);
      remoteTargetTransform.set(key, { x: player.x, y: player.y, z: player.z, yaw: player.yaw });
    }

    // Animals move every tick; the meshes follow the server directly rather
    // than being interpolated, which is a visible step at 20Hz but keeps what
    // the HUD calls "in reach" identical to what the server will accept.
    for (const [key, mesh] of creatureMeshes) {
      const creature = joined.state.creatures.get(key);
      if (!creature) continue;
      mesh.position.set(creature.x, creature.y + 0.5, creature.z);
      creaturePositions.set(key, new Vector3(creature.x, creature.y, creature.z));
    }
    for (const [key, mesh] of carcassMeshes) {
      const carcass = joined.state.carcasses.get(key);
      if (!carcass) continue;
      mesh.position.set(carcass.x, carcass.y + 0.2, carcass.z);
      carcassPositions.set(key, new Vector3(carcass.x, carcass.y, carcass.z));
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
  send({ type: 'craft', recipeId, quantity });
}

// Reach is deliberately NOT pre-checked here. The server enforces it (a
// modified client would simply omit the check), and a silent client-side
// early return made an out-of-reach press indistinguishable from a broken
// keybind: nothing happened and nothing said why. Now the server answers and
// the HUD's `last:` line shows out_of_range/already_taken/ok.
function attemptTakeItem(): void {
  send({ type: 'takeItem', itemInstanceId: 'item_1' });
}

function send(action: Record<string, unknown>): void {
  if (!room) return;
  sequence += 1;
  room.send('command', { protocolVersion: PROTOCOL_VERSION, sessionEpoch, sequence, clientTick: 0, action });
}

function nearestOf<T extends { position: Vector3 }>(candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Vector3.Distance(camera.position, candidate.position);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

const nearestStation = () => nearestOf(STATIONS);

/**
 * One swing key for everything you swing at. Picks whatever is closest --
 * animal, carcass or node -- rather than making the player remember a
 * different key per target type. The server still decides whether it was in
 * reach, and says so in the HUD's `last:` line when it was not.
 */
function attemptSwing(): void {
  const candidates: Array<{ distance: number; action: Record<string, unknown> }> = [];
  for (const [id, position] of creaturePositions) {
    candidates.push({
      distance: Vector3.Distance(camera.position, position),
      action: { type: 'attackCreature', creatureId: id },
    });
  }
  for (const [id, position] of carcassPositions) {
    candidates.push({
      distance: Vector3.Distance(camera.position, position),
      action: { type: 'harvestCarcass', carcassId: id },
    });
  }
  for (const node of NODES) {
    candidates.push({
      distance: Vector3.Distance(camera.position, node.position),
      action: { type: 'hitNode', nodeId: node.id },
    });
  }

  const nearest = candidates.sort((a, b) => a.distance - b.distance)[0];
  if (nearest) send(nearest.action);
}

/** Sums one item across the pack, so a keypress can move everything you carry. */
function heldQuantity(definitionId: string): number {
  return inventorySlots.reduce(
    (sum, slot) => sum + (slot?.definitionId === definitionId ? slot.quantity : 0),
    0,
  );
}

function attemptStationInsert(definitionId: string | undefined): void {
  const station = nearestStation();
  if (!station || !definitionId) return;
  // One stack at a time, which is the protocol's own per-insert ceiling.
  const quantity = Math.min(250, heldQuantity(definitionId));
  if (quantity < 1) return;
  send({ type: 'stationInsert', stationId: station.id, definitionId, quantity });
}

function attemptStationTake(): void {
  const station = nearestStation();
  if (station) send({ type: 'stationTake', stationId: station.id });
}

function attemptStationLight(): void {
  const station = nearestStation();
  if (!station) return;
  send({ type: 'stationLight', stationId: station.id, lit: !stationStates.get(station.id)?.lit });
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

/**
 * The two placeholder boxes are both brown and neither is labelled, so which
 * key applies to which is pure guesswork. Both are listed rather than just the
 * closer one -- with only two objects there is room, and naming one would
 * still leave you guessing when you are stood at the other. The distances make
 * an out-of-reach press self-explanatory.
 */
function describeNearest(): string {
  const parts: string[] = [];
  if (itemMesh.isEnabled()) {
    parts.push(`wood ${Vector3.Distance(camera.position, ITEM_WORLD_POSITION).toFixed(1)}m (E)`);
  }
  for (const node of NODES) {
    parts.push(`${node.label} ${Vector3.Distance(camera.position, node.position).toFixed(1)}m (LMB)`);
  }
  const station = nearestStation();
  if (station) {
    parts.push(`${station.label} ${Vector3.Distance(camera.position, station.position).toFixed(1)}m`);
  }
  return parts.join('  ');
}

/** The station you are standing at, as the server last reported it to you. */
function describeStation(): string {
  const station = nearestStation();
  const state = station && stationStates.get(station.id);
  if (!station || !state) return 'walk up to a furnace or campfire';
  const describe = (slots: Array<{ definitionId: string; quantity: number } | null>): string => {
    const filled = slots.filter((slot) => slot !== null);
    return filled.length === 0 ? 'empty' : filled.map((slot) => `${slot!.definitionId} ${slot!.quantity}`).join(', ');
  };
  return [
    `${station.label} ${state.lit ? 'LIT' : 'cold'}`,
    `in ${describe(state.inputs)}`,
    `fuel ${state.fuel ? `wood ${state.fuel.quantity}` : 'empty'}`,
    `out ${describe(state.outputs)}`,
  ].join(' : ');
}

engine.runRenderLoop(() => {
  // Time-based, so meshes actually animate between patches. The old constant
  // 0.5 parked every remote player permanently at the midpoint of its last
  // two positions and never moved it within a patch.
  const alpha = Math.min(1, (performance.now() - patchAtMs) / PATCH_INTERVAL_MS);

  for (const [key, mesh] of remoteMeshes) {
    const from = remoteLastTransform.get(key);
    const to = remoteTargetTransform.get(key);
    if (!from || !to) continue;
    const blended = interpolateTransform(from, to, alpha);
    mesh.position.set(blended.x, blended.y + 0.9, blended.z);
    mesh.rotation.y = blended.yaw;
  }

  if (localLastTransform && localTargetTransform) {
    const blended = interpolateTransform(localLastTransform, localTargetTransform, alpha);
    // Position only. Yaw and pitch are local mouse input applied at full rate
    // in the mousemove handler; feeding the server's replicated yaw back into
    // the camera here would make looking around lag by a patch.
    camera.position.set(blended.x, blended.y + EYE_HEIGHT_M, blended.z);
  }

  const item = room?.state.items?.get('item_1');
  itemMesh.setEnabled(!item || item.claimedBy === '');

  for (const [stationId, mesh] of stationMeshes) {
    mesh.material = stationStates.get(stationId)?.lit ? litMaterial : stationMaterial;
  }

  const now = performance.now();
  if (now - hudAtMs >= HUD_INTERVAL_MS) {
    hudAtMs = now;
    statusEl.textContent = room
      ? [
          `account ${accountId.slice(0, 8)}  epoch ${sessionEpoch}  players ${room.state.players.size}`,
          `${engine.getFps().toFixed(0)} fps render : ${MOVE_SEND_HZ} Hz sim`,
          `hp ${vitals.health.toFixed(0)}  cal ${vitals.calories.toFixed(0)}  exposure ${vitals.exposure.toFixed(0)}  ${vitals.phase}${vitals.coldDeficit > 0 ? `  COLD ${vitals.coldDeficit.toFixed(0)}` : ''}`,
          `pack: ${describeInventory()}`,
          `craft: ${describeCrafting()}`,
          `near: ${describeNearest()}`,
          `station: ${describeStation()}`,
          `last:${statusEl.dataset.lastResult ?? '-'}${entered ? '' : `  (${lookError ?? 'click canvas to look'})`}`,
          'WASD move : shift sprint : space jump : LMB swing at what you face : E take : C craft hatchet',
          'at a station -- F add fuel : R add input : G light/snuff : T take output',
        ].join('\n')
      : disconnectReason
        ? `${disconnectReason} -- reload to reconnect`
        : 'not connected';
  }

  scene.render();
});

window.addEventListener('resize', () => engine.resize());
