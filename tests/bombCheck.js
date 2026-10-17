// Bomb physics on the real Foundry Labs geometry (node, real three.js):
// flight unchanged, instant stick + box collider, detach when the surface
// disappears, fall with player gravity and land (never float), never blocks
// players, 2.5 s fuse.
import * as THREE from 'three';
import { buildArena, meshBox } from '../src/components/Match/PrepPhase';
import {
  BOMB_FUSE,
  applyRemoteShatter,
  rebuildMasks,
  spawnRemoteCharge,
  updateBombs,
} from '../src/components/Match/ActionPhase';

globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {} }) }),
};

function makeGame() {
  const mats = {};
  for (const name of ['titanium', 'glass', 'rubber', 'wood', 'iron', 'deck', 'console', 'hacked', 'extractor', 'charge', 'chargeDim']) {
    mats[name] = new THREE.MeshBasicMaterial();
  }
  const game = {
    THREE,
    scene: new THREE.Scene(),
    mats,
    geometries: [],
    materialDisposables: [],
    floors: [],
    blocks: [],
    surfaces: [],
    props: [],
    phase: 'buy',
    faction: 'atlas',
    player: { x: 0, feetY: -50, z: 0, vx: 0, vy: 0, vz: 0, hp: 100 },
    sfx: new Proxy({}, { get: () => () => {} }),
    emit() {},
  };
  buildArena(game, 'foundry');
  rebuildMasks(game);
  return game;
}

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
const step = (game, seconds, each) => {
  const dt = 1 / 60;
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i += 1) {
    updateBombs(game, dt);
    if (each) each();
  }
};
const throwAt = (game, spec) => {
  spawnRemoteCharge(game, { id: `t${Math.random()}`, ...spec }, 'outliers', 'Tester', 0);
  return game.charges[game.charges.length - 1];
};
const insideSolid = (game, c) => game.moveMask.some((mesh) => {
  if (mesh.userData.solid === false) return false;
  const b = meshBox(mesh);
  return c.x > b.minX + 0.01 && c.x < b.maxX - 0.01 && c.y > b.minY + 0.01 && c.y < b.maxY - 0.01 && c.z > b.minZ + 0.01 && c.z < b.maxZ - 0.01;
});

// 1. Flight keeps the original ballistic curve (gravity 14) before contact.
{
  const game = makeGame();
  const c = throwAt(game, { x: 0, y: 2, z: 30, vx: 0, vy: 4, vz: -6 });
  step(game, 0.25);
  // semi-implicit Euler with 1/60 steps, same as the original code
  let y = 2;
  let vy = 4;
  for (let i = 0; i < 15; i += 1) { vy -= 14 / 60; y += vy / 60; }
  check('flight follows the original trajectory (gravity 14)', c.state === 'flying' && Math.abs(c.y - y) < 0.03 && Math.abs(c.z - (30 - 6 * 0.25)) < 0.05,
    `y=${c.y.toFixed(3)} expected ${y.toFixed(3)}`);
}

// 2. Thrown at the floor: sticks immediately, flat box resting on the floor.
{
  const game = makeGame();
  const c = throwAt(game, { x: 0, y: 1.2, z: 30, vx: 0, vy: -3, vz: 0 });
  step(game, 0.6);
  check('sticks to the floor on first contact', c.state === 'stuck' && c.normal?.y === 1, `state=${c.state}`);
  check('stuck box rests on the floor surface', Math.abs(c.y - 0.05) < 0.03, `y=${c.y.toFixed(3)}`);
  const y0 = c.y;
  step(game, 0.5);
  check('stuck bomb stays put while the floor exists', c.state === 'stuck' && Math.abs(c.y - y0) < 1e-6);
}

// 3. Thrown at a wall: sticks to the wall face, never inside it.
const glassDoor = (game) => game.surfaces.find((m) => m.userData.materialName === 'glass' && m.userData.kind === 'door'
  && Math.abs(m.position.x) < 0.01 && Math.abs(m.position.z + 40) < 0.01);
{
  const game = makeGame();
  const door = glassDoor(game);
  check('found the glass security door', !!door);
  const c = throwAt(game, { x: 0, y: 1.3, z: -37, vx: 0, vy: 1, vz: -9 });
  step(game, 0.6);
  check('sticks to the glass door face', c.state === 'stuck' && c.normal?.z === 1, `state=${c.state} n=${JSON.stringify(c.normal)}`);
  check('stuck bomb is outside the wall', !insideSolid(game, c) && c.z > -40 + 0.06 - 0.001, `z=${c.z.toFixed(3)}`);
  check('bombs are never in the player collision list', !game.moveMask.includes(c.mesh));

  // 4. The door shatters: the bomb detaches, falls with player gravity and lands.
  applyRemoteShatter(game, [door.userData.id]);
  rebuildMasks(game);
  const startY = c.y;
  let top = c.y;
  step(game, 0.05);
  check('detaches when its surface disappears', c.state === 'loose', `state=${c.state}`);
  const afterDetach = c.y;
  step(game, 1.0, () => { top = Math.max(top, c.y); });
  check('falls after detaching (no floating)', afterDetach < startY && top <= startY + 0.001,
    `start=${startY.toFixed(2)} top=${top.toFixed(2)}`);
  check('lands on the floor below', c.y > 0.05 && c.y < 0.16 && c.state === 'loose', `y=${c.y.toFixed(3)}`);
}

// 5. Fuse: blows up 2.5 s after the throw (no countdown sprite any more).
{
  const game = makeGame();
  const c = throwAt(game, { x: 0, y: 1.2, z: 30, vx: 0, vy: 0, vz: 0 });
  check('no 5-4-3-2-1 countdown sprite on the bomb', c.mesh.children.length === 0);
  step(game, BOMB_FUSE - 0.1);
  const alive = game.charges.length === 1;
  step(game, 0.2);
  check('fuse is 2.5 s', BOMB_FUSE === 2.5 && alive && game.charges.length === 0);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(failed.length ? `\n${failed.length} failed` : '\nall passed');
process.exit(failed.length ? 1 : 0);
