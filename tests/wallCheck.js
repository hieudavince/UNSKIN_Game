import * as THREE from 'three';
import { buildArena, meshBox } from '../src/components/Match/PrepPhase';
import {
  applyRemoteShatter,
  applyRemoteStroke,
  applyStroke,
  rebuildMasks,
  surfaceAt,
} from '../src/components/Match/ActionPhase';

globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => new Proxy({}, { get: () => () => {} }),
  }),
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
    stock: { glass: 99, wood: 99, iron: 99, rubber: 99 },
    sfx: new Proxy({}, { get: () => () => {} }),
    emit() {},
  };
  buildArena(game);
  rebuildMasks(game);
  return game;
}

function square(u0, v0, u1, v1, step = 0.05) {
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const points = [];
  for (let i = 0; i < 4; i += 1) {
    const [au, av] = corners[i];
    const [bu, bv] = corners[(i + 1) % 4];
    const n = Math.ceil(Math.hypot(bu - au, bv - av) / step);
    for (let s = 0; s < n; s += 1) points.push({ u: au + ((bu - au) * s) / n, v: av + ((bv - av) * s) / n });
  }
  return points;
}

// Painting tests run on a real wall of the Foundry Labs map: a paintable wall
// running along x (thin in z), standing on the ground floor, at least 6 m wide.
let HOST = null;
function stroke(points, hostMaterial = HOST.material) {
  return { axis: 'z', anchor: HOST.z, plane: HOST.z + HOST.d / 2 + 0.002, sign: 1, materialName: hostMaterial, points };
}
// u is relative to the host centre so the same shapes work on any wall
const U = (du) => HOST.x + du;

function boxHits(game, box) {
  return game.moveMask.some((mesh) => {
    if (mesh.userData.solid === false) return false;
    const b = meshBox(mesh);
    return box.minX < b.maxX && box.maxX > b.minX && box.minY < b.maxY && box.maxY > b.minY && box.minZ < b.maxZ && box.maxZ > b.minZ;
  });
}

function pointHits(game, x, y, z) {
  return boxHits(game, { minX: x - 0.01, maxX: x + 0.01, minY: y - 0.01, maxY: y + 0.01, minZ: z - 0.01, maxZ: z + 0.01 });
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
}

const area = (region) => {
  let sum = 0;
  const pts = region.points;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.u * b.v - b.u * a.v;
  }
  return Math.abs(sum / 2);
};

const game = makeGame();
const candidates = game.surfaces.filter((mesh) => {
  const d = mesh.userData;
  if (!d.paintable || d.kind !== 'wall' || d.axis !== 'z') return false;
  const b = meshBox(mesh);
  return Math.abs(b.minY) < 0.01 && d.w >= 6 && d.h >= 3.2 && (d.materialName === 'wood' || d.materialName === 'iron');
});
candidates.sort((a, b) => (a.userData.materialName === 'wood' ? 0 : 1) - (b.userData.materialName === 'wood' ? 0 : 1)
  || a.userData.id.localeCompare(b.userData.id));
const host = candidates[0];
check('found a paintable ground-floor wall to paint on', !!host, host ? host.userData.id : 'none');
if (!host) {
  console.log('FAIL  no host wall');
  process.exit(1);
}
HOST = { x: host.position.x, z: host.position.z, d: host.userData.d, material: host.userData.materialName };
const freeBefore = (g) => !pointHits(g, U(0.02), 0.8, HOST.z + 2.5);
const clearSpot = freeBefore(game);

const hole = square(U(-1.2), 0.1, U(1.2), 2.9);
const painted = applyStroke(game, stroke(hole), 'glass', { seed: 'A' });
check('glass stroke applied to the wall', painted);
const glassStamps = game.surfaces.filter((mesh) => mesh.userData.stamp && mesh.userData.materialName === 'glass' && !mesh.userData.destroyed);
const glassArea = glassStamps.reduce((sum, stamp) => sum + area(stamp.userData.region), 0);
check('stamp area matches the drawn rectangle', Math.abs(glassArea - 2.4 * 2.8) < 0.05, `area=${glassArea.toFixed(3)}`);
check('glass panel still blocks before it breaks', pointHits(game, U(0), 1.5, HOST.z));
check('surface reports glass where it was painted', surfaceAt(host, { u: U(0), v: 0.8 }).material === 'glass');

applyRemoteShatter(game, glassStamps.map((stamp) => stamp.userData.id));
const playerBox = { minX: U(0) - 0.34, maxX: U(0) + 0.34, minY: 0.15, maxY: 1.85, minZ: HOST.z - 0.34, maxZ: HOST.z + 0.34 };
check('player box fits through the broken glass hole', !boxHits(game, playerBox));
check('bomb-sized box passes through the hole', !pointHits(game, U(0), 1.5, HOST.z));
check('wall outside the hole still blocks', pointHits(game, U(-1.4), 1.5, HOST.z) && pointHits(game, U(1.4), 1.0, HOST.z));

const game2 = makeGame();
applyStroke(game2, stroke(square(U(-1.6), 0.2, U(0.2), 1.4)), 'glass', { seed: 'B' });
applyStroke(game2, stroke(square(U(-0.6), 0.2, U(1.0), 1.4)), 'iron', { seed: 'C' });
const live = game2.surfaces.filter((mesh) => mesh.userData.stamp && !mesh.userData.destroyed && !mesh.userData.retired);
const glassLeft = live.filter((mesh) => mesh.userData.materialName === 'glass').reduce((s, m) => s + area(m.userData.region), 0);
const ironArea = live.filter((mesh) => mesh.userData.materialName === 'iron').reduce((s, m) => s + area(m.userData.region), 0);
check('iron over glass trims the glass instead of stacking', Math.abs(glassLeft - 1.0 * 1.2) < 0.06, `glass=${glassLeft.toFixed(3)}`);
check('iron keeps its full drawn shape', Math.abs(ironArea - 1.6 * 1.2) < 0.02, `iron=${ironArea.toFixed(3)}`);
const host2 = game2.meshById.get(host.userData.id);
check('overlap reads as iron, glass-only part reads as glass',
  surfaceAt(host2, { u: U(0), v: 0.8 }).material === 'iron' && surfaceAt(host2, { u: U(-1.0), v: 0.8 }).material === 'glass');

const game3 = makeGame();
applyStroke(game3, stroke(square(U(-1.6), 0.2, U(0.2), 1.4)), 'rubber', { seed: 'D' });
const rubberCells = game3.passages.filter((cell) => cell.userData.bounce);
check('rubber patch makes bouncy collision cells', rubberCells.length > 0);
check('no stray collision box appears in front of the wall', freeBefore(game3) === clearSpot);

const source = makeGame();
const mirror = makeGame();
const strokes = [
  { seed: 'E', material: 'glass', pts: square(U(-1.2), 0.1, U(1.1), 1.5) },
  { seed: 'F', material: 'iron', pts: square(U(0.1), 0.4, U(1.2), 2.6) },
];
for (const item of strokes) {
  applyStroke(source, stroke(item.pts), item.material, { seed: item.seed });
  applyRemoteStroke(mirror, {
    seed: item.seed,
    material: item.material,
    axis: 'z',
    anchor: HOST.z,
    sign: 1,
    hostMaterial: HOST.material,
    points: item.pts.map((p) => [p.u, p.v]),
  });
}
const sig = (g) => g.surfaces
  .filter((mesh) => mesh.userData.stamp && !mesh.userData.destroyed && !mesh.userData.retired)
  .map((mesh) => `${mesh.userData.id}:${mesh.userData.materialName}:${area(mesh.userData.region).toFixed(3)}`)
  .sort()
  .join('|');
check('remote replay produces identical walls', sig(source) === sig(mirror), sig(mirror));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(failed.length ? `\n${failed.length} failed` : '\nall passed');
process.exit(failed.length ? 1 : 0);
