import { useEffect, useRef, useState } from 'react';
import ActionPhase, {
  beginPaint,
  cancelPaint,
  commitPaint,
  emitInventory,
  installChip,
  inventorySlots,
  rebuildMasks,
  swingMelee,
  updateBombs,
  updateTracers,
  updateCombat,
  updateHighlight,
  updatePaint,
  useUtility,
} from './ActionPhase';
import BuyPhase from './BuyPhase';
import PostRoundAnalysis, { roundOutcome } from './PostRoundAnalysis';
import { buildArena, meshBox, restoreArena } from './PrepPhase';
import { createViewmodel, showWeapon, syncEmitter, updateViewmodel } from './Viewmodel';

const PHASE_MS = { buy: 15000, action: 120000, result: 5000 };
const SPEED = 6;
const GROUND_ACCEL = 70;
const AIR_ACCEL = 35;
const GRAVITY = 22;
const JUMP = 7.2;
const EYE = 1.6;
const PLAYER_RADIUS = 0.34;
const PLAYER_HEIGHT = 1.7;
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

function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  return new Promise((resolve, reject) => {
    const finish = () => (window.THREE ? resolve(window.THREE) : reject(new Error('Three.js failed to load')));
    let script = document.getElementById('three-r128');
    if (!script) {
      script = document.createElement('script');
      script.id = 'three-r128';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.async = true;
      script.onload = finish;
      script.onerror = () => reject(new Error('Three.js failed to load'));
      document.head.appendChild(script);
      return;
    }
    script.addEventListener('load', finish);
    script.addEventListener('error', () => reject(new Error('Three.js failed to load')));
  });
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
    rubber: make(new THREE.MeshLambertMaterial({ color: 0xe07020, emissive: 0x000000 })),
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

function makeSfx(game) {
  const ensure = () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!game.audio) game.audio = new AudioCtx();
    if (game.audio.state === 'suspended') game.audio.resume();
    return game.audio;
  };
  const tone = ({ type, freq, freqTo, dur, delay = 0, gain }) => {
    const ctx = ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t + dur);
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  return {
    shot: (gain = 0.04) => tone({ type: 'square', freq: 90, dur: 0.08, gain }),
    hit: () => tone({ type: 'sine', freq: 1480, dur: 0.045, gain: 0.05 }),
    unskin: () => tone({ type: 'sine', freq: 240, freqTo: 880, dur: 0.12, gain: 0.05 }),
    reskin: () => tone({ type: 'sine', freq: 760, freqTo: 180, dur: 0.12, gain: 0.05 }),
    swipe: () => tone({ type: 'sine', freq: 340, freqTo: 120, dur: 0.08, gain: 0.045 }),
    error: () => tone({ type: 'square', freq: 180, freqTo: 70, dur: 0.14, gain: 0.045 }),
    blast: () => {
      tone({ type: 'square', freq: 90, dur: 0.16, gain: 0.06 });
      tone({ type: 'sine', freq: 180, freqTo: 50, dur: 0.28, gain: 0.05, delay: 0.04 });
    },
    round: (win) => {
      if (win) {
        tone({ type: 'sine', freq: 523, dur: 0.18, gain: 0.06 });
        tone({ type: 'sine', freq: 784, dur: 0.22, gain: 0.06, delay: 0.14 });
      } else {
        tone({ type: 'sine', freq: 392, dur: 0.18, gain: 0.06 });
        tone({ type: 'sine', freq: 196, dur: 0.24, gain: 0.06, delay: 0.14 });
      }
    },
  };
}

function approach(current, target, maxDelta) {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function playerBox(x, feetY, z) {
  return {
    minX: x - PLAYER_RADIUS,
    maxX: x + PLAYER_RADIUS,
    minY: feetY,
    maxY: feetY + PLAYER_HEIGHT,
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
    const bounds = meshBox(mesh);
    if (bounds.maxY > limit) return;
    if (x + radius <= bounds.minX || x - radius >= bounds.maxX) return;
    if (z + radius <= bounds.minZ || z - radius >= bounds.maxZ) return;
    tops.push(bounds.maxY);
  };
  for (const mesh of game.floors) sample(mesh);
  for (const mesh of game.surfaces) sample(mesh);
  tops.sort((a, b) => b - a);
  for (const top of tops) {
    if (!bodyInWall(game, x, top + 0.05, z)) return top;
  }
  return tops.length ? tops[tops.length - 1] : -100;
}

function bodyInWall(game, x, feetY, z) {
  const box = playerBox(x, feetY, z);
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
  let head = player.feetY + PLAYER_HEIGHT;
  for (const mesh of game.floors) {
    if (mesh.userData.solid === false) continue;
    const bounds = meshBox(mesh);
    if (player.x + radius <= bounds.minX || player.x - radius >= bounds.maxX) continue;
    if (player.z + radius <= bounds.minZ || player.z - radius >= bounds.maxZ) continue;
    if (player.feetY >= bounds.minY - 0.02) continue;
    if (head > bounds.minY) {
      player.feetY = bounds.minY - PLAYER_HEIGHT - 0.02;
      if (player.vy > 0) player.vy = 0;
      head = player.feetY + PLAYER_HEIGHT;
    }
  }
}

function rubberBoost(game) {
  const player = game.player;
  for (const mesh of game.surfaces) {
    if (!mesh.userData.bounce) continue;
    const dx = player.x - mesh.position.x;
    const dy = player.feetY - mesh.position.y;
    const dz = player.z - mesh.position.z;
    if (dx * dx + dy * dy + dz * dz < 2.56) return 2;
  }
  return 1;
}

function blocksMove(mesh, feetY) {
  if (mesh.userData.solid === false || mesh.userData.kind === 'floor') return false;
  const bounds = meshBox(mesh);
  if (bounds.maxY <= feetY + 0.4) return false;
  if (bounds.minY >= feetY + PLAYER_HEIGHT) return false;
  return true;
}

function resolveAxis(game, x, feetY, z, axis) {
  const box = playerBox(x, feetY, z);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const mesh of game.moveMask) {
      if (!blocksMove(mesh, feetY)) continue;
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
      } else {
        const mid = (box.minZ + box.maxZ) * 0.5;
        const other = (bounds.minZ + bounds.maxZ) * 0.5;
        const pen = mid < other ? box.maxZ - bounds.minZ + 0.002 : bounds.maxZ - box.minZ + 0.002;
        const push = mid < other ? -pen : pen;
        box.minZ += push;
        box.maxZ += push;
      }
    }
  }
  return axis === 'x' ? (box.minX + box.maxX) * 0.5 : (box.minZ + box.maxZ) * 0.5;
}

function wishVelocity(game, allowMove) {
  const keys = game.input.keys;
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
    x: (facing.x * forward + game._right.x * strafe) * SPEED,
    z: (facing.z * forward + game._right.z * strafe) * SPEED,
  };
}

function placePlayer(game) {
  const spawn = game.spawns[game.faction];
  const player = game.player;
  player.x = spawn.x;
  player.feetY = 0;
  player.z = spawn.z;
  player.yaw = spawn.yaw;
  player.pitch = 0;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.onGround = true;
  player.jumpLatch = false;
}

function updatePlayer(game, dt, allowMove) {
  const player = game.player;
  releaseKeys(game);
  const wish = wishVelocity(game, allowMove);
  const accel = player.onGround ? GROUND_ACCEL : AIR_ACCEL;
  player.vx = approach(player.vx, allowMove ? wish.x : 0, accel * dt);
  player.vz = approach(player.vz, allowMove ? wish.z : 0, accel * dt);

  if (allowMove && game.input.keys.Space && player.onGround && !player.jumpLatch) {
    player.vy = JUMP * rubberBoost(game);
    player.onGround = false;
  }
  player.jumpLatch = !!game.input.keys.Space;

  const steps = Math.max(1, Math.ceil((Math.hypot(player.vx, player.vz) * dt) / 0.12));
  const step = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    player.vy = Math.max(-28, player.vy - GRAVITY * step);
    player.x = resolveAxis(game, player.x + player.vx * step, player.feetY, player.z, 'x');
    player.z = resolveAxis(game, player.x, player.feetY, player.z + player.vz * step, 'z');
    const prevFeet = player.feetY;
    player.feetY += player.vy * step;
    clampCeiling(game, player);
    const support = supportHeight(game, player.x, player.z, prevFeet);
    if (player.feetY < -8) {
      placePlayer(game);
      break;
    }
    if (player.vy <= 0 && player.feetY <= support) {
      player.feetY = support;
      player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
  }
  separatePlayer(game);
}

function releaseKeys(game) {
  const pending = game.input.releaseAt;
  if (!pending) return;
  const now = performance.now();
  for (const code of Object.keys(pending)) {
    if (pending[code] && now >= pending[code]) {
      game.input.keys[code] = false;
      pending[code] = 0;
    }
  }
}

function separatePlayer(game) {
  const player = game.player;
  for (let pass = 0; pass < 4; pass += 1) {
    const box = playerBox(player.x, player.feetY, player.z);
    let best = null;
    for (const mesh of game.moveMask) {
      if (!blocksMove(mesh, player.feetY)) continue;
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
  camera.position.set(player.x, player.feetY + EYE, player.z);
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
  rifle: 'RIFLE',
  melee: 'MELEE',
  utility: 'BOMB',
};

const PORTAL_UI = {
  glass: '#9bfff0',
  wood: '#e0a15a',
  iron: '#d7dee6',
};

function Crosshair({ weapon, material, stock, chips, hold }) {
  const color = weapon === 'portal' ? (PORTAL_UI[material] || '#fff') : 'rgba(244,247,251,0.94)';
  const label = hold != null
    ? `HOLD  ${hold}`
    : weapon === 'portal'
      ? `${(material || 'glass').toUpperCase()}  ${stock?.[material] ?? 0} m²`
      : weapon === 'hack'
        ? `CHIP  ×${chips}`
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
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 }}>
        {weapon === 'rifle' && (
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
          {label}
        </div>
      </div>
    </div>
  );
}

export default function MatchLayout() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [phase, setPhase] = useState('buy');
  const [result, setResult] = useState(null);
  const [loadout, setLoadout] = useState({
    weapon: 'rifle',
    material: 'glass',
    stock: { glass: 32, wood: 32, iron: 24 },
    chips: 1,
    hold: null,
  });
  const [bootError, setBootError] = useState('');

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
      const { mats, list } = createMaterials(THREE);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x12151c);
      const camera = new THREE.PerspectiveCamera(90, window.innerWidth / Math.max(window.innerHeight, 1), 0.08, 200);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9);
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
        },
        inventory: config.pickedLoadout.slice(),
        slotIndex: 0,
        credits: 800,
        mode: 'rifle',
        portalMaterial: 'glass',
        stock: { glass: 32, wood: 32, iron: 24 },
        hackingChips: 1,
        paint: null,
        charges: [],
        phase: 'buy',
        phaseEndsAt: performance.now() + PHASE_MS.buy,
        sentPhase: '',
        sentTime: -1,
        nextReskinAt: 0,
        lastShot: 0,
        faction: config.faction,
        playerName: config.playerName,
        bannedMaterial: config.bannedMaterial,
        input: { keys: {}, firing: false, lookX: 0, lookY: 0, releaseAt: {}, ignoreReleaseUntil: 0 },
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
          },
          chips: game.hackingChips,
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
      createViewmodel(game);

      const listen = (target, type, fn, options) => {
        target.addEventListener(type, fn, options);
        game.offs.push(() => target.removeEventListener(type, fn, options));
      };

      const setWeapon = (mode) => {
        if (mode === 'hack' && game.hackingChips <= 0) return;
        game.input.firing = false;
        cancelPaint(game);
        if (game.mode !== mode) {
          game.mode = mode;
          showWeapon(game, mode);
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

      listen(window, 'keydown', (event) => {
        game.input.keys[event.code] = true;
        game.input.releaseAt[event.code] = 0;
        if (event.code === 'Space') event.preventDefault();
        if (event.repeat) return;
        if (event.code === 'Digit1') setWeapon('rifle');
        if (event.code === 'Digit2') setWeapon('portal');
        if (event.code === 'Digit3') setWeapon('melee');
        if (event.code === 'Digit4') setWeapon('utility');
        if (event.code === 'Digit5') setWeapon('hack');
        if (event.code === 'Digit6') setPortalMaterial('glass');
        if (event.code === 'Digit7') setPortalMaterial('wood');
        if (event.code === 'Digit8') setPortalMaterial('iron');
      });
      listen(window, 'keyup', (event) => {
        if (performance.now() < game.input.ignoreReleaseUntil) return;
        game.input.releaseAt[event.code] = performance.now() + 90;
      });
      listen(window, 'blur', () => {
        if (document.pointerLockElement === canvas) return;
        game.input.firing = false;
      });
      listen(window, 'wheel', (event) => {
        if (!game.inventory.length) return;
        game.slotIndex += event.deltaY > 0 ? 1 : -1;
        emitInventory(game);
      }, { passive: true });
      listen(window, 'mousedown', (event) => {
        game.input.ignoreReleaseUntil = performance.now() + 180;
        if (event.button === 0 && document.pointerLockElement !== canvas) {
          const lock = canvas.requestPointerLock();
          if (lock && lock.catch) lock.catch(() => {});
          return;
        }
        if (game.phase !== 'action' || game.player.hp <= 0) return;
        if (game.mode === 'rifle' && event.button === 0) game.input.firing = true;
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
      });
      listen(window, 'contextmenu', (event) => event.preventDefault());
      listen(document, 'mousemove', (event) => {
        if (document.pointerLockElement !== canvas) return;
        game.player.yaw -= event.movementX * 0.0022;
        game.player.pitch -= event.movementY * 0.0022;
        game.input.lookX = event.movementX;
        game.input.lookY = event.movementY;
        if (game.player.pitch > PITCH_LIMIT) game.player.pitch = PITCH_LIMIT;
        if (game.player.pitch < -PITCH_LIMIT) game.player.pitch = -PITCH_LIMIT;
      });
      listen(document, 'pointerlockchange', () => {
        game.input.ignoreReleaseUntil = performance.now() + 180;
        if (document.pointerLockElement !== canvas) {
          game.input.firing = false;
          cancelPaint(game);
        }
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

      buildArena(game);

      const finishRound = (cause) => {
        if (game.dead || game.phase === 'result') return;
        const outcome = roundOutcome(game, cause);
        game.phase = 'result';
        game.phaseEndsAt = performance.now() + PHASE_MS.result;
        game.input.firing = false;
        game.sentPhase = 'result';
        game.sentTime = 5;
        game.emit('game:phase', { phase: 'result', timeLeft: 5 });
        game.emit('game:killfeed', { text: outcome.killText });
        game.sfx.round(outcome.playerWon);
        game.onPhase('result', outcome);
      };

      const startAction = () => {
        if (game.dead) return;
        game.phase = 'action';
        game.phaseEndsAt = performance.now() + PHASE_MS.action;
        game.nextReskinAt = performance.now() + 10000;
        game.lastShot = 0;
        game.input.firing = false;
        game.sentPhase = 'action';
        game.sentTime = 120;
        game.emit('game:phase', { phase: 'action', timeLeft: 120 });
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
        if (game.charges) {
          for (const charge of game.charges) game.scene.remove(charge.mesh);
          game.charges = [];
        }
        rebuildMasks(game);
        game.phase = 'buy';
        game.phaseEndsAt = performance.now() + PHASE_MS.buy;
        game.input.firing = false;
        game.sentPhase = 'buy';
        game.sentTime = 15;
        game.emit('game:health', { hp: game.player.hp });
        game.emit('game:credits', { credits: game.credits });
        emitInventory(game);
        game.emit('game:mode', { mode: game.mode });
        game.emit('game:phase', { phase: 'buy', timeLeft: 15 });
        game.onHud?.();
        game.onPhase('buy', null);
      };

      startBuy();
      applyLook(game);
      applyCameraPosition(game);

      const loop = () => {
        if (game.dead) return;
        const now = performance.now();
        const dt = Math.min(game.clock.getDelta(), 0.05);
        applyLook(game);
        updatePlayer(game, dt, game.phase === 'action' && game.player.hp > 0);
        applyCameraPosition(game);

        if (game.phase === 'action') {
          updateCombat(game, dt, now);
          if (game.phase === 'action') {
            const timeLeft = (game.phaseEndsAt - now) / 1000;
            if (game.player.hp <= 0) finishRound('death');
            else if (game.uplinkEndsAt && now >= game.uplinkEndsAt) finishRound('uplink');
            else if (timeLeft <= 0) finishRound('timeout');
            else if (game.uplinkEndsAt) {
              const hold = Math.max(0, Math.ceil((game.uplinkEndsAt - now) / 1000));
              if (hold !== game.holdSent) {
                game.holdSent = hold;
                game.onHold?.(hold);
              }
            }
          }
        } else if ((game.phaseEndsAt - now) / 1000 <= 0) {
          if (game.phase === 'buy') startAction(game);
          else if (game.phase === 'result') startBuy(game);
        }

        updateHighlight(game);
        updatePaint(game);
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
          hold={loadout.hold}
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
      {phase === 'buy' ? <BuyPhase gameRef={gameRef} /> : null}
      {phase === 'action' ? <ActionPhase /> : null}
      {phase === 'result' && result ? (
        <PostRoundAnalysis playerWon={result.playerWon} reason={result.reason} />
      ) : null}
    </div>
  );
}
