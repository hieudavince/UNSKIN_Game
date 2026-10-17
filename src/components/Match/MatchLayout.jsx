import { useEffect, useRef, useState } from 'react';
import ActionPhase, {
  beginPaint,
  cancelPaint,
  commitPaint,
  emitInventory,
  installChip,
  inventorySlots,
  rebuildMasks,
  reloadGun,
  swingMelee,
  updateBombs,
  updateReload,
  updateTracers,
  updateCombat,
  updateHighlight,
  updatePaint,
  useUtility,
  surfaceAt,
  isEnemy,
} from './ActionPhase';
import BuyPhase from './BuyPhase';
import HUD from '../HUD/HUD';
import PostRoundAnalysis, { roundOutcome } from './PostRoundAnalysis';
import { buildArena, freeSpot, meshBox, restoreArena } from './PrepPhase';
import { makeSfx } from '../../audio/sfx';
import { loadThree } from '../../three/loadThree';
import { getSettings } from '../../settings';
import { modeOf } from '../../constants/modes';
import SettingsPanel from '../SettingsPanel';
import Scoreboard from '../HUD/Scoreboard';
import { applyNetPhase } from './netPhase';
import { createNet } from './netSync';
import { createViewmodel, showWeapon, syncEmitter, updateViewmodel } from './Viewmodel';
import { serverNow } from '../../firebase/config';
import { advancePhase, reportRound } from '../../firebase/matchService';
import { useMatchStore } from '../../store/matchStore';
import {
  freshAmmo,
  GUNS,
  gunSkinOf,
  MAX_CREDITS,
  ROUND_LOSS_CREDITS,
  ROUND_WIN_CREDITS,
  suitOf,
} from '../../constants/weapons';

const PHASE_MS = { buy: 15000, action: 120000, result: 5000 };
// Offline FFA preview (no server): short warm-up, long action phase.
const FFA_LOCAL_MS = { buy: 6000, action: 480000, result: 8000 };
const RESPAWN_MS = 3000;

// DEV preview routes (?preview=ffa) run the FFA rules offline.
function previewParams() {
  if (!import.meta.env?.DEV) return null;
  return new URLSearchParams(window.location.search);
}
function previewMode() {
  return previewParams()?.get('preview') === 'ffa' ? 'FFA' : 'PRACTICE';
}
const PROTECT_MS = 2000;
const SPEED = 6;
const WALK_SPEED = 2.45;
const CROUCH_SPEED = 2.9;
const GROUND_ACCEL = 70;
const AIR_ACCEL = 35;
const GRAVITY = 22;
const JUMP = 7.2;
const EYE = 1.6;
const CROUCH_EYE = 0.78;
const PLAYER_RADIUS = 0.34;
const PLAYER_HEIGHT = 1.7;
const CROUCH_HEIGHT = 1.02;
const PITCH_LIMIT = 89 * Math.PI / 180;

const DEFAULT_CONFIG = {
  playerName: 'Player',
  faction: 'atlas',
  bannedMaterial: null,
  pickedLoadout: ['titanium'],
};

function cleanBanned(value) {
  if (!value) return null;
  const name = String(value).toLowerCase();
  if (name === 'titanium' || name === 'glass' || name === 'rubber' || name === 'wood' || name === 'iron') return name;
  return null;
}

function readConfig() {
  const fallback = () => ({
    playerName: DEFAULT_CONFIG.playerName,
    faction: DEFAULT_CONFIG.faction,
    bannedMaterial: null,
    pickedLoadout: ['titanium'],
  });
  try {
    const raw = localStorage.getItem('matchConfig');
    if (!raw) return fallback();
    const parsed = JSON.parse(raw);
    const faction = String(parsed.faction || 'atlas').toLowerCase().includes('outlier')
      ? 'outliers'
      : 'atlas';
    const bannedMaterial = cleanBanned(parsed.bannedMaterial);
    const pickedLoadout = Array.isArray(parsed.pickedLoadout)
      ? parsed.pickedLoadout
        .map((item) => String(item).toLowerCase())
        .filter((name) => (name === 'titanium' || name === 'glass' || name === 'rubber') && name !== bannedMaterial)
      : ['titanium'];
    const playerName = String(parsed.playerName || 'Player').slice(0, 24) || 'Player';
    return { playerName, faction, bannedMaterial, pickedLoadout };
  } catch {
    return fallback();
  }
}

function createMaterials(THREE) {
  const list = [];
  const make = (material) => {
    list.push(material);
    return material;
  };
  const mats = {
    titanium: make(new THREE.MeshLambertMaterial({ color: 0x3a3f46, emissive: 0x000000 })),
    glass: make(new THREE.MeshLambertMaterial({
      color: 0xa8fff6,
      emissive: 0x1d6e68,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      side: THREE.DoubleSide,
    })),
    rubber: make(new THREE.MeshLambertMaterial({ color: 0xe07020, emissive: 0x2a0e00, side: THREE.DoubleSide })),
    wood: make(new THREE.MeshLambertMaterial({ color: 0x8d5a34, emissive: 0x000000, side: THREE.DoubleSide })),
    iron: make(new THREE.MeshLambertMaterial({ color: 0x8b949e, emissive: 0x000000, side: THREE.DoubleSide })),
    deck: make(new THREE.MeshLambertMaterial({ color: 0x5c656e, emissive: 0x000000, side: THREE.DoubleSide })),
    console: make(new THREE.MeshLambertMaterial({
      color: 0x14241f, emissive: 0x0c3d34, emissiveIntensity: 0.7,
    })),
    hacked: make(new THREE.MeshLambertMaterial({
      color: 0x12301c, emissive: 0x39e07a, emissiveIntensity: 0.85,
    })),
    extractor: make(new THREE.MeshLambertMaterial({
      color: 0x1a3f3a, emissive: 0x14685c, emissiveIntensity: 0.55,
    })),
    charge: make(new THREE.MeshLambertMaterial({
      color: 0xff6a2a, emissive: 0xff4a1a, emissiveIntensity: 0.8,
    })),
    chargeDim: make(new THREE.MeshLambertMaterial({
      color: 0x6a2a16, emissive: 0x3a1208, emissiveIntensity: 0.3,
    })),
  };
  return { mats, list };
}

function approach(current, target, maxDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function playerBox(x, feetY, z, height = PLAYER_HEIGHT) {
  return {
    minX: x - PLAYER_RADIUS,
    maxX: x + PLAYER_RADIUS,
    minY: feetY,
    maxY: feetY + height,
    minZ: z - PLAYER_RADIUS,
    maxZ: z + PLAYER_RADIUS,
  };
}

function supportHeight(game, x, z, feetY) {
  const radius = 0.2;
  const limit = feetY + 0.28;
  const tops = [];
  const sample = (mesh) => {
    if (mesh.userData.kind !== 'floor' || mesh.userData.solid === false) return;
    if (mesh.userData.stamp || mesh.userData.structural) return;
    let bounce = !!mesh.userData.bounce;
    let material = mesh.userData.materialName;
    if ((mesh.userData.axis || 'y') === 'y' && (mesh.userData.openings || mesh.userData.stamps)) {
      const cell = surfaceAt(mesh, { u: x, v: z });
      if (cell.open) return;
      bounce = cell.material === 'rubber';
      material = cell.material || material;
    }
    const bounds = meshBox(mesh);
    if (bounds.maxY > limit) return;
    if (x + radius <= bounds.minX || x - radius >= bounds.maxX) return;
    if (z + radius <= bounds.minZ || z - radius >= bounds.maxZ) return;
    tops.push({ top: bounds.maxY, bounce, material });
  };
  for (const mesh of game.floors) sample(mesh);
  for (const mesh of game.surfaces) sample(mesh);
  tops.sort((a, b) => b.top - a.top);
  for (const item of tops) {
    if (!bodyInWall(game, x, item.top + 0.05, z)) return item;
  }
  return tops.length ? tops[tops.length - 1] : { top: -100, bounce: false };
}

function bodyInWall(game, x, feetY, z) {
  const height = game.player.bodyHeight || PLAYER_HEIGHT;
  const box = playerBox(x, feetY, z, height);
  for (const mesh of game.moveMask) {
    if (!blocksMove(mesh, feetY)) continue;
    const bounds = meshBox(mesh);
    if (box.minX >= bounds.maxX || box.maxX <= bounds.minX) continue;
    if (box.minY >= bounds.maxY || box.maxY <= bounds.minY) continue;
    if (box.minZ >= bounds.maxZ || box.maxZ <= bounds.minZ) continue;
    return true;
  }
  return false;
}

function clampCeiling(game, player) {
  const radius = 0.22;
  const height = player.bodyHeight || PLAYER_HEIGHT;
  let head = player.feetY + height;
  for (const mesh of game.floors) {
    if (mesh.userData.solid === false) continue;
    const bounds = meshBox(mesh);
    if (player.x + radius <= bounds.minX || player.x - radius >= bounds.maxX) continue;
    if (player.z + radius <= bounds.minZ || player.z - radius >= bounds.maxZ) continue;
    if (player.feetY >= bounds.minY - 0.02) continue;
    if (head > bounds.minY) {
      player.feetY = bounds.minY - height - 0.02;
      if (player.vy > 0) player.vy = 0;
      head = player.feetY + height;
    }
  }
}

function rubberBoost(game) {
  return game.player.onRubber ? 1.7 : 1;
}

function blocksMove(mesh, feetY, height = PLAYER_HEIGHT) {
  if (mesh.userData.solid === false || mesh.userData.kind === 'floor') return false;
  const bounds = meshBox(mesh);
  if (bounds.maxY <= feetY + 0.4) return false;
  if (bounds.minY >= feetY + height) return false;
  return true;
}

function resolveAxis(game, x, feetY, z, axis) {
  const height = game.player.bodyHeight || PLAYER_HEIGHT;
  const box = playerBox(x, feetY, z, height);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const mesh of game.moveMask) {
      if (!blocksMove(mesh, feetY, height)) continue;
      const bounds = meshBox(mesh);
      if (box.minX >= bounds.maxX || box.maxX <= bounds.minX) continue;
      if (box.minY >= bounds.maxY || box.maxY <= bounds.minY) continue;
      if (box.minZ >= bounds.maxZ || box.maxZ <= bounds.minZ) continue;
      if (axis === 'x') {
        const mid = (box.minX + box.maxX) * 0.5;
        const other = (bounds.minX + bounds.maxX) * 0.5;
        const pen = mid < other ? box.maxX - bounds.minX + 0.002 : bounds.maxX - box.minX + 0.002;
        const push = mid < other ? -pen : pen;
        box.minX += push;
        box.maxX += push;
        if ((mesh.userData.bounce || mesh.userData.materialName === 'rubber') && Math.abs(game.player.vx) > 1.4) {
          game.player.vx = -game.player.vx * 0.88;
        }
      } else {
        const mid = (box.minZ + box.maxZ) * 0.5;
        const other = (bounds.minZ + bounds.maxZ) * 0.5;
        const pen = mid < other ? box.maxZ - bounds.minZ + 0.002 : bounds.maxZ - box.minZ + 0.002;
        const push = mid < other ? -pen : pen;
        box.minZ += push;
        box.maxZ += push;
        if ((mesh.userData.bounce || mesh.userData.materialName === 'rubber') && Math.abs(game.player.vz) > 1.4) {
          game.player.vz = -game.player.vz * 0.88;
        }
      }
    }
  }
  return axis === 'x' ? (box.minX + box.maxX) * 0.5 : (box.minZ + box.maxZ) * 0.5;
}

function wishVelocity(game, allowMove) {
  const keys = game.input.keys;
  let speed = SPEED;
  if (keys.ShiftLeft || keys.ShiftRight) speed = WALK_SPEED;
  if ((game.player.crouch || 0) > 0.45) speed = Math.min(speed, CROUCH_SPEED);
  let forward = 0;
  let strafe = 0;
  if (allowMove) {
    if (keys.KeyW) forward += 1;
    if (keys.KeyS) forward -= 1;
    if (keys.KeyD) strafe += 1;
    if (keys.KeyA) strafe -= 1;
  }
  const mag = Math.hypot(forward, strafe);
  if (mag > 0) {
    forward /= mag;
    strafe /= mag;
  }
  const facing = game.camera.getWorldDirection(game._fwd);
  facing.y = 0;
  const flat = Math.hypot(facing.x, facing.z);
  if (flat < 0.0001) {
    facing.set(-Math.sin(game.player.yaw), 0, -Math.cos(game.player.yaw));
  } else {
    facing.multiplyScalar(1 / flat);
  }
  game._right.crossVectors(facing, game._up);
  if (game._right.lengthSq() > 0) game._right.normalize();
  return {
    x: (facing.x * forward + game._right.x * strafe) * speed,
    z: (facing.z * forward + game._right.z * strafe) * speed,
  };
}

// Spawn point for this round. Team modes use the team spawn plus a sideways
// offset per teammate; FFA picks the spawn farthest from every live enemy.
function pickSpawn(game) {
  if (game.ffa && game.ffaSpawns?.length) {
    const enemies = (game.remoteList || []).filter((remote) => remote.alive && remote.seen);
    if (!enemies.length) {
      const index = ((game.spawnIndex || 0) + (game.respawns || 0) * 3) % game.ffaSpawns.length;
      return game.ffaSpawns[index];
    }
    let best = null;
    let bestScore = -1;
    for (const spot of game.ffaSpawns) {
      let near = Infinity;
      for (const remote of enemies) {
        const p = remote.body.position;
        near = Math.min(near, Math.hypot(p.x - spot.x, p.z - spot.z) + Math.abs(p.y - 0.66 - spot.y) * 2);
      }
      const score = near + Math.random() * 2;
      if (score > bestScore) {
        bestScore = score;
        best = spot;
      }
    }
    return best;
  }
  const spawn = game.spawns[game.faction] || game.spawns.atlas;
  return { ...spawn, x: spawn.x + (game.spawnOffset || 0) };
}

function placePlayer(game) {
  const spawn = pickSpawn(game);
  const player = game.player;
  const y = spawn.y || 0;
  const spot = freeSpot(game, spawn.x, y, spawn.z);
  player.x = spot.x;
  player.feetY = y;
  player.z = spot.z;
  player.yaw = spawn.yaw || 0;
  game.spawnPoint = { x: player.x, z: player.z };
  player.pitch = 0;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.onGround = true;
  player.jumpLatch = false;
  player.crouch = 0;
  player.bodyHeight = PLAYER_HEIGHT;
}

// Small prompt under the crosshair when the objective can be used.
function objectiveHint(game) {
  if (game.ffa || game.phase !== 'action' || game.player.hp <= 0) return null;
  if (game.faction !== 'atlas' || game.hackingChips <= 0 || game.uplinkEndsAt) return null;
  if (!game.uplinkMesh) game.uplinkMesh = game.props.find((mesh) => mesh.userData.uplink) || null;
  const uplink = game.uplinkMesh;
  if (!uplink) return null;
  const dx = uplink.position.x - game.player.x;
  const dz = uplink.position.z - game.player.z;
  if (dx * dx + dz * dz > 25) return null;
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  game.raycaster.set(game._o, game._d);
  game.raycaster.far = 3.2;
  const hits = game.raycaster.intersectObjects([uplink], false);
  return hits.length ? 'E · INSTALL CHIP' : 'UPLINK · LOOK AT IT AND PRESS E';
}

function hasHeadroom(game, player, height) {
  const head = player.feetY + height;
  const radius = 0.22;
  for (const mesh of game.floors) {
    if (mesh.userData.solid === false) continue;
    const bounds = meshBox(mesh);
    if (player.x + radius <= bounds.minX || player.x - radius >= bounds.maxX) continue;
    if (player.z + radius <= bounds.minZ || player.z - radius >= bounds.maxZ) continue;
    if (player.feetY >= bounds.minY - 0.02) continue;
    if (head > bounds.minY - 0.04) return false;
  }
  return true;
}

function updateStance(game, dt, allowMove) {
  const player = game.player;
  let want = allowMove && game.input.keys.KeyC ? 1 : 0;
  if (want < 1 && (player.crouch || 0) > 0.15 && !hasHeadroom(game, player, PLAYER_HEIGHT)) want = 1;
  player.crouch = approach(player.crouch || 0, want, dt * 7);
  player.bodyHeight = PLAYER_HEIGHT + (CROUCH_HEIGHT - PLAYER_HEIGHT) * player.crouch;
}

function updatePlayer(game, dt, allowMove) {
  const player = game.player;
  updateStance(game, dt, allowMove);
  const wish = wishVelocity(game, allowMove);
  const accel = player.onGround ? GROUND_ACCEL : AIR_ACCEL;
  if (player.onGround && wish.x === 0 && wish.z === 0) {
    player.vx = 0;
    player.vz = 0;
  } else {
    player.vx = approach(player.vx, allowMove ? wish.x : 0, accel * dt);
    player.vz = approach(player.vz, allowMove ? wish.z : 0, accel * dt);
  }

  if (allowMove && game.input.keys.Space && player.onGround && !player.jumpLatch) {
    player.vy = JUMP * rubberBoost(game);
    player.onGround = false;
  }
  player.jumpLatch = !!game.input.keys.Space;

  const wasGrounded = player.onGround;
  const fallSpeed = -player.vy;
  const groundSpeed = Math.hypot(player.vx, player.vz);
  const steps = Math.max(1, Math.ceil((groundSpeed * dt) / 0.12));
  const step = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    player.vy = Math.max(-28, player.vy - GRAVITY * step);
    player.x = resolveAxis(game, player.x + player.vx * step, player.feetY, player.z, 'x');
    player.z = resolveAxis(game, player.x, player.feetY, player.z + player.vz * step, 'z');
    const prevFeet = player.feetY;
    player.feetY += player.vy * step;
    clampCeiling(game, player);
    const support = supportHeight(game, player.x, player.z, prevFeet);
    if (player.feetY < (game.map?.levels?.[0] ?? 0) - 8) {
      placePlayer(game);
      break;
    }
    if (player.vy <= 0 && player.feetY <= support.top) {
      const impact = -player.vy;
      player.feetY = support.top;
      player.onRubber = support.bounce;
      player.groundMaterial = support.material;
      if (support.bounce && impact > 2.4) {
        player.vy = Math.min(13.5, impact * 0.84);
        player.onGround = false;
      } else {
        player.vy = 0;
        player.onGround = true;
      }
    } else {
      player.onGround = false;
    }
  }
  if (!wasGrounded && player.onGround && fallSpeed > 5) game.sfx.land();
  if (player.onGround && groundSpeed > 3.2) {
    game.stepDist = (game.stepDist || 0) + groundSpeed * dt;
    if (game.stepDist > 2.1) {
      game.stepDist = 0;
      game.sfx.step({ gain: 0.4, material: player.groundMaterial });
    }
  } else {
    game.stepDist = 1.4;
  }
  separatePlayer(game);
  if ((game.phase === 'buy' || game.phase === 'prep') && game.spawnPoint) {
    const dx = player.x - game.spawnPoint.x;
    const dz = player.z - game.spawnPoint.z;
    const dist = Math.hypot(dx, dz);
    const leash = 4.5;
    if (dist > leash) {
      player.x = game.spawnPoint.x + (dx / dist) * leash;
      player.z = game.spawnPoint.z + (dz / dist) * leash;
    }
  }
}

function separatePlayer(game) {
  const player = game.player;
  const height = player.bodyHeight || PLAYER_HEIGHT;
  for (let pass = 0; pass < 4; pass += 1) {
    const box = playerBox(player.x, player.feetY, player.z, height);
    let best = null;
    for (const mesh of game.moveMask) {
      if (!blocksMove(mesh, player.feetY, height)) continue;
      const bounds = meshBox(mesh);
      const xPen = Math.min(box.maxX, bounds.maxX) - Math.max(box.minX, bounds.minX);
      const yPen = Math.min(box.maxY, bounds.maxY) - Math.max(box.minY, bounds.minY);
      const zPen = Math.min(box.maxZ, bounds.maxZ) - Math.max(box.minZ, bounds.minZ);
      if (xPen <= 0 || yPen <= 0 || zPen <= 0) continue;
      const pen = Math.min(xPen, zPen);
      if (!best || pen < best.pen) best = { pen, xPen, zPen, bounds, box };
    }
    if (!best) return;
    if (best.xPen < best.zPen) {
      const mid = (best.box.minX + best.box.maxX) * 0.5;
      const other = (best.bounds.minX + best.bounds.maxX) * 0.5;
      player.x += mid < other ? -best.xPen - 0.002 : best.xPen + 0.002;
    } else {
      const mid = (best.box.minZ + best.box.maxZ) * 0.5;
      const other = (best.bounds.minZ + best.bounds.maxZ) * 0.5;
      player.z += mid < other ? -best.zPen - 0.002 : best.zPen + 0.002;
    }
  }
}

function applyLook(game) {
  const { camera, player } = game;
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = 0;
  camera.updateMatrixWorld();
}

function applyCameraPosition(game) {
  const { camera, player } = game;
  const eye = EYE + (CROUCH_EYE - EYE) * (player.crouch || 0);
  camera.position.set(player.x, player.feetY + eye, player.z);
  camera.updateMatrixWorld();
}

function publishClock(game, now) {
  const left = Math.max(0, Math.ceil((game.phaseEndsAt - now) / 1000));
  if (left === game.sentTime && game.sentPhase === game.phase) return;
  game.sentTime = left;
  game.sentPhase = game.phase;
  game.emit('game:phase', { phase: game.phase, timeLeft: left });
}

const RETICLE = {
  pistol: 'PISTOL',
  rifle: 'RIFLE',
  shotgun: 'SHOTGUN',
  sniper: 'SNIPER',
  melee: 'KNIFE',
  utility: 'BOMB',
};
const GUN_MODES = ['pistol', 'rifle', 'shotgun', 'sniper'];

const PORTAL_UI = {
  glass: '#9bfff0',
  wood: '#e0a15a',
  iron: '#d7dee6',
  rubber: '#ff9a3c',
};

const HIT_RED = '#ff3b30';

function useHitFeedback() {
  const [hit, setHit] = useState(null);
  const [pops, setPops] = useState([]);
  useEffect(() => {
    let clear = 0;
    const timers = new Set();
    const later = (fn, ms) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    };
    const onHit = (event) => {
      const detail = event.detail || {};
      const id = `${performance.now()}-${Math.random()}`;
      const head = !!detail.head;
      const kill = !!detail.kill;
      setHit({ id, head, kill });
      clearTimeout(clear);
      clear = later(() => setHit(null), kill ? 450 : 260);
      const pop = { id, dmg: detail.dmg, head, kill, dx: Math.round((Math.random() - 0.5) * 40) };
      setPops((items) => [...items.slice(-5), pop]);
      later(() => setPops((items) => items.filter((item) => item.id !== id)), 850);
    };
    window.addEventListener('game:hitmarker', onHit);
    return () => {
      window.removeEventListener('game:hitmarker', onHit);
      for (const id of timers) clearTimeout(id);
    };
  }, []);
  return { hit, pops };
}

function SniperScope({ hit }) {
  return (
    <div className="scope">
      <div className={`scope-lens${hit ? ' hit' : ''}`}>
        <span className="scope-post left" />
        <span className="scope-post right" />
        <span className="scope-post bottom" />
        <span className="scope-line h" />
        <span className="scope-line v" />
        <span className="scope-dot" />
      </div>
    </div>
  );
}

function ReloadBar({ reload }) {
  const total = Math.max(1, reload.until - reload.startedAt);
  const elapsed = Math.min(total, Math.max(0, performance.now() - reload.startedAt));
  return (
    <div className="reload-meter">
      <span>RELOADING</span>
      <i style={{ animationDuration: `${total}ms`, animationDelay: `-${elapsed}ms` }} />
    </div>
  );
}

function Crosshair({ weapon, material, stock, chips, ads, reload, hint, protectedFor }) {
  const { hit, pops } = useHitFeedback();
  const scoped = weapon === 'sniper' && ads;
  const baseColor = weapon === 'portal' ? (PORTAL_UI[material] || '#fff') : 'rgba(244,247,251,0.94)';
  const color = hit && GUN_MODES.includes(weapon) ? HIT_RED : baseColor;
  const label = weapon === 'portal'
    ? `${(material || 'glass').toUpperCase()}  ${stock?.[material] ?? 0} m²`
    : weapon === 'hack'
      ? `CHIP  ×${chips}`
      : weapon === 'utility'
        ? 'BOMB  2.5s'
        : (RETICLE[weapon] || '');
  const bar = (style) => (
    <span
      style={{
        position: 'absolute',
        background: color,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
        ...style,
      }}
    />
  );

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      {scoped ? <SniperScope hit={!!hit} /> : null}
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 }}>
        {hit ? (
          <div className={`hitmarker${hit.kill ? ' kill' : ''}${hit.head ? ' head' : ''}`} key={hit.id}>
            <span /><span /><span /><span />
          </div>
        ) : null}
        {reload ? <ReloadBar key={reload.startedAt} reload={reload} /> : null}
        {pops.map((pop) => (
          <div
            key={pop.id}
            className={`dmg-pop${pop.head ? ' head' : ''}${pop.kill ? ' kill' : ''}`}
            style={{ left: 22 + pop.dx }}
          >
            {pop.dmg}
          </div>
        ))}
        {GUN_MODES.includes(weapon) && !scoped && (
          <>
            {bar({ width: 2, height: 9, left: -1, top: -18 })}
            {bar({ width: 2, height: 9, left: -1, top: 9 })}
            {bar({ width: 9, height: 2, top: -1, left: -18 })}
            {bar({ width: 9, height: 2, top: -1, left: 9 })}
            {bar({ width: 3, height: 3, left: -1.5, top: -1.5 })}
          </>
        )}
        {weapon === 'portal' && (
          <span
            style={{
              position: 'absolute',
              left: -12,
              top: -12,
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: `1.5px solid ${color}`,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.25)',
            }}
          />
        )}
        {weapon === 'melee' && (
          <span
            style={{
              position: 'absolute',
              left: -5,
              top: -5,
              width: 10,
              height: 10,
              border: `1.5px solid ${color}`,
              transform: 'rotate(45deg)',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
            }}
          />
        )}
        {weapon === 'utility' && (
          <span
            style={{
              position: 'absolute',
              left: -6,
              top: -6,
              width: 12,
              height: 12,
              borderRadius: 3,
              border: `1.5px solid ${color}`,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
            }}
          />
        )}
        {weapon === 'hack' && (
          <>
            {bar({ width: 8, height: 2, left: -12, top: -8 })}
            {bar({ width: 2, height: 8, left: -12, top: -8 })}
            {bar({ width: 8, height: 2, left: 4, top: 6 })}
            {bar({ width: 2, height: 8, left: 10, top: 0 })}
          </>
        )}
        {!scoped ? (
          <div
            style={{
              position: 'absolute',
              top: 26,
              left: 0,
              transform: 'translateX(-50%)',
              color,
              font: '600 11px/1 ui-sans-serif, system-ui, sans-serif',
              letterSpacing: '0.18em',
              textShadow: '0 1px 2px rgba(0,0,0,0.9)',
              whiteSpace: 'nowrap',
            }}
          >
            {hit?.kill ? 'ELIMINATED' : label}
          </div>
        ) : null}
        {hint && !scoped ? (
          <div className="aim-hint">{hint}</div>
        ) : null}
        {protectedFor ? <div className="aim-hint protect">SPAWN PROTECTION</div> : null}
      </div>
    </div>
  );
}

export default function MatchLayout({ online = null }) {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const onlineRef = useRef(online);
  const connect = useMatchStore((s) => s.connect);
  const disconnect = useMatchStore((s) => s.disconnect);
  const livePhase = useMatchStore((s) => s.phase);
  const liveEnds = useMatchStore((s) => s.phaseEndsAtMs);
  const liveScore = useMatchStore((s) => s.score);
  const liveRound = useMatchStore((s) => s.currentRound);
  const lastRound = useMatchStore((s) => s.lastRound);
  onlineRef.current = online ? {
    ...online,
    phase: livePhase,
    phaseEndsAtMs: liveEnds,
    score: liveScore,
    round: liveRound,
    lastRound,
  } : null;
  const [phase, setPhase] = useState('buy');
  const [result, setResult] = useState(null);
  const [loadout, setLoadout] = useState({
    weapon: 'pistol',
    material: 'glass',
    stock: { glass: 8, wood: 8, iron: 8, rubber: 8 },
    chips: 1,
    hold: null,
    mag: 12,
    reserve: 36,
    bombs: 0,
    ads: false,
  });
  const [bootError, setBootError] = useState('');
  const [shopOpen, setShopOpen] = useState(false);
  const ffaMode = !!modeOf(online?.mode || previewMode()).ffa;

  useEffect(() => {
    if (!online?.matchId) return undefined;
    connect(online.matchId);
    return () => disconnect();
  }, [online?.matchId, connect, disconnect]);

  useEffect(() => {
    if (phase !== 'buy') setShopOpen(false);
  }, [phase]);

  useEffect(() => {
    let dead = false;
    let game = null;
    const canvas = canvasRef.current;

    const boot = async () => {
      let THREE;
      try {
        THREE = await loadThree();
      } catch (error) {
        if (!dead) setBootError(error.message || 'Three.js failed to load');
        return;
      }
      if (dead || !canvas) return;

      const config = readConfig();
      const seat = onlineRef.current;
      if (seat?.matchId) {
        config.playerName = String(seat.playerName || config.playerName).slice(0, 24) || 'Player';
        config.faction = seat.faction === 'outliers' ? 'outliers' : 'atlas';
        config.bannedMaterial = cleanBanned(seat.bannedMaterial);
        if (Array.isArray(seat.pickedLoadout) && seat.pickedLoadout.length) {
          config.pickedLoadout = seat.pickedLoadout
            .map((item) => String(item).toLowerCase())
            .filter((name) => (name === 'titanium' || name === 'glass' || name === 'rubber') && name !== config.bannedMaterial);
        }
        if (!config.pickedLoadout.length) config.pickedLoadout = [config.bannedMaterial === 'titanium' ? 'glass' : 'titanium'];
      }
      const modeInfo = modeOf(seat?.mode || previewMode());
      const ffa = !!modeInfo.ffa;
      const localMs = ffa ? FFA_LOCAL_MS : PHASE_MS;
      const { mats, list } = createMaterials(THREE);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1b2230);
      scene.fog = new THREE.Fog(0x1b2230, 36, 120);
      const camera = new THREE.PerspectiveCamera(78, window.innerWidth / Math.max(window.innerHeight, 1), 0.08, 220);
      scene.add(new THREE.AmbientLight(0xb7c3d6, 0.34));
      scene.add(new THREE.HemisphereLight(0xc9d7ee, 0x3a2c24, 0.42));
      const sun = new THREE.DirectionalLight(0xfff4e5, 0.62);
      sun.position.set(12, 28, 10);
      scene.add(sun);

      const highlightGeo = new THREE.BoxGeometry(1, 1, 1);
      const highlightMat = new THREE.MeshBasicMaterial({
        color: 0x9bfff0,
        wireframe: true,
        transparent: true,
        opacity: 0.95,
      });
      const highlight = new THREE.Mesh(highlightGeo, highlightMat);
      highlight.visible = false;
      highlight.raycast = () => {};
      scene.add(highlight);

      const previewGeo = new THREE.BoxGeometry(1, 1, 1);
      const previewMat = new THREE.MeshBasicMaterial({
        color: 0x9bfff0,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const paintPreview = new THREE.Mesh(previewGeo, previewMat);
      paintPreview.visible = false;
      paintPreview.raycast = () => {};
      scene.add(paintPreview);
      scene.add(camera);

      game = {
        THREE,
        scene,
        camera,
        renderer,
        canvas,
        mats,
        geometries: [highlightGeo, previewGeo],
        materialDisposables: [...list, highlightMat, previewMat],
        floors: [],
        blocks: [],
        surfaces: [],
        props: [],
        bots: [],
        moveMask: [],
        bulletMask: [],
        skinMask: [],
        highlight,
        paintPreview,
        aimMesh: null,
        aimMat: null,
        clock: new THREE.Clock(),
        raycaster: new THREE.Raycaster(),
        _fwd: new THREE.Vector3(),
        _right: new THREE.Vector3(),
        _up: new THREE.Vector3(0, 1, 0),
        _o: new THREE.Vector3(),
        _d: new THREE.Vector3(),
        _n: new THREE.Vector3(),
        player: {
          x: 0, feetY: 0, z: 0, yaw: 0, pitch: 0,
          vx: 0, vy: 0, vz: 0, onGround: true, jumpLatch: false, hp: 100,
          crouch: 0, bodyHeight: 1.7,
        },
        inventory: config.pickedLoadout.slice(),
        slotIndex: 0,
        credits: 800,
        mode: 'pistol',
        owned: { pistol: true, rifle: false, shotgun: false, sniper: false },
        ammo: freshAmmo(),
        bombs: 0,
        ads: false,
        suit: suitOf(seat?.playerSkin),
        gunAccent: gunSkinOf(seat?.gunSkin).accent,
        gunSkin: gunSkinOf(seat?.gunSkin),
        portalMaterial: 'glass',
        ffa,
        modeInfo,
        localMs,
        mapId: seat?.mapId || modeInfo.mapId || 'foundry',
        spawnIndex: seat?.spawnIndex || 0,
        kills: 0,
        deaths: 0,
        respawns: 0,
        respawnAt: 0,
        protectUntil: 0,
        sensitivity: getSettings().sensitivity,
        stock: { glass: 8, wood: 8, iron: 8, rubber: 8 },
        hackingChips: 1,
        paint: null,
        charges: [],
        phase: 'buy',
        phaseEndsAt: performance.now() + localMs.buy,
        sentPhase: '',
        sentTime: -1,
        nextReskinAt: 0,
        lastShot: 0,
        faction: config.faction,
        playerName: config.playerName,
        bannedMaterial: config.bannedMaterial,
        input: {
          keys: {}, firing: false, lookX: 0, lookY: 0,
        },
        audio: null,
        offs: [],
        dead: false,
        raf: 0,
        emit(name, detail) {
          if (this.dead) return;
          window.dispatchEvent(new CustomEvent(name, { detail }));
        },
        onPhase(next, outcome) {
          if (dead) return;
          setPhase(next);
          if (outcome) setResult(outcome);
        },
      };
      game.sfx = makeSfx(game);
      if (import.meta.env?.DEV && seat?.preview) game.preview = seat.preview;
      game.netRef = onlineRef;
      game.matchId = onlineRef.current?.matchId || null;
      game.netHost = !!onlineRef.current?.host;
      game.spawnOffset = onlineRef.current?.spawnOffset || 0;
      game.round = onlineRef.current?.round || 1;
      game.requestAdvance = () => {
        if (!game.matchId) return;
        const token = game.advanceLatch;
        advancePhase(game.matchId).catch(() => {}).finally(() => {
          setTimeout(() => {
            if (game.advanceLatch === token) game.advanceLatch = '';
          }, 1500);
        });
      };
      game.requestRound = (winner, reason) => {
        if (!game.matchId || !game.netHost || game.roundSent) return;
        game.roundSent = true;
        reportRound({ matchId: game.matchId, winner, reason }).catch(() => {
          game.roundSent = false;
        });
      };
      if (seat?.matchId && seat.uid) game.net = createNet(game, seat);
      if (import.meta.env?.DEV) window.__unskin = game;
      gameRef.current = game;
      const pushHud = () => {
        if (dead) return;
        setLoadout({
          weapon: game.mode,
          material: game.portalMaterial,
          stock: {
            glass: game.stock.glass,
            wood: game.stock.wood,
            iron: game.stock.iron,
            rubber: game.stock.rubber,
          },
          chips: game.hackingChips,
          mag: game.ammo?.[game.mode]?.mag ?? 0,
          reserve: game.ammo?.[game.mode]?.reserve ?? 0,
          bombs: game.bombs || 0,
          ads: !!game.ads,
          reload: game.reload ? { startedAt: game.reload.startedAt, until: game.reload.until } : null,
          hint: game.aimHint || null,
          kills: game.kills || 0,
          killTarget: game.modeInfo?.killTarget || 20,
          protectedFor: game.protectUntil > performance.now(),
          hold: game.uplinkEndsAt
            ? Math.max(0, Math.ceil((game.uplinkEndsAt - performance.now()) / 1000))
            : null,
        });
      };
      game.onHud = pushHud;
      game.onHold = (seconds) => {
        if (dead) return;
        setLoadout((current) => ({ ...current, hold: seconds }));
      };
      if (game.portalMaterial === game.bannedMaterial) {
        game.portalMaterial = ['glass', 'wood', 'iron', 'rubber'].find((name) => name !== game.bannedMaterial);
      }
      createViewmodel(game);

      const listen = (target, type, fn, options) => {
        target.addEventListener(type, fn, options);
        game.offs.push(() => target.removeEventListener(type, fn, options));
      };

      const setWeapon = (mode) => {
        if (mode === 'hack' && game.hackingChips <= 0) return;
        if (mode === 'utility' && (game.bombs || 0) <= 0) return;
        if (GUNS[mode] && mode !== 'pistol' && !game.owned?.[mode]) return;
        game.input.firing = false;
        game.ads = false;
        cancelPaint(game);
        if (game.mode !== mode) {
          game.mode = mode;
          showWeapon(game, mode);
          game.sfx.equip();
          game.emit('game:mode', { mode });
        }
        pushHud();
      };
      game.setWeapon = setWeapon;

      const setPortalMaterial = (name) => {
        if (!game.mats[name] || name === game.bannedMaterial) return;
        game.portalMaterial = name;
        syncEmitter(game);
        pushHud();
      };

      const releaseAllKeys = () => {
        game.input.keys = {};
        game.input.firing = false;
      };

      listen(window, 'keydown', (event) => {
        game.input.keys[event.code] = true;
        if (event.code === 'Space') event.preventDefault();
        if (event.repeat) return;
        if (event.code === 'Digit1') setWeapon('pistol');
        if (event.code === 'Digit2') {
          const owned = ['rifle', 'shotgun', 'sniper'].filter((id) => game.owned?.[id]);
          if (!owned.length) return;
          const index = owned.indexOf(game.mode);
          setWeapon(owned[(index + 1) % owned.length]);
        }
        if (event.code === 'Digit3') setWeapon('melee');
        if (event.code === 'Digit4') setWeapon('utility');
        if (event.code === 'Digit5') setWeapon('portal');
        if (event.code === 'KeyR') reloadGun(game);
        // Objective: E installs the extractor chip on the uplink you are looking at,
        // 6 holds the chip in your hand (then click the uplink).
        if (event.code === 'KeyE' && game.phase === 'action' && game.player.hp > 0) installChip(game);
        if (event.code === 'Digit6') setWeapon('hack');
        if (event.code === 'Tab') event.preventDefault();
      });
      listen(window, 'keyup', (event) => {
        game.input.keys[event.code] = false;
      });
      listen(window, 'blur', releaseAllKeys);
      listen(document, 'visibilitychange', () => {
        if (document.hidden) releaseAllKeys();
      });
      listen(window, 'wheel', (event) => {
        if (!game.inventory.length) return;
        game.slotIndex += event.deltaY > 0 ? 1 : -1;
        emitInventory(game);
      }, { passive: true });
      listen(window, 'mousedown', (event) => {
        const target = event.target;
        if (target && target.closest && target.closest('button, a, input, select, label')) return;
        if (event.button === 0 && document.pointerLockElement !== canvas) {
          const lock = canvas.requestPointerLock();
          if (lock && lock.catch) lock.catch(() => {});
          return;
        }
        if (game.phase !== 'action' || game.player.hp <= 0) return;
        if (GUNS[game.mode] && event.button === 0) game.input.firing = true;
        if (event.button === 2 && GUNS[game.mode]) {
          game.ads = true;
          pushHud();
        }
        if (event.button === 2 && game.mode === 'portal') {
          const order = ['glass', 'wood', 'iron', 'rubber'].filter((name) => name !== game.bannedMaterial);
          const index = Math.max(0, order.indexOf(game.portalMaterial));
          setPortalMaterial(order[(index + 1) % order.length]);
        }
        if (game.mode === 'portal' && event.button === 0) beginPaint(game);
        if (game.mode === 'melee' && event.button === 0) swingMelee(game, performance.now());
        if (game.mode === 'utility' && event.button === 0) useUtility(game);
        if (game.mode === 'hack' && event.button === 0) installChip(game);
      });
      listen(window, 'mouseup', (event) => {
        if (event.button === 0) {
          game.input.firing = false;
          if (game.paint) commitPaint(game);
        }
        if (event.button === 2) {
          game.ads = false;
          pushHud();
        }
      });
      listen(window, 'contextmenu', (event) => event.preventDefault());
      listen(document, 'mousemove', (event) => {
        if (document.pointerLockElement !== canvas) return;
        const sens = 0.0022 * (game.sensitivity || 1) * (game.ads ? Math.min(1, camera.fov / 78) : 1);
        game.player.yaw -= event.movementX * sens;
        game.player.pitch -= event.movementY * sens;
        game.input.lookX = event.movementX;
        game.input.lookY = event.movementY;
        if (game.player.pitch > PITCH_LIMIT) game.player.pitch = PITCH_LIMIT;
        if (game.player.pitch < -PITCH_LIMIT) game.player.pitch = -PITCH_LIMIT;
      });
      listen(document, 'pointerlockchange', () => {
        if (document.pointerLockElement !== canvas) {
          releaseAllKeys();
          cancelPaint(game);
          if (game.ads) {
            game.ads = false;
            pushHud();
          }
        }
      });
      listen(window, 'unskin:settings', (event) => {
        const next = event.detail || getSettings();
        game.sensitivity = next.sensitivity;
        game.sfx.setVolume(next.volume);
      });
      listen(window, 'pointerdown', () => {
        if (game.audio && game.audio.state === 'suspended') game.audio.resume();
      });
      listen(window, 'resize', () => {
        camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight, false);
      });

      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      game.offs.push(() => {
        document.body.style.overflow = prevOverflow;
      });

      buildArena(game, game.mapId);

      const finishRound = (cause, fromNet, decided) => {
        if (game.dead || game.phase === 'result') return;
        const mine = game.faction === 'outliers' ? 'OUTLIERS' : 'ATLAS';
        const myUid = game.netRef?.current?.uid || 'me';
        const ffaWinner = decided?.ffaWinner || (game.ffa && !game.matchId ? myUid : null);
        const ffaName = decided?.ffaWinnerName || (ffaWinner === myUid ? game.playerName : 'Someone');
        const outcome = game.ffa
          ? {
            playerWon: ffaWinner === myUid,
            reason: ffaWinner === myUid
              ? `You won with ${game.kills} kills`
              : `${ffaName} won${decided?.ffaKills ? ` with ${decided.ffaKills} kills` : ''} · you: ${game.kills} kills`,
            killText: `${ffaName} wins the match`,
          }
          : decided?.winner
          ? {
            playerWon: decided.winner === mine,
            reason: decided.reason || 'Round over',
            killText: `${decided.winner === 'ATLAS' ? 'Atlas' : 'Outliers'} won the round`,
          }
          : roundOutcome(game, cause);
        game.phase = 'result';
        game.respawnAt = 0;
        game.phaseEndsAt = performance.now() + game.localMs.result;
        game.input.firing = false;
        game.sentPhase = 'result';
        game.sentTime = 5;
        game.emit('game:phase', { phase: 'result', timeLeft: 5 });
        game.emit('game:killfeed', { text: outcome.killText });
        game.sfx.round(outcome.playerWon);
        const reward = game.ffa ? 0 : outcome.playerWon ? ROUND_WIN_CREDITS : ROUND_LOSS_CREDITS;
        const before = game.credits;
        game.credits = Math.min(MAX_CREDITS, game.credits + reward);
        outcome.reward = game.credits - before;
        if (outcome.reward > 0) {
          game.emit('game:credits', { credits: game.credits });
          game.emit('game:killfeed', { text: `+¢${outcome.reward} ${outcome.playerWon ? 'round win' : 'loss bonus'}` });
          game.sfx.reward(outcome.playerWon);
        }
        game.onPhase('result', outcome);
        if (!fromNet && game.matchId && game.netHost && decided?.winner) game.requestRound?.(decided.winner, decided.reason);
      };

      // FFA: the host ends the match when someone reaches the kill target or the
      // clock runs out. The winner itself is computed from live state on write.
      const localLeader = () => {
        let best = { uid: game.netRef?.current?.uid || 'me', name: game.playerName, kills: game.kills, deaths: game.deaths };
        for (const remote of game.remoteList || []) {
          const info = game.net?.playerInfo?.(remote.uid);
          const kills = Number(info?.kills) || 0;
          const deaths = Number(info?.deaths) || 0;
          if (kills > best.kills || (kills === best.kills && deaths < best.deaths)) {
            best = { uid: remote.uid, name: remote.name, kills, deaths };
          }
        }
        return best;
      };
      const ffaDecide = (now) => {
        const done = ffaDecideRaw(now);
        if (!done) return null;
        const leader = localLeader();
        return { ...done, ffaWinner: leader.uid, ffaWinnerName: leader.name, ffaKills: leader.kills };
      };
      const ffaDecideRaw = (now) => {
        const target = game.modeInfo.killTarget || 20;
        if (game.kills >= target) return { winner: 'ATLAS', reason: `${game.playerName} reached ${target} kills` };
        for (const remote of game.remoteList || []) {
          const info = game.net?.playerInfo?.(remote.uid);
          if ((Number(info?.kills) || 0) >= target) return { winner: 'ATLAS', reason: `${remote.name} reached ${target} kills` };
        }
        if ((game.phaseEndsAt - now) <= 0) return { winner: 'ATLAS', reason: 'Time limit' };
        return null;
      };

      const hostDecide = (now) => {
        if (game.ffa) return ffaDecide(now);
        const { counts, roster } = game.net
          ? game.net.aliveCounts()
          : { counts: { ATLAS: game.player.hp > 0 ? 1 : 0, OUTLIERS: 0 }, roster: { ATLAS: 1, OUTLIERS: 0 } };
        if (roster.ATLAS > 0 && counts.ATLAS === 0) return { winner: 'OUTLIERS', reason: 'Atlas eliminated' };
        if (roster.OUTLIERS > 0 && counts.OUTLIERS === 0) return { winner: 'ATLAS', reason: 'Outliers eliminated' };
        if (game.uplinkEndsAt && now >= game.uplinkEndsAt) return { winner: 'ATLAS', reason: 'Uplink held' };
        if ((game.phaseEndsAt - now) <= 0) return { winner: 'OUTLIERS', reason: 'Defense held' };
        return null;
      };

      const startAction = () => {
        if (game.dead) return;
        game.roundSent = false;
        game.phase = 'action';
        game.phaseEndsAt = performance.now() + game.localMs.action;
        game.nextReskinAt = performance.now() + 10000;
        game.lastShot = 0;
        game.input.firing = false;
        game.sentPhase = 'action';
        game.sentTime = Math.round(game.localMs.action / 1000);
        game.emit('game:phase', { phase: 'action', timeLeft: game.sentTime });
        if (game.ffa) {
          game.protectUntil = performance.now() + PROTECT_MS;
          game.onHud?.();
        }
        game.onPhase('action', null);
      };

      const startBuy = () => {
        if (game.dead) return;
        cancelPaint(game);
        restoreArena(game);
        placePlayer(game);
        game.player.hp = 100;
        game.uplinkEndsAt = 0;
        game.holdSent = null;
        game.reload = null;
        if (game.charges) {
          for (const charge of game.charges) game.scene.remove(charge.mesh);
          game.charges = [];
        }
        if (game.blasts) {
          for (const blast of game.blasts) {
            game.scene.remove(blast.mesh);
            game.scene.remove(blast.ring);
            game.scene.remove(blast.light);
            for (const spark of blast.sparks) game.scene.remove(spark.mesh);
          }
          game.blasts = [];
        }
        if (game.ffa) {
          // FFA: no shop, everyone starts with the full kit.
          game.owned = { pistol: true, rifle: true, shotgun: true, sniper: true };
          game.ammo = freshAmmo();
          for (const id of ['rifle', 'shotgun', 'sniper']) game.ammo[id] = { mag: GUNS[id].mag, reserve: GUNS[id].reserve };
          game.bombs = 2;
          game.stock = { glass: 16, wood: 16, iron: 16, rubber: 16 };
          game.hackingChips = 0;
          game.kills = 0;
          game.deaths = 0;
          game.respawnAt = 0;
          if (!GUNS[game.mode] || game.mode === 'pistol') {
            game.mode = 'rifle';
            showWeapon(game, 'rifle');
          }
        }
        rebuildMasks(game);
        game.phase = 'buy';
        game.phaseEndsAt = performance.now() + game.localMs.buy;
        game.input.firing = false;
        game.sentPhase = 'buy';
        game.sentTime = Math.round(game.localMs.buy / 1000);
        game.emit('game:health', { hp: game.player.hp });
        game.emit('game:credits', { credits: game.credits });
        emitInventory(game);
        game.emit('game:mode', { mode: game.mode });
        game.emit('game:phase', { phase: 'buy', timeLeft: game.sentTime });
        game.onHud?.();
        game.onPhase('buy', null);
      };

      // FFA respawn: 3 s after dying, at the spawn farthest from enemies,
      // with 2 s of spawn protection.
      const respawn = () => {
        game.respawns += 1;
        placePlayer(game);
        game.player.hp = 100;
        game.reload = null;
        game.protectUntil = performance.now() + PROTECT_MS;
        for (const id of ['pistol', 'rifle', 'shotgun', 'sniper']) {
          game.ammo[id] = { mag: GUNS[id].mag, reserve: GUNS[id].reserve };
        }
        game.bombs = Math.max(game.bombs || 0, 1);
        game.net?.revive?.();
        game.emit('game:health', { hp: 100 });
        game.sfx.spawn?.();
        game.onHud?.();
      };
      game.startBuy = startBuy;
      game.startAction = startAction;
      game.finishRound = finishRound;

      startBuy();
      applyLook(game);
      applyCameraPosition(game);
      if (previewParams()?.get('overview')) {
        // DEV screenshot helper: top-down view with the roof hidden.
        const ceiling = game.meshById.get('ceiling');
        if (ceiling) ceiling.visible = false;
        if (game.view?.root) game.view.root.visible = false;
        // &level=N cuts the building above that floor so lower floors are visible
        const level = previewParams().has('level') ? Number(previewParams().get('level')) : NaN;
        const levels = game.map.levels || [0];
        if (Number.isFinite(level) && levels[level + 1] !== undefined) {
          const cut = levels[level + 1] - 0.3;
          for (const mesh of [...game.floors, ...game.blocks, ...game.surfaces, ...game.props]) {
            if (meshBox(mesh).minY >= cut || (mesh.userData.kind === 'floor' && meshBox(mesh).maxY > cut)) mesh.visible = false;
          }
        }
        const b = game.map.bounds;
        game.overview = { x: 0, y: Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.95, z: 2 };
        scene.fog = null;
      }

      const loop = () => {
        if (game.dead) return;
        const now = performance.now();
        const dt = Math.min(game.clock.getDelta(), 0.05);
        applyLook(game);
        const zoom = game.ads && GUNS[game.mode] ? 78 / GUNS[game.mode].zoom : 78;
        game.camera.fov += (zoom - game.camera.fov) * Math.min(1, dt * 12);
        game.camera.updateProjectionMatrix();
        updatePlayer(game, dt, game.phase !== 'result' && game.player.hp > 0);
        applyCameraPosition(game);
        if (game.overview) {
          camera.position.set(game.overview.x, game.overview.y, game.overview.z);
          camera.rotation.set(-Math.PI / 2, 0, 0, 'XYZ');
          camera.far = 400;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld();
        }
        applyNetPhase(game);
        game.net?.update(dt, now);
        const net = game.netRef?.current;
        if (
          game.matchId && game.netHost && net?.phase && net.phase !== 'ACTION'
          && net.phase !== 'DRAFT' && net.phase !== 'COMPLETE'
          && net.phaseEndsAtMs && serverNow() >= net.phaseEndsAtMs + 250
          && game.advanceLatch !== `${net.round}:${net.phase}`
        ) {
          game.advanceLatch = `${net.round}:${net.phase}`;
          game.requestAdvance?.();
        }

        if (game.ffa && game.phase === 'action') {
          if (game.player.hp <= 0 && !game.respawnAt) game.respawnAt = now + RESPAWN_MS;
          if (game.respawnAt && now >= game.respawnAt) {
            game.respawnAt = 0;
            respawn();
          }
          const shielded = game.protectUntil > now;
          if (shielded !== !!game.shieldShown) {
            game.shieldShown = shielded;
            game.onHud?.();
          }
        }
        if (game.phase === 'action') {
          updateCombat(game, dt, now);
          if (game.phase === 'action') {
            if (game.matchId) {
              if (game.netHost) {
                const decided = hostDecide(now);
                if (decided) finishRound(null, false, decided);
              }
            } else {
              const timeLeft = (game.phaseEndsAt - now) / 1000;
              if (game.ffa) {
                if (timeLeft <= 0) finishRound('timeout', false, { winner: 'ATLAS', reason: 'Time limit' });
              } else if (game.player.hp <= 0) finishRound('death');
              else if (game.uplinkEndsAt && now >= game.uplinkEndsAt) finishRound('uplink');
              else if (timeLeft <= 0) finishRound('timeout');
            }
            if (game.phase === 'action' && game.uplinkEndsAt) {
              const hold = Math.max(0, Math.ceil((game.uplinkEndsAt - now) / 1000));
              if (hold !== game.holdSent) {
                game.holdSent = hold;
                game.onHold?.(hold);
              }
            }
          }
        } else if (!game.matchId && (game.phaseEndsAt - now) / 1000 <= 0) {
          if (game.phase === 'buy' || game.phase === 'prep') startAction(game);
          else if (game.phase === 'result') startBuy(game);
        }

        updateHighlight(game);
        updatePaint(game);
        game.sfx.updateListener(camera);
        if (now - (game.hintAt || 0) > 150) {
          game.hintAt = now;
          const hint = objectiveHint(game);
          if (hint !== game.aimHint) {
            game.aimHint = hint;
            pushHud();
          }
        }
        if (game.uplinkDraw) {
          const active = !!game.uplinkEndsAt && now < game.uplinkEndsAt;
          const percent = active
            ? Math.min(100, Math.round((1 - (game.uplinkEndsAt - now) / 30000) * 100))
            : 0;
          const key = `${active ? 1 : 0}:${percent}`;
          if (key !== game.uplinkKey) {
            game.uplinkKey = key;
            game.uplinkDraw(percent, active);
          }
        }
        updateReload(game, now);
        updateBombs(game, dt);
        updateTracers(game, dt);
        updateViewmodel(game, dt);
        publishClock(game, performance.now());
        renderer.render(scene, camera);
        game.raf = requestAnimationFrame(loop);
      };
      game.raf = requestAnimationFrame(loop);

      if (dead) {
        game.dead = true;
        cancelAnimationFrame(game.raf);
      }
    };

    boot();

    return () => {
      dead = true;
      if (!game) return;
      game.dead = true;
      cancelAnimationFrame(game.raf);
      game.net?.dispose();
      for (const off of game.offs) off();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      game.renderer.dispose();
      game.renderer.forceContextLoss();
      for (const geo of game.geometries) geo.dispose();
      for (const material of game.materialDisposables) material.dispose();
      if (game.audio) game.audio.close();
      if (gameRef.current === game) gameRef.current = null;
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#12151c',
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      {!bootError && (
        <Crosshair
          weapon={loadout.weapon}
          material={loadout.material}
          stock={loadout.stock}
          chips={loadout.chips}
          ads={loadout.ads}
          hold={loadout.hold}
          reload={loadout.reload}
          hint={loadout.hint}
          protectedFor={loadout.protectedFor}
        />
      )}
      {bootError ? (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          color: '#f4f4f4',
          fontFamily: 'system-ui, sans-serif',
        }}
        >
          {bootError}
        </div>
      ) : null}
      {!bootError ? (
        <HUD
          phase={phase}
          loadout={loadout}
          online={onlineRef.current}
          shopOpen={shopOpen}
          onOpenShop={() => setShopOpen(true)}
          onCloseShop={() => setShopOpen(false)}
          ffa={ffaMode}
        />
      ) : null}
      {!bootError ? <Scoreboard gameRef={gameRef} online={onlineRef.current} ffa={ffaMode} /> : null}
      {!bootError ? <SettingsPanel inMatch /> : null}
      {phase === 'buy' && shopOpen && !ffaMode ? <BuyPhase gameRef={gameRef} onClose={() => setShopOpen(false)} /> : null}
      {phase === 'prep' ? (
        <div className="prep-banner">PREP</div>
      ) : null}
      {phase === 'action' ? <ActionPhase /> : null}
      {phase === 'result' && result ? (
        <PostRoundAnalysis playerWon={result.playerWon} reason={result.reason} reward={result.reward} />
      ) : null}
    </div>
  );
}
