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
// The same constant the server validates with, so the ghost's preview and the
// server's answer cannot drift apart into two different rules.
import {
  PLACEMENT_CLEARANCE_M,
  siteKey,
  validatePieceSite,
  worldPositionOf,
  CELL_SIZE_M,
  STOREY_HEIGHT_M,
  type PieceForm,
  type PieceSite,
} from '@rwf/sim';
import { snapToSite } from './build.js';
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
const corpseMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const corpsePositions = new Map<string, Vector3>();
const deployableMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const deployablePositions = new Map<string, Vector3>();
const pieceMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();
const doorMeshes = new Map<string, ReturnType<typeof MeshBuilder.CreateBox>>();

const deerMaterial = new StandardMaterial('deerMat', scene);
deerMaterial.diffuseColor = new Color3(0.65, 0.5, 0.3);
const wolfMaterial = new StandardMaterial('wolfMat', scene);
wolfMaterial.diffuseColor = new Color3(0.35, 0.35, 0.38);
const carcassMaterial = new StandardMaterial('carcassMat', scene);
carcassMaterial.diffuseColor = new Color3(0.5, 0.15, 0.15);
// Deliberately not the carcass colour: a player's body and a deer's are
// different things to walk up to, and both are lootable.
const corpseMaterial = new StandardMaterial('corpseMat', scene);
corpseMaterial.diffuseColor = new Color3(0.2, 0.2, 0.45);
const crateMaterial = new StandardMaterial('crateMat', scene);
crateMaterial.diffuseColor = new Color3(0.55, 0.38, 0.18);
const bedrollMaterial = new StandardMaterial('bedrollMat', scene);
bedrollMaterial.diffuseColor = new Color3(0.7, 0.62, 0.45);

/** How each deployable is drawn, so a bedroll does not look like a crate. */
const DEPLOYABLE_SHAPES: Record<string, { width: number; height: number; depth: number }> = {
  small_crate: { width: 0.9, height: 0.7, depth: 0.9 },
  bedroll: { width: 0.9, height: 0.15, depth: 1.9 },
};
const timberMaterial = new StandardMaterial('timberMat', scene);
timberMaterial.diffuseColor = new Color3(0.48, 0.33, 0.16);
const doorMaterial = new StandardMaterial('doorMat', scene);
doorMaterial.diffuseColor = new Color3(0.62, 0.45, 0.2);

/**
 * CONTENT section 7's placed HP, so the HUD can say how damaged something is.
 * The server is the authority on all of it; these only decide what to show and
 * which piece the repair key aims at.
 */
const PIECE_MAX_HP: Record<string, number> = {
  foundation: 2000,
  pillar: 1000,
  wall: 1000,
  doorway: 1000,
  ceiling: 1000,
};
const DOOR_MAX_HP: Record<string, number> = { wood_door: 500, metal_door: 1000 };

/** The box each structural form is drawn as, in metres (GDD section 10's grid). */
const PIECE_SHAPES: Record<string, { width: number; height: number; depth: number }> = {
  foundation: { width: CELL_SIZE_M, height: 0.3, depth: CELL_SIZE_M },
  ceiling: { width: CELL_SIZE_M, height: 0.3, depth: CELL_SIZE_M },
  pillar: { width: 0.3, height: STOREY_HEIGHT_M, depth: 0.3 },
  wall: { width: CELL_SIZE_M, height: STOREY_HEIGHT_M, depth: 0.2 },
  // A doorway is a wall with a hole in it; one box cannot show that, so it is
  // drawn shorter to be visibly the way in until the mesh has a real opening.
  doorway: { width: CELL_SIZE_M, height: 1, depth: 0.2 },
};

function pieceShape(form: string, axis: string): { width: number; height: number; depth: number } {
  const shape = PIECE_SHAPES[form] ?? { width: 1, height: 1, depth: 1 };
  // A wall on the z edge runs the other way.
  if ((form === 'wall' || form === 'doorway') && axis === 'z') {
    return { width: shape.depth, height: shape.height, depth: shape.width };
  }
  return shape;
}

/**
 * GDD section 10's placement ghost. It has to show where the crate would land
 * and whether the server would accept it -- the section requires the ghost to
 * expose the rules, and a player who cannot see a refusal coming just presses
 * the key repeatedly.
 */
const ghostMesh = MeshBuilder.CreateBox('placementGhost', { width: 0.9, height: 0.7, depth: 0.9 }, scene);
const ghostOkMaterial = new StandardMaterial('ghostOkMat', scene);
ghostOkMaterial.diffuseColor = new Color3(0.3, 0.8, 0.3);
ghostOkMaterial.alpha = 0.4;
const ghostBadMaterial = new StandardMaterial('ghostBadMat', scene);
ghostBadMaterial.diffuseColor = new Color3(0.85, 0.25, 0.2);
ghostBadMaterial.alpha = 0.4;
ghostMesh.isPickable = false;
ghostMesh.setEnabled(false);

const itemMaterial = new StandardMaterial('itemMat', scene);
itemMaterial.diffuseColor = new Color3(0.7, 0.5, 0.2);
const itemMesh = MeshBuilder.CreateBox('item_1', { size: 0.4 }, scene);
itemMesh.position.copyFrom(ITEM_WORLD_POSITION);
itemMesh.material = itemMaterial;

/**
 * The hot-ore zone (GDD section 6). It used to sit on the spawn point, where
 * being invisible did not matter because everyone was already in it; now that
 * a player has to walk to it, an unmarked patch of ground that quietly damages
 * them would be the worst of both.
 */
const HAZARD_ZONE = { x: 20, z: 0, radius: 5 };
const hazardMaterial = new StandardMaterial('hazardMat', scene);
hazardMaterial.diffuseColor = new Color3(0.8, 0.45, 0.15);
hazardMaterial.alpha = 0.35;
const hazardMesh = MeshBuilder.CreateGround(
  'hazardZone',
  { width: HAZARD_ZONE.radius * 2, height: HAZARD_ZONE.radius * 2 },
  scene,
);
hazardMesh.position.set(HAZARD_ZONE.x, 0.02, HAZARD_ZONE.z);
hazardMesh.material = hazardMaterial;
hazardMesh.isPickable = false;

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
interface CorpsePayload {
  corpseId: string;
  ownerAccountId: string;
  slots: Array<{ definitionId: string; quantity: number } | null>;
  overflowCount: number;
  removed: boolean;
}
const corpseContents = new Map<string, CorpsePayload>();
interface ContainerPayload {
  containerId: string;
  definitionId: string;
  ownerAccountId: string;
  slots: Array<{ definitionId: string; quantity: number } | null>;
  removed: boolean;
}
const containerContents = new Map<string, ContainerPayload>();

/**
 * What the place key would put down. GDD section 10's ghost needs to know
 * which piece it is previewing, and a hotbar is the smallest thing that can
 * say so until there is a real build menu.
 */
const PLACEABLES: Array<{ key: string; definitionId: string; form: PieceForm | null }> = [
  { key: 'Digit1', definitionId: 'small_crate', form: null },
  { key: 'Digit2', definitionId: 'wood_foundation', form: 'foundation' },
  { key: 'Digit3', definitionId: 'wood_pillar', form: 'pillar' },
  { key: 'Digit4', definitionId: 'wood_wall', form: 'wall' },
  { key: 'Digit5', definitionId: 'wood_doorway', form: 'doorway' },
  { key: 'Digit6', definitionId: 'wood_ceiling', form: 'ceiling' },
  // A door is not a piece: it goes into a doorway's socket, so X installs it
  // into whichever doorway is in reach rather than snapping it to the grid.
  { key: 'Digit7', definitionId: 'wood_door', form: null },
  { key: 'Digit8', definitionId: 'bedroll', form: null },
];
let selected = PLACEABLES[0]!;
/** Set while this account is dead; GDD section 12's death recap and respawn prompt. */
let death: { corpseId: string | null } | undefined;
let respawnNotice: string | undefined;
let vitals = { calories: 0, health: 0, exposure: 0, coldDeficit: 0, phase: 'day' };
let channel: { definitionId: string | null; elapsedS: number; durationS: number } | undefined;
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
  if (e.code === 'KeyN') attemptCraft('small_crate', 1);
  // Every placeable's recipe id is its item id, so the hotbar doubles as the
  // build menu: pick a piece, press M, place it.
  if (e.code === 'KeyM') attemptCraft(selected.definitionId, 1);
  // CONTENT section 3's stations. Direct keys for the same reason: a real
  // slot-by-slot station panel arrives with M2's containers.
  if (e.code === 'KeyF') attemptStationInsert('wood');
  if (e.code === 'KeyR') attemptStationInsert(nearestStation()?.input);
  if (e.code === 'KeyT') attemptStationTake();
  if (e.code === 'KeyG') attemptStationLight();
  // GDD section 6's use channels. Bandage is the only one with an effect so
  // far, so it gets the key rather than a belt slot.
  if (e.code === 'KeyB') send({ type: 'useItem', definitionId: 'bandage' });
  // Cooked first: raw meat feeds badly and poisons you (GDD section 6), so it
  // is what you eat when there is nothing else.
  if (e.code === 'KeyV') {
    send({ type: 'useItem', definitionId: heldQuantity('cooked_meat') > 0 ? 'cooked_meat' : 'raw_meat' });
  }
  // GDD section 12: a dead account has no live character until it asks for a
  // new one. Everything else the server refuses outright while dead.
  // Enter takes the random arrival anchor; shift-Enter asks for the player's
  // own bedroll, which the server refuses if it is on cooldown or gone.
  if (e.code === 'Enter' && death) {
    send({ type: 'respawn', anchorId: e.shiftKey ? (myAnchorId() ?? null) : null });
  }
  if (e.code === 'KeyQ') attemptCorpseTake();
  // GDD section 10's placement, and section 8's storage.
  if (e.code === 'KeyX') attemptPlace();
  if (e.code === 'KeyZ') attemptContainerInsert();
  if (e.code === 'KeyH') attemptContainerTake();
  // GDD section 10's doors and its two separate grants.
  if (e.code === 'KeyO') attemptOperateDoor();
  if (e.code === 'KeyP') attemptRepair();
  if (e.code === 'KeyK') attemptSetDoorAccess(!e.shiftKey);
  if (e.code === 'KeyJ') attemptSetBuildAccess(!e.shiftKey);
  const placeable = PLACEABLES.find((entry) => entry.key === e.code);
  if (placeable) selected = placeable;
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
  // GDD section 12's death recap. Arrives on the death itself and again on a
  // reconnect that finds the account still dead.
  joined.onMessage('death', (payload: { corpseId: string | null }) => {
    death = payload;
    respawnNotice = undefined;
  });
  joined.onMessage('respawn', (payload: { x: number; y: number; z: number; safe: boolean }) => {
    death = undefined;
    // safe: false is the server saying it could not find an anchor clear of
    // trouble, which section 12 requires be communicated rather than hidden.
    respawnNotice = payload.safe ? undefined : 'respawned in a dangerous spot';
  });
  joined.onMessage('container', (payload: ContainerPayload) => {
    if (payload.removed) {
      containerContents.delete(payload.containerId);
      return;
    }
    containerContents.set(payload.containerId, payload);
  });
  joined.onMessage('corpse', (payload: CorpsePayload) => {
    if (payload.removed) {
      corpseContents.delete(payload.corpseId);
      return;
    }
    corpseContents.set(payload.corpseId, payload);
  });

  joined.onMessage('station', (payload: StationPayload) => {
    stationStates.set(payload.stationId, payload);
  });

  // An open use channel is private to its owner, and the HUD needs the timer
  // GDD section 21 calls for.
  joined.onMessage('channel', (payload: typeof channel) => {
    channel = payload;
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
  $(joined.state).corpses!.onAdd((_corpse: ReplicatedCreature, key: string) => {
    const mesh = MeshBuilder.CreateBox(`corpse_${key}`, { width: 0.8, height: 0.4, depth: 1.8 }, scene);
    mesh.material = corpseMaterial;
    corpseMeshes.set(key, mesh);
  });
  $(joined.state).corpses!.onRemove((_corpse: ReplicatedCreature, key: string) => {
    corpseMeshes.get(key)?.dispose();
    corpseMeshes.delete(key);
    corpsePositions.delete(key);
    corpseContents.delete(key);
  });
  $(joined.state).deployables!.onAdd((deployable: ReplicatedCreature & { definitionId: string }, key: string) => {
    const shape = DEPLOYABLE_SHAPES[deployable.definitionId] ?? DEPLOYABLE_SHAPES.small_crate!;
    const mesh = MeshBuilder.CreateBox(`deployable_${key}`, shape, scene);
    mesh.material = deployable.definitionId === 'bedroll' ? bedrollMaterial : crateMaterial;
    deployableMeshes.set(key, mesh);
  });
  $(joined.state).deployables!.onRemove((_deployable: ReplicatedCreature, key: string) => {
    deployableMeshes.get(key)?.dispose();
    deployableMeshes.delete(key);
    deployablePositions.delete(key);
    containerContents.delete(key);
  });

  // Structural pieces carry their grid site, so the client draws them from
  // the same numbers the server validated -- there is no position to round.
  interface ReplicatedPiece {
    form: string;
    storey: number;
    i: number;
    k: number;
    axis: string;
  }
  $(joined.state).buildingPieces!.onAdd((piece: ReplicatedPiece, key: string) => {
    const shape = pieceShape(piece.form, piece.axis);
    const mesh = MeshBuilder.CreateBox(`piece_${key}`, shape, scene);
    mesh.material = timberMaterial;
    const at = worldPositionOf({
      form: piece.form as PieceForm,
      storey: piece.storey,
      i: piece.i,
      k: piece.k,
      axis: piece.axis === '' ? null : (piece.axis as 'x' | 'z'),
    });
    // Boxes are centred, so raise the ones whose site names their base.
    const lift = piece.form === 'pillar' ? STOREY_HEIGHT_M / 2 : 0;
    mesh.position.set(at.x, at.y + lift, at.z);
    pieceMeshes.set(key, mesh);
  });
  $(joined.state).buildingPieces!.onRemove((_piece: ReplicatedPiece, key: string) => {
    pieceMeshes.get(key)?.dispose();
    pieceMeshes.delete(key);
  });

  // A door fills the doorway it hangs in; open is drawn as swung aside rather
  // than hidden, so an open door is visibly a door and not a missing one.
  $(joined.state).doors!.onAdd((door: ReplicatedPiece, key: string) => {
    const shape = pieceShape('wall', door.axis);
    const mesh = MeshBuilder.CreateBox(`door_${key}`, { ...shape, height: 2.2 }, scene);
    mesh.material = doorMaterial;
    const at = worldPositionOf({
      form: 'doorway',
      storey: door.storey,
      i: door.i,
      k: door.k,
      axis: door.axis === '' ? null : (door.axis as 'x' | 'z'),
    });
    mesh.position.set(at.x, at.y - STOREY_HEIGHT_M / 2 + 1.1, at.z);
    doorMeshes.set(key, mesh);
  });
  $(joined.state).doors!.onRemove((_door: ReplicatedPiece, key: string) => {
    doorMeshes.get(key)?.dispose();
    doorMeshes.delete(key);
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
    for (const [key, mesh] of corpseMeshes) {
      const corpse = joined.state.corpses.get(key);
      if (!corpse) continue;
      mesh.position.set(corpse.x, corpse.y + 0.2, corpse.z);
      corpsePositions.set(key, new Vector3(corpse.x, corpse.y, corpse.z));
    }
    for (const [key, mesh] of deployableMeshes) {
      const deployable = joined.state.deployables.get(key);
      if (!deployable) continue;
      mesh.position.set(deployable.x, deployable.y + 0.35, deployable.z);
      deployablePositions.set(key, new Vector3(deployable.x, deployable.y, deployable.z));
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

/** The nearest body, whoever it belonged to: GDD section 8 has no owner-only loot. */
function nearestCorpseId(): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const [id, position] of corpsePositions) {
    const distance = Vector3.Distance(camera.position, position);
    if (distance >= bestDistance) continue;
    best = id;
    bestDistance = distance;
  }
  return best;
}

function attemptCorpseTake(): void {
  const corpseId = nearestCorpseId();
  if (corpseId) send({ type: 'corpseTake', corpseId });
}

/** GDD section 10: the ghost stands on the ground a short step ahead of you. */
const PLACEMENT_DISTANCE_M = 2;

function ghostPosition(): Vector3 {
  // Ground level in front of where the player is facing. Pitch is ignored on
  // purpose: a crate goes on the ground, and letting the player aim it at the
  // sky would only ever produce a refusal.
  return new Vector3(
    camera.position.x + Math.sin(yaw) * PLACEMENT_DISTANCE_M,
    0,
    camera.position.z + Math.cos(yaw) * PLACEMENT_DISTANCE_M,
  );
}

/** The grid site the selected piece would snap to, or null for a free-placed deployable. */
function ghostSite(): PieceSite | null {
  if (!selected.form) return null;
  const aim = ghostPosition();
  return snapToSite(selected.form, aim);
}

/**
 * Whether the server would take this placement, using the same rules it does.
 * It is a preview, not a gate: the key sends regardless and the HUD reports
 * whatever the server actually said, so a client that got this wrong cannot
 * turn a refusal into a placement or hide one it would have allowed. It is
 * also deliberately incomplete -- it does not know the per-owner caps or where
 * other players are standing, so it can show green on a placement the server
 * then refuses, which is why the HUD calls it "clear here" and not "allowed".
 */
function ghostIsLegal(): boolean {
  if (heldQuantity(selected.definitionId) < 1) return false;

  const site = ghostSite();
  if (site) {
    const placed = new Set<string>();
    if (room) for (const key of room.state.buildingPieces.keys()) placed.add(key);
    return validatePieceSite(site, placed) === null;
  }

  const position = ghostPosition();
  const occupied: Vector3[] = [
    ...deployablePositions.values(),
    ...STATIONS.map((s) => s.position),
    ...NODES.map((n) => n.position),
  ];
  for (const other of occupied) {
    if (Math.hypot(position.x - other.x, position.z - other.z) < PLACEMENT_CLEARANCE_M) return false;
  }
  return true;
}

/**
 * The doorway nearest the player, whether or not it holds a door. Doorways are
 * sockets, so everything about doors -- installing, opening, granting access --
 * acts on one rather than on a free position.
 */
function nearestDoorway(): { key: string; site: PieceSite } | undefined {
  if (!room) return undefined;
  let best: { key: string; site: PieceSite } | undefined;
  let bestDistance = Infinity;
  for (const [key, piece] of room.state.buildingPieces.entries()) {
    if (piece.form !== 'doorway') continue;
    const site: PieceSite = {
      form: 'doorway',
      storey: piece.storey,
      i: piece.i,
      k: piece.k,
      axis: piece.axis === '' ? null : (piece.axis as 'x' | 'z'),
    };
    const at = worldPositionOf(site);
    const distance = Vector3.Distance(camera.position, new Vector3(at.x, at.y, at.z));
    if (distance >= bestDistance) continue;
    best = { key, site };
    bestDistance = distance;
  }
  return best;
}

/**
 * Repairs the most damaged piece in reach (GDD section 10). Most damaged
 * rather than nearest: after a raid a player is standing among several, and
 * the one they mean is the one about to fall over.
 */
function attemptRepair(): void {
  if (!room) return;
  let best: { action: Record<string, unknown>; missing: number } | undefined;
  for (const [key, piece] of room.state.buildingPieces.entries()) {
    const site: PieceSite = {
      form: piece.form as PieceForm,
      storey: piece.storey,
      i: piece.i,
      k: piece.k,
      axis: piece.axis === '' ? null : (piece.axis as 'x' | 'z'),
    };
    const at = worldPositionOf(site);
    if (Vector3.Distance(camera.position, new Vector3(at.x, at.y, at.z)) > 4) continue;

    const door = room.state.doors.get(key);
    const candidates: Array<{ health: number; max: number; door: boolean }> = [
      { health: piece.health, max: PIECE_MAX_HP[piece.form] ?? 0, door: false },
    ];
    if (door) candidates.push({ health: door.health, max: DOOR_MAX_HP[door.definitionId] ?? 0, door: true });

    for (const candidate of candidates) {
      const missing = candidate.max - candidate.health;
      if (missing <= 0) continue;
      if (best && missing <= best.missing) continue;
      best = { action: { type: 'repairStructure', door: candidate.door, ...site }, missing };
    }
  }
  if (best) send(best.action);
}

function attemptOperateDoor(): void {
  const doorway = nearestDoorway();
  if (!doorway || !room) return;
  const door = room.state.doors.get(doorway.key);
  if (!door) return;
  send({ type: 'operateDoor', open: !door.open, ...doorway.site });
}

/**
 * Grants or revokes door access for the nearest other player. GDD section 10
 * grants it to "named player IDs", and naming one needs a text field this HUD
 * does not have; the player standing next to you is the one you were going to
 * name anyway.
 */
function attemptSetDoorAccess(granted: boolean): void {
  const doorway = nearestDoorway();
  const target = nearestOtherAccountId();
  if (!doorway || !target) return;
  send({ type: 'setDoorAccess', targetAccountId: target, granted, ...doorway.site });
}

function attemptSetBuildAccess(granted: boolean): void {
  const target = nearestOtherAccountId();
  if (target) send({ type: 'setBuildAccess', targetAccountId: target, granted });
}

function nearestOtherAccountId(): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const [key, transform] of remoteTargetTransform) {
    const distance = Vector3.Distance(camera.position, new Vector3(transform.x, transform.y, transform.z));
    if (distance >= bestDistance) continue;
    best = key;
    bestDistance = distance;
  }
  return best;
}

/**
 * This player's own bedroll. GDD section 12 says not to expose anchor
 * coordinates to other players; a deployable's position is public because you
 * can see a bedroll lying there, but only its owner's client reads it as a
 * respawn option.
 */
function myAnchorId(): string | undefined {
  if (!room) return undefined;
  for (const [id, deployable] of room.state.deployables.entries()) {
    if (deployable.definitionId === 'bedroll' && deployable.ownerAccountId === accountId) return id;
  }
  return undefined;
}

function attemptPlace(): void {
  if (selected.definitionId === 'wood_door') {
    const doorway = nearestDoorway();
    if (doorway) send({ type: 'installDoor', definitionId: 'wood_door', ...doorway.site });
    return;
  }
  const site = ghostSite();
  if (site) {
    send({ type: 'placeBuildingPiece', definitionId: selected.definitionId, ...site });
    return;
  }
  const position = ghostPosition();
  send({
    type: 'placeDeployable',
    definitionId: selected.definitionId,
    x: position.x,
    y: position.y,
    z: position.z,
  });
}

/** The nearest crate; GDD section 8 has no owner-only storage. */
function nearestContainerId(): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const [id, position] of deployablePositions) {
    // A bedroll is a deployable that holds nothing; aiming the store key at
    // one would only ever earn a refusal.
    if (room?.state.deployables.get(id)?.definitionId === 'bedroll') continue;
    const distance = Vector3.Distance(camera.position, position);
    if (distance >= bestDistance) continue;
    best = id;
    bestDistance = distance;
  }
  return best;
}

function attemptContainerTake(): void {
  const containerId = nearestContainerId();
  if (containerId) send({ type: 'containerTake', containerId });
}

/**
 * Stores the biggest stack in the pack. A slot-by-slot container panel is real
 * UI work; until then "put that away" is the useful single action, and it is
 * the one that makes a crate worth placing at all.
 */
function attemptContainerInsert(): void {
  const containerId = nearestContainerId();
  if (!containerId) return;
  let biggest: { definitionId: string; quantity: number } | undefined;
  for (const [definitionId, quantity] of inventoryTotals()) {
    if (!biggest || quantity > biggest.quantity) biggest = { definitionId, quantity };
  }
  if (!biggest) return;
  send({
    type: 'containerInsert',
    containerId,
    definitionId: biggest.definitionId,
    quantity: Math.min(250, biggest.quantity),
  });
}

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
  for (const [id, position] of deployablePositions) {
    candidates.push({
      distance: Vector3.Distance(camera.position, position),
      action: { type: 'attackDeployable', deployableId: id },
    });
  }
  // Structural pieces, so a raider can actually get through a wall. Combat
  // immune ones are left out of the list rather than swung at and refused --
  // GDD section 10 makes that immunity deliberate, so it is not a surprise
  // worth spending a swing to discover.
  if (room) {
    for (const piece of room.state.buildingPieces.values()) {
      if (piece.form === 'foundation' || piece.form === 'pillar') continue;
      const site: PieceSite = {
        form: piece.form as PieceForm,
        storey: piece.storey,
        i: piece.i,
        k: piece.k,
        axis: piece.axis === '' ? null : (piece.axis as 'x' | 'z'),
      };
      const at = worldPositionOf(site);
      candidates.push({
        distance: Vector3.Distance(camera.position, new Vector3(at.x, at.y, at.z)),
        // A door hangs at the same site as its frame; hitting the frame while
        // a door is in it would leave the door floating.
        action: { type: 'attackStructure', door: room.state.doors.has(siteKey(site)), ...site },
      });
    }
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
function inventoryTotals(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const slot of inventorySlots) {
    if (!slot) continue;
    totals.set(slot.definitionId, (totals.get(slot.definitionId) ?? 0) + slot.quantity);
  }
  return totals;
}

function describeInventory(): string {
  const totals = inventoryTotals();
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
  // Everything LMB can hit, closest first, because LMB picks the nearest of
  // them: naming only the nodes would have the HUD point at a wood pile while
  // the click went to the deer standing next to it.
  const swingable: Array<{ label: string; distance: number }> = [];
  for (const node of NODES) {
    swingable.push({ label: node.label, distance: Vector3.Distance(camera.position, node.position) });
  }
  for (const [id, position] of creaturePositions) {
    swingable.push({ label: id, distance: Vector3.Distance(camera.position, position) });
  }
  for (const [id, position] of carcassPositions) {
    swingable.push({ label: `${id} carcass`, distance: Vector3.Distance(camera.position, position) });
  }
  for (const target of swingable.sort((a, b) => a.distance - b.distance).slice(0, 3)) {
    parts.push(`${target.label} ${target.distance.toFixed(1)}m (LMB)`);
  }

  const station = nearestStation();
  if (station) {
    parts.push(`${station.label} ${Vector3.Distance(camera.position, station.position).toFixed(1)}m`);
  }
  // Only while it matters: a warning that is always on the screen stops being
  // read long before the player is standing in the thing it warns about.
  const toHazard = Math.hypot(camera.position.x - HAZARD_ZONE.x, camera.position.z - HAZARD_ZONE.z);
  if (toHazard <= HAZARD_ZONE.radius) parts.push('IN THE HOT-ORE ZONE');
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

/** The body you are standing over, as the server last reported it to you. */
function describeCorpse(): string {
  const corpseId = nearestCorpseId();
  if (!corpseId) return 'none nearby';
  const distance = Vector3.Distance(camera.position, corpsePositions.get(corpseId)!);
  const contents = corpseContents.get(corpseId);
  if (!contents) return `${corpseId} ${distance.toFixed(1)}m (walk closer to see inside)`;
  const filled = contents.slots.filter((slot) => slot !== null);
  const listed =
    filled.length === 0
      ? 'empty'
      : filled
          .slice(0, 6)
          .map((slot) => `${slot!.definitionId} ${slot!.quantity}`)
          .join(', ');
  const more = filled.length > 6 ? ` +${filled.length - 6} more` : '';
  // The manifest is noninteractive (GDD section 12), so it is a count rather
  // than a list: it pages into the slots as they empty.
  const held = contents.overflowCount > 0 ? ` [${contents.overflowCount} held back]` : '';
  return `${corpseId} ${distance.toFixed(1)}m : ${listed}${more}${held} (Q)`;
}

/** What the place key is holding and where it would go (GDD section 10's ghost). */
function describeBuild(): string {
  const held = heldQuantity(selected.definitionId);
  const slot = PLACEABLES.indexOf(selected) + 1;
  if (held < 1) return `${slot}:${selected.definitionId} -- none in pack (1-6 to switch)`;
  const site = ghostSite();
  // "clear here" rather than "allowed": this preview does not know the caps
  // or where other players are standing, so the server can still refuse it.
  const verdict = ghostIsLegal() ? 'clear here' : 'BLOCKED';
  const where = site ? `cell ${site.i},${site.k}${site.axis ? ` ${site.axis}` : ''}` : 'where you face';
  return `${slot}:${selected.definitionId} x${held} -- X places at ${where} (${verdict})`;
}

/** The doorway in front of you, and who the access keys would name. */
function describeDoor(): string {
  const doorway = nearestDoorway();
  if (!doorway || !room) return 'no doorway nearby';
  const at = worldPositionOf(doorway.site);
  const distance = Vector3.Distance(camera.position, new Vector3(at.x, at.y, at.z));
  const door = room.state.doors.get(doorway.key);
  const neighbour = nearestOtherAccountId();
  // Who the grant keys would name, because they name whoever is standing
  // closest and a player has to be able to see which one that is.
  const grants = neighbour
    ? `K/shift-K door access, J/shift-J build access for ${neighbour.slice(0, 8)}`
    : 'nobody nearby to grant access to';
  if (!door) return `empty doorway ${distance.toFixed(1)}m -- 7 then X hangs a door`;
  const max = DOOR_MAX_HP[door.definitionId] ?? 0;
  const condition = door.health < max ? ` ${door.health.toFixed(0)}/${max} hp` : '';
  return `${door.open ? 'OPEN' : 'shut'}${condition} ${distance.toFixed(1)}m (O) : ${grants}`;
}

/** The crate you are standing at, as the server last reported it to you. */
function describeContainer(): string {
  const containerId = nearestContainerId();
  if (!containerId) return 'none nearby (craft one with 40 wood)';
  const distance = Vector3.Distance(camera.position, deployablePositions.get(containerId)!);
  const contents = containerContents.get(containerId);
  if (!contents) return `${containerId} ${distance.toFixed(1)}m (walk closer to see inside)`;
  const filled = contents.slots.filter((slot) => slot !== null);
  const listed =
    filled.length === 0 ? 'empty' : filled.map((slot) => `${slot!.definitionId} ${slot!.quantity}`).join(', ');
  return `${containerId} ${distance.toFixed(1)}m : ${listed} (Z store, H take)`;
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

  // An open door swings aside rather than vanishing, so "open" reads as a
  // door standing open instead of a doorway nobody ever fitted one to.
  for (const [key, mesh] of doorMeshes) {
    const door = room?.state.doors.get(key);
    if (!door) continue;
    mesh.rotation.y = door.open ? (door.axis === 'x' ? Math.PI / 2 : -Math.PI / 2) : 0;
  }

  // The ghost only appears while the player is holding the selected piece;
  // a permanent translucent box in front of the camera is just clutter.
  const holding = heldQuantity(selected.definitionId) > 0;
  ghostMesh.setEnabled(holding && !death);
  if (holding) {
    const site = ghostSite();
    if (site) {
      const shape = pieceShape(site.form, site.axis ?? '');
      ghostMesh.scaling.set(shape.width / 0.9, shape.height / 0.7, shape.depth / 0.9);
      const at = worldPositionOf(site);
      const lift = site.form === 'pillar' ? STOREY_HEIGHT_M / 2 : 0;
      ghostMesh.position.set(at.x, at.y + lift, at.z);
    } else {
      ghostMesh.scaling.set(1, 1, 1);
      const position = ghostPosition();
      ghostMesh.position.set(position.x, position.y + 0.35, position.z);
    }
    ghostMesh.material = ghostIsLegal() ? ghostOkMaterial : ghostBadMaterial;
  }

  const now = performance.now();
  if (now - hudAtMs >= HUD_INTERVAL_MS) {
    hudAtMs = now;
    statusEl.textContent = room
      ? [
          // GDD section 12's respawn prompt. First line, because while it is
          // showing nothing else the player presses will be accepted.
          ...(death
            ? [
                `YOU DIED -- ENTER to respawn${myAnchorId() ? ', SHIFT+ENTER for your bedroll' : ''}  (your body: ${death.corpseId ?? 'gone'})`,
              ]
            : []),
          ...(respawnNotice ? [respawnNotice] : []),
          `account ${accountId.slice(0, 8)}  epoch ${sessionEpoch}  players ${room.state.players.size}`,
          `${engine.getFps().toFixed(0)} fps render : ${MOVE_SEND_HZ} Hz sim`,
          `hp ${vitals.health.toFixed(0)}  cal ${vitals.calories.toFixed(0)}  exposure ${vitals.exposure.toFixed(0)}  ${vitals.phase}${vitals.coldDeficit > 0 ? `  COLD ${vitals.coldDeficit.toFixed(0)}` : ''}`,
          `pack: ${describeInventory()}`,
          `craft: ${describeCrafting()}`,
          `near: ${describeNearest()}`,
          `station: ${describeStation()}`,
          `body: ${describeCorpse()}`,
          `build: ${describeBuild()}`,
          `crate: ${describeContainer()}`,
          `door: ${describeDoor()}`,
          `using: ${
            channel && channel.definitionId
              ? `${channel.definitionId} ${channel.elapsedS.toFixed(1)}/${channel.durationS.toFixed(0)}s`
              : 'nothing'
          }`,
          `last:${statusEl.dataset.lastResult ?? '-'}${entered ? '' : `  (${lookError ?? 'click canvas to look'})`}`,
          'WASD move : shift sprint : space jump : LMB swing at what you face : E take',
          'C craft hatchet : N craft crate : 1-8 pick what to place : X place it : Q loot a body : O door',
          'Z store in crate : H take from crate : M craft one of the selected piece : P repair',
          'B bandage : V eat : at a station -- F fuel : R input : G light/snuff : T take output',
        ].join('\n')
      : disconnectReason
        ? `${disconnectReason} -- reload to reconnect`
        : 'not connected';
  }

  scene.render();
});

window.addEventListener('resize', () => engine.resize());
