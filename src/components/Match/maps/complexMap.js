// "Helix Complex" — the free-for-all map. A three-storey research facility on a
// 6×6 grid of 16 m rooms per floor. Room-to-room connections come from a seeded
// spanning tree plus extra loops, so every room is reachable and there are many
// alternative routes. Ten staircases link the floors, a few rooms are open
// atriums (balconies with railings look down into them), and every client
// builds the exact same layout from the fixed seed.
import { createKit, makeRng, rectHits } from './mapKit';

export const COMPLEX_ID = 'complex';
const N = 6;
const CELL = 16;
const HALF = (N * CELL) / 2;
const SEED = 0x5eed2610;

export function complexMap() {
  const levels = [0, 4, 8];
  const kit = createKit({ name: 'Helix Complex', width: N * CELL, depth: N * CELL, levels, ceiling: 12 });
  const rnd = makeRng(SEED);
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const shuffle = (list) => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const snap = (v, s = 0.5) => Math.round(v / s) * s;
  kit.shell();

  const cellMin = (i) => -HALF + i * CELL;
  const center = (i) => cellMin(i) + CELL / 2;
  const key = (i, j) => `${i},${j}`;
  const cells = [];
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) cells.push([i, j]);

  // ── stairs and atriums ───────────────────────────────────────────────────
  const stairCells = [new Map(), new Map()]; // index = from level
  const used = new Set();
  const farEnough = (cell, list) => list.every(([i, j]) => Math.abs(i - cell[0]) + Math.abs(j - cell[1]) >= 2);
  for (let from = 0; from < 2; from += 1) {
    const chosen = [];
    for (const cell of shuffle(cells)) {
      if (chosen.length >= 5) break;
      if (used.has(key(...cell)) || !farEnough(cell, chosen)) continue;
      chosen.push(cell);
      used.add(key(...cell));
    }
    for (const cell of chosen) {
      const alongX = rnd() < 0.5;
      const sign = rnd() < 0.5 ? 1 : -1;
      stairCells[from].set(key(...cell), { cell, dir: `${sign > 0 ? '+' : '-'}${alongX ? 'x' : 'z'}` });
    }
  }
  const voids = [new Set(), new Set(), new Set()];
  for (const level of [1, 2]) {
    for (const cell of shuffle(cells)) {
      if (voids[level].size >= 3) break;
      const k = key(...cell);
      if (used.has(k) || voids[1].has(k) || voids[2].has(k)) continue;
      const [i, j] = cell;
      if (i === 0 || j === 0 || i === N - 1 || j === N - 1) continue;
      voids[level].add(k);
    }
  }
  const isVoid = (level, i, j) => voids[level].has(key(i, j));

  // ── floors ───────────────────────────────────────────────────────────────
  for (const level of [1, 2]) {
    for (const [i, j] of cells) {
      if (isVoid(level, i, j)) continue;
      const paintable = rnd() < 0.55;
      kit.slab(level, cellMin(i), cellMin(i) + CELL, cellMin(j), cellMin(j) + CELL, {
        material: paintable ? 'iron' : 'struct', name: `slab-${level}-${i}-${j}`,
      });
    }
  }

  // ── stairs ───────────────────────────────────────────────────────────────
  for (const from of [0, 1]) {
    for (const { cell, dir } of stairCells[from].values()) {
      const [i, j] = cell;
      const cx = center(i);
      const cz = center(j);
      const len = 16 * 0.45;
      const sign = dir[0] === '+' ? 1 : -1;
      const sx = dir[1] === 'x' ? cx - sign * len / 2 : cx;
      const sz = dir[1] === 'z' ? cz - sign * len / 2 : cz;
      kit.stairs({ x: sx, z: sz, dir, fromLevel: from, toLevel: from + 1, name: `stair-${from}-${i}-${j}` });
    }
  }

  // ── walls between rooms ──────────────────────────────────────────────────
  const palettes = [
    ['iron', 'iron', 'struct', 'wood', 'struct', 'glass', 'rubber', 'iron'],
    ['wood', 'iron', 'struct', 'wood', 'glass', 'struct', 'iron', 'wood'],
    ['struct', 'iron', 'glass', 'iron', 'struct', 'rubber', 'wood', 'iron'],
  ];
  const styles = ['shell', 'shell2', 'shell3'];
  for (let level = 0; level < 3; level += 1) {
    const nodes = cells.filter(([i, j]) => !isVoid(level, i, j));
    const connected = new Set();
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    // randomized DFS spanning tree over non-void rooms
    const seen = new Set();
    const start = nodes[Math.floor(rnd() * nodes.length)];
    const stack = [start];
    seen.add(key(...start));
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const next = shuffle([[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]])
        .filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N && !isVoid(level, a, b) && !seen.has(key(a, b)));
      if (!next.length) {
        stack.pop();
        continue;
      }
      const [a, b] = next[0];
      connected.add(edgeKey(key(i, j), key(a, b)));
      seen.add(key(a, b));
      stack.push([a, b]);
    }

    const edge = (i, j, a, b) => {
      const vertical = a !== i; // boundary between columns → wall runs along z
      const line = vertical ? cellMin(Math.max(i, a)) : cellMin(Math.max(j, b));
      const span0 = vertical ? cellMin(j) : cellMin(i);
      const span1 = span0 + CELL;
      const mid = (span0 + span1) / 2;
      const voidSide = isVoid(level, i, j) || isVoid(level, a, b);
      const tree = connected.has(edgeKey(key(i, j), key(a, b)));
      const linked = tree || (!voidSide && rnd() < 0.32);
      const material = pick(palettes[level]);
      const opts = {
        material, style: styles[level], name: `w${level}-${i}-${j}-${a}-${b}`, openings: [],
      };
      if (voidSide) {
        if (rnd() < 0.7) opts.openings.push({ at: snap(mid + (rnd() - 0.5) * 6), w: 6, rail: true });
      } else if (linked) {
        const roll = rnd();
        if (roll < 0.1) return; // fully open: two rooms merge into a hall
        if (roll < 0.35) {
          opts.openings.push({ at: mid - 4.5, w: 2.4 }, { at: mid + 4.5, w: 2.4, fill: rnd() < 0.2 ? 'glass' : null });
        } else {
          const fillRoll = rnd();
          opts.openings.push({
            at: snap(mid + (rnd() - 0.5) * 9),
            w: pick([2.4, 3.0, 3.6]),
            // spanning-tree doors stay open so every room is always reachable
            fill: tree ? null : fillRoll < 0.12 ? 'glass' : fillRoll < 0.2 ? 'wood' : null,
          });
        }
      } else if (rnd() < 0.3) {
        opts.openings.push({ at: snap(mid + (rnd() - 0.5) * 8), w: 3.2, sill: 1.0, h: 1.5, fill: 'glass' });
      }
      if (vertical) kit.wallZ(line, span0, span1, level, opts);
      else kit.wallX(line, span0, span1, level, opts);
    };
    for (const [i, j] of cells) {
      if (i + 1 < N) edge(i, j, i + 1, j);
      if (j + 1 < N) edge(i, j, i, j + 1);
    }
  }

  // ── spawns (picked before props so props keep clear of them) ────────────
  const ffaSpawns = [];
  const spawnRects = [];
  for (let level = 0; level < 3; level += 1) {
    let count = 0;
    for (const [i, j] of shuffle(cells)) {
      if (count >= 6) break;
      if (isVoid(level, i, j)) continue;
      const y = levels[level];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const x = snap(center(i) + (rnd() - 0.5) * 9);
        const z = snap(center(j) + (rnd() - 0.5) * 9);
        const rect = { minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.6, maxZ: z + 1.6, minY: y, maxY: y + 2.2 };
        if (rectHits(rect, kit.reserved)) continue;
        const yaw = pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
        ffaSpawns.push({ x, y, z, yaw, level });
        spawnRects.push(rect);
        count += 1;
        break;
      }
    }
  }

  // ── light fixtures (placed first so tall props keep clear) ───────────────
  const placed = [];
  for (let level = 0; level < 3; level += 1) {
    const top = level < 2 ? levels[level + 1] - 0.28 : 12;
    for (const [i, j] of cells) {
      if (level < 2 && isVoid(level + 1, i, j)) continue;
      const stair = stairCells[level]?.get(key(i, j));
      let x = center(i);
      let z = center(j);
      if (stair) {
        if (stair.dir[1] === 'x') z += 5;
        else x += 5;
      }
      kit.fixture(x, top, z, `fx-${level}-${i}-${j}`);
      placed.push({ minX: x - 0.8, maxX: x + 0.8, minZ: z - 0.18, maxZ: z + 0.18, minY: top - 0.1, maxY: top });
    }
  }

  // ── props ────────────────────────────────────────────────────────────────
  const kinds = ['crate', 'crate', 'stack', 'desk', 'rack', 'tank', 'crate', 'pillar'];
  for (let level = 0; level < 3; level += 1) {
    const y = levels[level];
    for (const [i, j] of cells) {
      if (isVoid(level, i, j)) continue;
      const want = 2 + Math.floor(rnd() * 4);
      let made = 0;
      for (let attempt = 0; attempt < 24 && made < want; attempt += 1) {
        const type = pick(kinds);
        let w = 1.2;
        let h = 1.2;
        let d = 1.2;
        let material = rnd() < 0.6 ? 'wood' : 'iron';
        if (type === 'desk') { w = 2.4; h = 1.1; d = 0.8; }
        if (type === 'rack') { w = 1.2; h = 2.4; d = 2.4; material = 'iron'; }
        if (type === 'tank') { w = 1.4; h = 2.4; d = 1.4; material = 'glass'; }
        if (type === 'pillar') { w = 1.0; h = 3.72; d = 1.0; material = 'struct'; }
        if (type === 'crate') { const s = pick([0.9, 1.0, 1.2, 1.4]); w = s; h = s; d = s; }
        if (rnd() < 0.5) [w, d] = [d, w];
        const x = snap(cellMin(i) + 2.6 + w / 2 + rnd() * (CELL - 5.2 - w), 0.1);
        const z = snap(cellMin(j) + 2.6 + d / 2 + rnd() * (CELL - 5.2 - d), 0.1);
        const rect = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: y, maxY: y + h };
        if (rectHits(rect, kit.reserved, 0.4)) continue;
        if (rectHits(rect, spawnRects, 0.2)) continue;
        if (rectHits(rect, placed, 1.0)) continue;
        placed.push(rect);
        const name = `p${level}-${i}-${j}-${made}`;
        if (type === 'pillar') {
          kit.prop({ ...rect, maxY: y + 3.72, material: 'struct', paint: false, style: styles[level], name });
        } else {
          kit.crate(x, y, z, w, h, d, material, name);
          if (type === 'stack') kit.crate(x, y + h, z, w * 0.7, h * 0.7, d * 0.7, 'wood', `${name}t`);
        }
        made += 1;
      }
    }
  }

  const tints = [0xffe1c2, 0xc6e8ff, 0x9ef6e4];
  for (let level = 0; level < 3; level += 1) {
    const y = levels[level] + 3.0;
    kit.light(-24, y, -24, tints[level], 0.5, 34);
    kit.light(24, y, 24, tints[(level + 1) % 3], 0.5, 34);
    kit.light(level === 1 ? -24 : 24, y, level === 1 ? 24 : -24, tints[(level + 2) % 3], 0.45, 34);
  }

  const boxes = kit.finalize();
  const far = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 3;
  let best = [ffaSpawns[0], ffaSpawns[1]];
  for (const a of ffaSpawns) {
    for (const b of ffaSpawns) {
      if (far(a, b) > far(best[0], best[1])) best = [a, b];
    }
  }
  return {
    id: COMPLEX_ID,
    name: kit.name,
    levels,
    ceiling: kit.ceiling,
    bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF },
    boxes,
    decor: [],
    screen: null,
    lights: kit.lights,
    reserved: kit.reserved,
    fog: { near: 26, far: 95 },
    spawns: { atlas: best[0], outliers: best[1] },
    teamSpread: 0,
    ffaSpawns,
  };
}
