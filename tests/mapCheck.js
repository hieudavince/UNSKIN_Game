// Geometry check for every map: no overlapping boxes, spawns clear of objects
// and standing on a floor, stairs walkable with headroom, and a grid walker
// (same step-up / blocking rules as the player physics) that proves the
// objective and every spawn can actually be reached.
// Run: npm run test:maps   (bundles with esbuild into tests/.out first)
import { writeFileSync, mkdirSync } from 'node:fs';
import { labMap } from '../src/components/Match/maps/labMap';
import { complexMap } from '../src/components/Match/maps/complexMap';
import { boxesOverlap } from '../src/components/Match/maps/mapKit';

const PLAYER_R = 0.34;
const PLAYER_H = 1.7;
const STEP_UP = 0.28;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

function makeHash(boxes, cell = 2) {
  const map = new Map();
  const k = (i, j) => `${i},${j}`;
  boxes.forEach((b, index) => {
    for (let i = Math.floor(b.minX / cell); i <= Math.floor(b.maxX / cell); i += 1) {
      for (let j = Math.floor(b.minZ / cell); j <= Math.floor(b.maxZ / cell); j += 1) {
        if (!map.has(k(i, j))) map.set(k(i, j), []);
        map.get(k(i, j)).push(index);
      }
    }
  });
  return {
    query(minX, maxX, minZ, maxZ) {
      const out = new Set();
      for (let i = Math.floor(minX / cell); i <= Math.floor(maxX / cell); i += 1) {
        for (let j = Math.floor(minZ / cell); j <= Math.floor(maxZ / cell); j += 1) {
          for (const index of map.get(k(i, j)) || []) out.add(index);
        }
      }
      return [...out].map((index) => boxes[index]);
    },
  };
}

function analyse(spec) {
  const tag = spec.id;
  const all = [...spec.boxes, ...(spec.decor || []).map((d, i) => ({ ...d, name: `decor-${d.type}-${i}`, list: 'decor' }))];
  const hash = makeHash(all);

  // 1. overlaps
  const overlaps = [];
  for (const a of all) {
    for (const b of hash.query(a.minX, a.maxX, a.minZ, a.maxZ)) {
      if (a === b || a.name > b.name) continue;
      if (boxesOverlap(a, b, 0.002)) overlaps.push(`${a.name} × ${b.name}`);
    }
  }
  check(`[${tag}] no overlapping objects (${all.length} boxes)`, overlaps.length === 0, overlaps.slice(0, 12).join(', '));

  const solids = spec.boxes;
  const floors = solids.filter((b) => b.kind === 'floor');
  const blockers = solids.filter((b) => b.kind !== 'floor');
  const floorHash = makeHash(floors);
  const blockHash = makeHash([...blockers, ...all.filter((b) => b.list === 'decor')]);

  const wallCache = new Map();
  const wallsFree = (x, z, feet, r = PLAYER_R, h = PLAYER_H) => {
    const id = `${x},${z},${feet},${r}`;
    if (wallCache.has(id)) return wallCache.get(id);
    const ok = wallsFreeRaw(x, z, feet, r, h);
    wallCache.set(id, ok);
    return ok;
  };
  const wallsFreeRaw = (x, z, feet, r, h) => {
    for (const b of blockHash.query(x - r, x + r, z - r, z + r)) {
      if (b.maxY <= feet + 0.4 || b.minY >= feet + h) continue;
      if (x - r >= b.maxX || x + r <= b.minX || z - r >= b.maxZ || z + r <= b.minZ) continue;
      return false;
    }
    return true;
  };
  const headroom = (x, z, feet, r = 0.22, h = PLAYER_H) => {
    for (const b of floorHash.query(x - r, x + r, z - r, z + r)) {
      if (x - r >= b.maxX || x + r <= b.minX || z - r >= b.maxZ || z + r <= b.minZ) continue;
      if (b.minY > feet + 0.02 && b.minY < feet + h + 0.02) return false;
    }
    return true;
  };
  const topCache = new Map();
  const topsAt = (x, z) => {
    const id = `${x},${z}`;
    if (!topCache.has(id)) topCache.set(id, topsAtRaw(x, z));
    return topCache.get(id);
  };
  const topsAtRaw = (x, z) => {
    const r = 0.2;
    const tops = new Set();
    for (const b of floorHash.query(x - r, x + r, z - r, z + r)) {
      if (x + r <= b.minX || x - r >= b.maxX || z + r <= b.minZ || z - r >= b.maxZ) continue;
      tops.add(Math.round(b.maxY * 1000) / 1000);
    }
    return [...tops].sort((p, q) => p - q);
  };
  const support = (x, z, feet) => {
    const tops = topsAt(x, z).filter((t) => t <= feet + STEP_UP + 1e-6);
    return tops.length ? tops[tops.length - 1] : null;
  };

  // 2. spawns
  const spawnList = [];
  const spread = spec.teamSpread || 0;
  for (const [side, s] of Object.entries(spec.spawns)) {
    const offsets = spread ? [0, -0.8, 0.8, -1.6, 1.6, -2.4, 2.4, -3.2, 3.2] : [0];
    for (const off of offsets) spawnList.push({ label: `${side}${off ? `+${off}` : ''}`, x: s.x + off * (spread / 1.6), y: s.y || 0, z: s.z });
  }
  (spec.ffaSpawns || []).forEach((s, i) => spawnList.push({ label: `ffa${i}`, x: s.x, y: s.y, z: s.z }));
  const badSpawns = [];
  for (const s of spawnList) {
    const clearR = 0.6;
    const box = { minX: s.x - clearR, maxX: s.x + clearR, minY: s.y + 0.01, maxY: s.y + 2.0, minZ: s.z - clearR, maxZ: s.z + clearR };
    const hit = all.find((b) => boxesOverlap(box, b, 0));
    const top = support(s.x, s.z, s.y);
    if (hit) badSpawns.push(`${s.label} hits ${hit.name}`);
    else if (top === null || Math.abs(top - s.y) > 0.01) badSpawns.push(`${s.label} not on a floor (top=${top})`);
    else if (!headroom(s.x, s.z, s.y)) badSpawns.push(`${s.label} no headroom`);
  }
  check(`[${tag}] ${spawnList.length} spawn points clear of objects and on a floor`, badSpawns.length === 0, badSpawns.join('; '));

  // 3. stairs
  const groups = new Map();
  for (const b of floors) {
    if (!b.stair) continue;
    if (!groups.has(b.stair)) groups.set(b.stair, []);
    groups.get(b.stair).push(b);
  }
  const stairErrors = [];
  for (const [name, steps] of groups) {
    steps.sort((p, q) => p.maxY - q.maxY);
    const base = steps[0].minY;
    let prev = base;
    for (const step of steps) {
      if (step.maxY - prev > STEP_UP + 1e-6) stairErrors.push(`${name} rise ${(step.maxY - prev).toFixed(2)}`);
      prev = step.maxY;
      const cx = (step.minX + step.maxX) / 2;
      const cz = (step.minZ + step.maxZ) / 2;
      if (!headroom(cx, cz, step.maxY)) stairErrors.push(`${name} headroom at ${step.name}`);
      if (!wallsFree(cx, cz, step.maxY, 0.3)) stairErrors.push(`${name} blocked at ${step.name}`);
    }
    if (!spec.levels.some((l) => Math.abs(l - prev) < 0.01)) stairErrors.push(`${name} ends at ${prev}`);
  }
  check(`[${tag}] ${groups.size} staircases walkable (rise ≤ ${STEP_UP}, headroom, no blockers)`, groups.size > 0 && stairErrors.length === 0, stairErrors.slice(0, 8).join('; '));

  // 4. walker
  const g = 0.25;
  const bx = spec.bounds;
  const cols = Math.round((bx.maxX - bx.minX) / g);
  const rows = Math.round((bx.maxZ - bx.minZ) / g);
  const nodeKey = (i, j, t) => `${i},${j},${t}`;
  const cx = (i) => bx.minX + (i + 0.5) * g;
  const cz = (j) => bx.minZ + (j + 0.5) * g;
  const valid = new Map();
  const isValid = (i, j, t) => {
    const id = nodeKey(i, j, t);
    if (!valid.has(id)) valid.set(id, wallsFree(cx(i), cz(j), t) && headroom(cx(i), cz(j), t));
    return valid.get(id);
  };
  const walk = (startX, startZ, startY) => {
    const si = Math.floor((startX - bx.minX) / g);
    const sj = Math.floor((startZ - bx.minZ) / g);
    const st = support(cx(si), cz(sj), startY + 0.01);
    const seen = new Set();
    if (st === null || !isValid(si, sj, st)) return seen;
    const queue = [[si, sj, st]];
    seen.add(nodeKey(si, sj, st));
    while (queue.length) {
      const [i, j, t] = queue.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= cols || b >= rows) continue;
        if (!wallsFree(cx(a), cz(b), t)) continue;
        const s = support(cx(a), cz(b), t);
        if (s === null || !isValid(a, b, s)) continue;
        const id = nodeKey(a, b, s);
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push([a, b, s]);
      }
    }
    return seen;
  };
  const walkBack = (startX, startZ, startY) => {
    const si = Math.floor((startX - bx.minX) / g);
    const sj = Math.floor((startZ - bx.minZ) / g);
    const st = support(cx(si), cz(sj), startY + 0.01);
    const seen = new Set();
    if (st === null) return seen;
    const queue = [[si, sj, st]];
    seen.add(nodeKey(si, sj, st));
    while (queue.length) {
      const [a, b, s] = queue.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = a + di;
        const j = b + dj;
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
        for (const t of topsAt(cx(i), cz(j))) {
          const id = nodeKey(i, j, t);
          if (seen.has(id) || !isValid(i, j, t)) continue;
          if (!wallsFree(cx(a), cz(b), t) || support(cx(a), cz(b), t) !== s) continue;
          seen.add(id);
          queue.push([i, j, t]);
        }
      }
    }
    return seen;
  };
  const reaches = (seen, x, z, y, r = 1.4) => {
    for (const id of seen) {
      const [i, j, t] = id.split(',').map(Number);
      if (Math.abs(t - y) > 0.3) continue;
      if (Math.abs(cx(i) - x) <= r && Math.abs(cz(j) - z) <= r) return true;
    }
    return false;
  };

  const report = { walk: {} };
  const ffa = spec.ffaSpawns || [];
  if (spec.id === 'foundry') {
    const a = spec.spawns.atlas;
    const o = spec.spawns.outliers;
    const fromA = walk(a.x, a.z, a.y || 0);
    const fromO = walk(o.x, o.z, o.y || 0);
    const uplink = spec.boxes.find((b) => b.uplink);
    const ux = (uplink.minX + uplink.maxX) / 2;
    const uz = uplink.maxZ + 0.6;
    check(`[${tag}] Atlas spawn can reach the uplink`, reaches(fromA, ux, uz, 0, 0.6));
    check(`[${tag}] Outliers spawn can reach the uplink`, reaches(fromO, ux, uz, 0, 0.6));
    check(`[${tag}] Atlas can reach the Outliers spawn and the upper floor`, reaches(fromA, o.x, o.z, 0) && [...fromA].some((id) => id.endsWith(',4')));
    // multiple routes: block the atrium vault door and the west wing, still reachable?
    report.walk.atlasNodes = fromA.size;
    const routeTest = (label, block) => {
      const saved = blockers.length;
      blockers.push(block);
      const h = makeHash([...blockers, ...all.filter((b) => b.list === 'decor')]);
      const old = blockHash.query;
      blockHash.query = h.query;
      valid.clear();
      wallCache.clear();
      const seen = walk(a.x, a.z, 0);
      blockHash.query = old;
      blockers.length = saved;
      valid.clear();
      wallCache.clear();
      return reaches(seen, ux, uz, 0, 0.6);
    };
    const routes = [
      ['vault front door sealed', { name: 'block', minX: -2, maxX: 2, minY: 0, maxY: 8, minZ: -26.5, maxZ: -25.5 }],
      ['whole west half sealed', { name: 'block', minX: -36, maxX: -8.2, minY: 0, maxY: 8, minZ: -26, maxZ: 36 }],
      ['whole east half sealed', { name: 'block', minX: 8.2, maxX: 36, minY: 0, maxY: 8, minZ: -26, maxZ: 36 }],
      ['ground floor corridors sealed (upper route)', { name: 'block', minX: -36, maxX: 36, minY: 0, maxY: 3.5, minZ: 10, maxZ: 11 }],
    ];
    for (const [label, block] of routes) check(`[${tag}] alternative route to the uplink when ${label}`, routeTest(label, block));
  }
  if (ffa.length) {
    const from0 = walk(ffa[0].x, ffa[0].z, ffa[0].y);
    const missing = ffa.filter((s) => !reaches(from0, s.x, s.z, s.y, 0.3)).map((s, i) => `${s.x},${s.y},${s.z}`);
    check(`[${tag}] every FFA spawn reachable from spawn 0`, missing.length === 0, missing.join(' '));
    const to0 = walkBack(ffa[0].x, ffa[0].z, ffa[0].y);
    const back = ffa.slice(1).filter((s) => !reaches(to0, s.x, s.z, s.y, 0.3));
    check(`[${tag}] spawn 0 reachable from every FFA spawn`, back.length === 0, back.map((s) => `${s.x},${s.y},${s.z}`).join(' '));
    report.walk.ffaNodes = from0.size;
    if (spec.id === 'complex') {
      const levels = new Set([...from0].map((id) => id.split(',')[2]));
      check(`[${tag}] all ${spec.levels.length} floors are reachable`, spec.levels.every((l) => levels.has(String(l))));
    }
  }
  return { spec, all, report };
}

function plan(spec, all, file) {
  const s = 7;
  const b = spec.bounds;
  const W = (b.maxX - b.minX) * s;
  const H = (b.maxZ - b.minZ) * s;
  const parts = [];
  spec.levels.forEach((level, li) => {
    const ox = li * (W + 20);
    parts.push(`<g transform="translate(${ox},0)"><rect width="${W}" height="${H}" fill="#10141b"/>`);
    parts.push(`<text x="6" y="16" fill="#9bfff0" font-size="14">level ${li} (y=${level})</text>`);
    const rect = (x, cls) => `<rect x="${(x.minX - b.minX) * s}" y="${(x.minZ - b.minZ) * s}" width="${(x.maxX - x.minX) * s}" height="${(x.maxZ - x.minZ) * s}" ${cls}/>`;
    for (const x of all) {
      if (x.kind === 'floor' && Math.abs(x.maxY - level) < 0.01 && !x.stair && x.name !== 'ground') parts.push(rect(x, 'fill="#2d3b4f"'));
    }
    for (const x of all) {
      if (x.stair && x.minY <= level + 0.01 && x.maxY >= level - 0.01 && x.maxY <= level + 4.01) {
        const t = (x.maxY - level) / 4;
        parts.push(rect(x, `fill="rgb(${80 + t * 150},${120 + t * 100},90)"`));
      }
    }
    for (const x of all) {
      if (x.kind === 'floor' || x.list === 'cut') continue;
      if (!(x.minY < level + 1.6 && x.maxY > level + 0.5)) continue;
      const color = x.list === 'props' ? (x.uplink ? '#39e07a' : '#c9874a')
        : x.material === 'glass' ? '#9bfff0' : x.material === 'wood' ? '#a8703f' : x.material === 'rubber' ? '#e07020'
          : x.style === 'trim' ? '#ffd27a' : '#c8d0da';
      parts.push(rect(x, `fill="${color}"`));
    }
    const sp = [...Object.entries(spec.spawns).map(([k, v]) => ({ ...v, c: k === 'atlas' ? '#4f97ff' : '#ff6a57' })),
      ...(spec.ffaSpawns || []).map((v) => ({ ...v, c: '#ff3bd4' }))];
    for (const p of sp) {
      if (Math.abs((p.y || 0) - level) > 0.01) continue;
      parts.push(`<circle cx="${(p.x - b.minX) * s}" cy="${(p.z - b.minZ) * s}" r="5" fill="${p.c}" stroke="#000"/>`);
    }
    parts.push('</g>');
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.levels.length * (W + 20)}" height="${H}">${parts.join('')}</svg>`;
  writeFileSync(file, svg);
}

mkdirSync('tests/.out', { recursive: true });
const t0 = Date.now();
for (const build of [labMap, complexMap]) {
  const spec = build();
  const { all, report } = analyse(spec);
  const area = (spec.bounds.maxX - spec.bounds.minX) * (spec.bounds.maxZ - spec.bounds.minZ);
  console.log(`map ${spec.id}: ${spec.boxes.length} boxes, footprint ${area} m², ${spec.levels.length} floors, walker ${JSON.stringify(report.walk)}`);
  plan(spec, all, `tests/.out/plan-${spec.id}.svg`);
}
const lab = labMap();
const labArea = (lab.bounds.maxX - lab.bounds.minX) * (lab.bounds.maxZ - lab.bounds.minZ);
check('[foundry] map is larger than the old 56×80 foundry', labArea > 56.4 * 80.4, `${labArea} m²`);
const cx = complexMap();
const cxArea = (cx.bounds.maxX - cx.bounds.minX) * (cx.bounds.maxZ - cx.bounds.minZ) * cx.levels.length;
check('[complex] FFA map has more floor area than foundry', cxArea > labArea * lab.levels.length, `${cxArea} m²`);
const again = complexMap();
check('[complex] generator is deterministic (same ids every build)', again.boxes.map((b) => b.name).join() === cx.boxes.map((b) => b.name).join());

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(failed.length ? `\n${failed.length} failed` : `\nall passed (${Date.now() - t0} ms)`);
process.exit(failed.length ? 1 : 0);
