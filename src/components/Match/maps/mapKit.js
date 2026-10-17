// Pure-data map toolkit. Maps are described as axis-aligned boxes (no THREE
// here), so the same description feeds the renderer and the node geometry test.
//
// Overlaps are resolved automatically: every box has a priority and lower
// priority boxes are carved around higher priority ones (shell > walls running
// along z > walls running along x > floor slabs). Props (crates, consoles) are
// never carved; the geometry test fails if one of them intersects anything.

export const WALL_T = 0.24;
export const SHELL_T = 0.5;
export const SLAB_T = 0.28;
export const DOOR_H = 2.6;
export const PANEL_T = 0.12;
const EPS = 0.002;

export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function boxesOverlap(a, b, eps = EPS) {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps
    && a.minY < b.maxY - eps && a.maxY > b.minY + eps
    && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps;
}

function longAxis(b) {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  return w >= d ? 'X' : 'Z';
}

// a minus b, split along the long axis first so wall pieces stay full height.
function subtract(a, b) {
  if (!boxesOverlap(a, b, 0.0005)) return [a];
  const order = a.kind === 'floor'
    ? ['X', 'Z', 'Y']
    : (longAxis(a) === 'X' ? ['X', 'Y', 'Z'] : ['Z', 'Y', 'X']);
  const out = [];
  let core = { ...a };
  for (const axis of order) {
    const lo = `min${axis}`;
    const hi = `max${axis}`;
    if (b[lo] > core[lo]) out.push({ ...core, [hi]: b[lo] });
    if (b[hi] < core[hi]) out.push({ ...core, [lo]: b[hi] });
    core = { ...core, [lo]: Math.max(core[lo], b[lo]), [hi]: Math.min(core[hi], b[hi]) };
  }
  return out.filter((p) => p.maxX - p.minX > 0.02 && p.maxY - p.minY > 0.02 && p.maxZ - p.minZ > 0.02);
}

export function createKit({ name = 'map', width, depth, levels = [0, 4], ceiling = 8 }) {
  const boxes = [];
  const lights = [];
  const decor = [];
  const reserved = [];
  let serial = 0;
  const halfW = width / 2;
  const halfD = depth / 2;
  const innerW = halfW - SHELL_T;
  const innerD = halfD - SHELL_T;

  const uid = (base) => {
    serial += 1;
    return `${base || 'b'}-${serial}`;
  };

  // spec: { list, name, minX..maxZ, kind, material, paint, style, priority, carve:false, ... }
  const add = (spec) => {
    const box = {
      list: 'surfaces',
      kind: 'wall',
      material: 'struct',
      paint: false,
      style: 'shell',
      priority: 1,
      ...spec,
    };
    box.name = spec.name || uid('box');
    boxes.push(box);
    return box;
  };

  const levelY = (level) => levels[level];
  const wallSpan = (level) => {
    const y0 = levels[level];
    const top = level + 1 < levels.length ? levels[level + 1] - SLAB_T : ceiling;
    return [y0, top];
  };

  // A wall along the X axis (axis 'x') sits at z=line, spanning a0..a1 in x.
  // A wall along the Z axis (axis 'z') sits at x=line, spanning a0..a1 in z.
  // openings: [{ at, w, h=DOOR_H, sill=0, fill: null|'glass'|'wood'|..., rail:false }]
  const wall = (axis, line, a0, a1, y0, y1, opts = {}) => {
    const t = opts.t || WALL_T;
    const material = opts.material || 'iron';
    const paint = opts.paint !== undefined ? opts.paint : material !== 'struct';
    const style = opts.style || 'shell';
    const base = opts.name || uid(axis === 'x' ? 'wx' : 'wz');
    const priority = opts.priority || (axis === 'z' ? 2 : 1.5);
    const list = opts.list || (paint ? 'surfaces' : 'blocks');
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    let part = 0;
    const piece = (p0, p1, q0, q1, extra = {}) => {
      if (p1 - p0 < 0.03 || q1 - q0 < 0.03) return null;
      const th = extra.t || t;
      const b = axis === 'x'
        ? { minX: p0, maxX: p1, minZ: line - th / 2, maxZ: line + th / 2 }
        : { minX: line - th / 2, maxX: line + th / 2, minZ: p0, maxZ: p1 };
      return add({
        list, kind: 'wall', material, paint, style, priority, ...b, minY: q0, maxY: q1, ...extra, t: undefined,
        name: extra.name || `${base}-${part++}`,
      });
    };
    const openings = (opts.openings || [])
      .map((o) => ({ h: DOOR_H, sill: 0, ...o, a: o.at - o.w / 2, b: o.at + o.w / 2 }))
      .filter((o) => o.b > lo && o.a < hi)
      .sort((p, q) => p.a - q.a);
    let cursor = lo;
    for (const o of openings) {
      const oa = Math.max(lo, o.a);
      const ob = Math.min(hi, o.b);
      piece(cursor, oa, y0, y1);
      const top = Math.min(y1, y0 + o.sill + o.h);
      if (o.sill > 0) piece(oa, ob, y0, y0 + o.sill);
      piece(oa, ob, top, y1, { priority: priority - 0.05 });
      if (o.fill) {
        const fillPaint = o.fill !== 'struct';
        piece(oa, ob, y0 + o.sill, top, {
          list: 'surfaces', kind: o.sill > 0 ? 'wall' : 'door', material: o.fill, paint: fillPaint,
          t: PANEL_T, priority: priority - 0.1, door: o.sill > 0 ? null : o.fill,
        });
      } else if (o.rail) {
        piece(oa, ob, y0 + o.sill, y0 + o.sill + 1.05, {
          list: 'blocks', material: 'struct', paint: false, style: 'trim', t: 0.12, priority: priority - 0.1,
        });
      }
      cursor = ob;
    }
    piece(cursor, hi, y0, y1);
  };

  const wallX = (z, x0, x1, level, opts = {}) => {
    const [y0, y1] = opts.full ? [levels[level], ceiling] : wallSpan(level);
    wall('x', z, x0, x1, y0, y1, opts);
  };
  const wallZ = (x, z0, z1, level, opts = {}) => {
    const [y0, y1] = opts.full ? [levels[level], ceiling] : wallSpan(level);
    wall('z', x, z0, z1, y0, y1, opts);
  };

  const rail = (axis, line, a0, a1, y, opts = {}) => {
    wall(axis, line, a0, a1, y, y + 1.05, {
      t: 0.12, material: 'struct', paint: false, style: 'trim', list: 'blocks', priority: 1.2, ...opts,
    });
  };

  // Floor slab whose top sits at level y. Carved around stairs, cutters and walls.
  const slab = (level, minX, maxX, minZ, maxZ, opts = {}) => {
    const top = levels[level];
    const material = opts.material || 'iron';
    const paint = opts.paint !== undefined ? opts.paint : material !== 'struct';
    return add({
      list: 'floors', kind: 'floor', material, paint, style: opts.style || 'deck', priority: 0.5,
      minX, maxX, minY: top - SLAB_T, maxY: top, minZ, maxZ, name: opts.name,
    });
  };

  // Invisible box that only carves other boxes (stairwell holes).
  const cut = (minX, maxX, minY, maxY, minZ, maxZ) => add({
    list: 'cut', minX, maxX, minY, maxY, minZ, maxZ, priority: 0.55, cutter: true,
  });

  // Straight staircase. (x, z) is the centre of the bottom edge; dir is the
  // walking direction. Steps are solid blocks so nothing can walk under them,
  // stringers close both sides and continue as railings on the upper floor.
  const stairs = ({ x, z, dir, fromLevel, toLevel, width = 2.0, rise = 0.25, run = 0.45, name }) => {
    const y0 = levels[fromLevel];
    const y1 = levels[toLevel];
    const n = Math.round((y1 - y0) / rise);
    const step = (y1 - y0) / n;
    const length = n * run;
    const base = name || uid('stair');
    const sx = dir === '+x' ? 1 : dir === '-x' ? -1 : 0;
    const sz = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
    const alongX = sx !== 0;
    const rect = (a0, a1, b0, b1) => {
      // a: along walking dir (from start), b: across (from centre)
      if (alongX) {
        const p = x + sx * a0;
        const q = x + sx * a1;
        return { minX: Math.min(p, q), maxX: Math.max(p, q), minZ: z + b0, maxZ: z + b1 };
      }
      const p = z + sz * a0;
      const q = z + sz * a1;
      return { minX: x + b0, maxX: x + b1, minZ: Math.min(p, q), maxZ: Math.max(p, q) };
    };
    const half = width / 2;
    const st = 0.2;
    for (let i = 0; i < n; i += 1) {
      add({
        list: 'floors', kind: 'floor', material: 'struct', paint: false, style: 'step', priority: 6,
        ...rect(i * run, (i + 1) * run, -half, half), minY: y0, maxY: y0 + step * (i + 1),
        name: `${base}-s${i}`, stair: base,
      });
    }
    for (const side of [-1, 1]) {
      const b0 = side < 0 ? -half - st : half;
      add({
        list: 'blocks', kind: 'wall', material: 'struct', paint: false, style: 'trim', priority: 6,
        ...rect(0, length, b0, b0 + st), minY: y0, maxY: y1 + 1.05, name: `${base}-r${side < 0 ? 'l' : 'r'}`,
      });
    }
    // railing across the drop at the low end, on the upper floor
    add({
      list: 'blocks', kind: 'wall', material: 'struct', paint: false, style: 'trim', priority: 6,
      ...rect(0, 0.14, -half, half), minY: y1, maxY: y1 + 1.05, name: `${base}-rb`,
    });
    const foot = rect(0, length, -half - st, half + st);
    cut(foot.minX, foot.maxX, y1 - SLAB_T - 0.01, y1 + 0.01, foot.minZ, foot.maxZ);
    // keep props and spawns away from both ends and the stairwell
    const pad = rect(-2.2, length + 2.2, -half - st - 0.6, half + st + 0.6);
    reserved.push({ ...pad, minY: y0, maxY: y1 + 2.2, reason: base });
    return { foot, top: rect(length, length + 1, -half, half), bottom: rect(-1, 0, -half, half), length };
  };

  const prop = (spec) => add({
    list: 'props', kind: 'wall', material: 'wood', paint: true, style: 'shell', carve: false, priority: 9, ...spec,
  });

  const crate = (x, y, z, w, h, d, material = 'wood', name) => prop({
    minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2, material, name,
  });

  const fixture = (x, y, z, name) => add({
    list: 'props', kind: 'prop', material: 'struct', paint: false, style: 'light', carve: false, priority: 9,
    minX: x - 0.8, maxX: x + 0.8, minY: y - 0.1, maxY: y, minZ: z - 0.18, maxZ: z + 0.18, name,
  });

  const light = (x, y, z, color, intensity, distance) => lights.push({ x, y, z, color, intensity, distance });

  // Shell: ground, roof, and four outer walls.
  const shell = () => {
    add({
      list: 'floors', kind: 'floor', name: 'ground', style: 'ground', priority: 20,
      minX: -halfW, maxX: halfW, minY: -0.4, maxY: 0, minZ: -halfD, maxZ: halfD,
    });
    add({
      list: 'floors', kind: 'floor', name: 'ceiling', style: 'roof', priority: 20,
      minX: -halfW, maxX: halfW, minY: ceiling, maxY: ceiling + 0.36, minZ: -halfD, maxZ: halfD,
    });
    const w = (nm, b) => add({ list: 'blocks', kind: 'wall', name: nm, style: 'shell', priority: 20, minY: 0, maxY: ceiling, ...b });
    w('shell-w', { minX: -halfW, maxX: -innerW, minZ: -halfD, maxZ: halfD });
    w('shell-e', { minX: innerW, maxX: halfW, minZ: -halfD, maxZ: halfD });
    w('shell-n', { minX: -innerW, maxX: innerW, minZ: -halfD, maxZ: -innerD });
    w('shell-s', { minX: -innerW, maxX: innerW, minZ: innerD, maxZ: halfD });
  };

  const finalize = () => {
    const carving = boxes.filter((b) => b.carve !== false);
    const fixed = boxes.filter((b) => b.carve === false);
    const ordered = carving
      .map((b, index) => ({ b, index }))
      .sort((p, q) => q.b.priority - p.b.priority || p.index - q.index)
      .map((item) => item.b);
    const accepted = [];
    for (const box of ordered) {
      let pieces = [box];
      for (const other of accepted) {
        if (!boxesOverlap(box, other, 0.0005)) continue;
        const next = [];
        for (const piece of pieces) next.push(...subtract(piece, other));
        pieces = next;
        if (!pieces.length) break;
      }
      if (pieces.length === 1) accepted.push(pieces[0]);
      else pieces.forEach((piece, i) => accepted.push({ ...piece, name: `${box.name}~${i}` }));
    }
    const all = [...accepted, ...fixed].filter((b) => !b.cutter);
    const seen = new Set();
    for (const b of all) {
      let id = b.name;
      let k = 1;
      while (seen.has(id)) {
        id = `${b.name}#${k}`;
        k += 1;
      }
      b.name = id;
      seen.add(id);
      b.x = (b.minX + b.maxX) / 2;
      b.y = (b.minY + b.maxY) / 2;
      b.z = (b.minZ + b.maxZ) / 2;
      b.w = b.maxX - b.minX;
      b.h = b.maxY - b.minY;
      b.d = b.maxZ - b.minZ;
    }
    return all;
  };

  return {
    name, width, depth, levels, ceiling, innerW, innerD,
    add, wall, wallX, wallZ, rail, slab, cut, stairs, prop, crate, fixture, light, shell,
    levelY, wallSpan, reserved, decor, lights, finalize,
  };
}

// Region helpers used by map generators to keep props and spawns apart.
export function rectHits(rect, list, pad = 0) {
  return list.some((r) => rect.minX < r.maxX + pad && rect.maxX > r.minX - pad
    && rect.minZ < r.maxZ + pad && rect.maxZ > r.minZ - pad
    && (rect.minY === undefined || r.minY === undefined || (rect.minY < r.maxY && rect.maxY > r.minY)));
}
