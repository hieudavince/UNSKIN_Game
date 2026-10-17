function hypot(a, b) {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

function lerp(a, b, t) {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
}

function isCorner(prev, curr, next) {
  const ax = curr.u - prev.u;
  const ay = curr.v - prev.v;
  const bx = next.u - curr.u;
  const by = next.v - curr.v;
  const al = Math.hypot(ax, ay) || 1;
  const bl = Math.hypot(bx, by) || 1;
  return (ax / al) * (bx / bl) + (ay / al) * (by / bl) < 0.9;
}

export function resamplePolyline(points, step) {
  if (!points || !points.length) return [];
  if (points.length === 1) return [{ u: points[0].u, v: points[0].v }];
  const out = [{ u: points[0].u, v: points[0].v }];
  let cursor = points[0];
  let budget = step;
  for (let i = 1; i < points.length; i += 1) {
    const target = points[i];
    let dist = hypot(cursor, target);
    while (dist >= budget && dist > 1e-6) {
      const t = budget / dist;
      cursor = lerp(cursor, target, t);
      out.push({ u: cursor.u, v: cursor.v });
      dist = hypot(cursor, target);
      budget = step;
    }
    const corner = i === points.length - 1 || isCorner(points[i - 1], points[i], points[i + 1]);
    if (corner) {
      if (hypot(out[out.length - 1], target) > 0.008) out.push({ u: target.u, v: target.v });
      cursor = target;
      budget = step;
    } else {
      budget = Math.max(0, budget - dist);
      cursor = target;
    }
  }
  return out;
}

function leftPerp(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function offsetAt(points, index, half) {
  const curr = points[index];
  const prev = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  if (index === 0 || index === points.length - 1) {
    const from = index === 0 ? curr : prev;
    const to = index === 0 ? next : curr;
    const p = leftPerp(to.u - from.u, to.v - from.v);
    return { x: p.x * half, y: p.y * half };
  }
  const incoming = leftPerp(curr.u - prev.u, curr.v - prev.v);
  const outgoing = leftPerp(next.u - curr.u, next.v - curr.v);
  let mx = incoming.x + outgoing.x;
  let my = incoming.y + outgoing.y;
  const ml = Math.hypot(mx, my);
  if (ml < 1e-5) return { x: outgoing.x * half, y: outgoing.y * half };
  mx /= ml;
  my /= ml;
  const denom = mx * outgoing.x + my * outgoing.y;
  if (denom <= 0.28) return { x: outgoing.x * half, y: outgoing.y * half };
  const scale = Math.min(2.15, 1 / denom);
  return { x: mx * scale * half, y: my * scale * half };
}

function pushCap(tris, origin, dirU, dirV, half) {
  const len = Math.hypot(dirU, dirV) || 1;
  const fx = dirU / len;
  const fy = dirV / len;
  const lx = -fy;
  const ly = fx;
  const segments = 5;
  for (let s = 0; s < segments; s += 1) {
    const t0 = (s / segments) * Math.PI;
    const t1 = ((s + 1) / segments) * Math.PI;
    tris.push(origin);
    tris.push({
      u: origin.u + (lx * Math.cos(t0) + fx * Math.sin(t0)) * half,
      v: origin.v + (ly * Math.cos(t0) + fy * Math.sin(t0)) * half,
    });
    tris.push({
      u: origin.u + (lx * Math.cos(t1) + fx * Math.sin(t1)) * half,
      v: origin.v + (ly * Math.cos(t1) + fy * Math.sin(t1)) * half,
    });
  }
}

export function ribbonTriangles(points, half) {
  if (!points || points.length < 2) return [];
  const clean = [{ u: points[0].u, v: points[0].v }];
  for (let i = 1; i < points.length; i += 1) {
    if (hypot(clean[clean.length - 1], points[i]) > 0.004) {
      clean.push({ u: points[i].u, v: points[i].v });
    }
  }
  if (clean.length < 2) return [];
  const offs = clean.map((_, index) => offsetAt(clean, index, half));
  const left = (index) => ({ u: clean[index].u + offs[index].x, v: clean[index].v + offs[index].y });
  const right = (index) => ({ u: clean[index].u - offs[index].x, v: clean[index].v - offs[index].y });
  const tris = [];
  for (let i = 0; i < clean.length - 1; i += 1) {
    const a = left(i);
    const b = right(i);
    const c = left(i + 1);
    const d = right(i + 1);
    tris.push(a, b, c, b, d, c);
  }
  pushCap(tris, clean[0], clean[0].u - clean[1].u, clean[0].v - clean[1].v, half);
  const last = clean.length - 1;
  pushCap(tris, clean[last], clean[last].u - clean[last - 1].u, clean[last].v - clean[last - 1].v, half);
  return tris;
}

function clipSegment(a, b, rect) {
  let ax = a.u;
  let ay = a.v;
  let bx = b.u;
  let by = b.v;
  const code = (x, y) => (x < rect.minU ? 1 : 0)
    | (x > rect.maxU ? 2 : 0)
    | (y < rect.minV ? 4 : 0)
    | (y > rect.maxV ? 8 : 0);
  let ca = code(ax, ay);
  let cb = code(bx, by);
  for (let i = 0; i < 8; i += 1) {
    if (!(ca | cb)) return [{ u: ax, v: ay }, { u: bx, v: by }];
    if (ca & cb) return null;
    const bits = ca || cb;
    let x = 0;
    let y = 0;
    if (bits & 1) {
      y = ay + ((by - ay) * (rect.minU - ax)) / ((bx - ax) || 1e-9);
      x = rect.minU;
    } else if (bits & 2) {
      y = ay + ((by - ay) * (rect.maxU - ax)) / ((bx - ax) || 1e-9);
      x = rect.maxU;
    } else if (bits & 4) {
      x = ax + ((bx - ax) * (rect.minV - ay)) / ((by - ay) || 1e-9);
      y = rect.minV;
    } else {
      x = ax + ((bx - ax) * (rect.maxV - ay)) / ((by - ay) || 1e-9);
      y = rect.maxV;
    }
    if (bits === ca) {
      ax = x;
      ay = y;
      ca = code(ax, ay);
    } else {
      bx = x;
      by = y;
      cb = code(bx, by);
    }
  }
  return [{ u: ax, v: ay }, { u: bx, v: by }];
}

export function clipStroke(points, rects) {
  if (!points || points.length < 2) return [];
  if (!rects || !rects.length) return [points.map((point) => ({ u: point.u, v: point.v }))];
  const runs = [];
  let run = [];
  const add = (point) => {
    const last = run[run.length - 1];
    if (!last || hypot(last, point) > 0.006) run.push({ u: point.u, v: point.v });
  };
  const flush = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };
  for (let i = 0; i < points.length - 1; i += 1) {
    const parts = [];
    const du = points[i + 1].u - points[i].u;
    const dv = points[i + 1].v - points[i].v;
    for (const rect of rects) {
      const seg = clipSegment(points[i], points[i + 1], rect);
      if (!seg || hypot(seg[0], seg[1]) < 0.008) continue;
      const t = (seg[0].u - points[i].u) * du + (seg[0].v - points[i].v) * dv;
      parts.push({ seg, t });
    }
    parts.sort((a, b) => a.t - b.t);
    if (!parts.length) {
      flush();
      continue;
    }
    for (const part of parts) {
      if (run.length && hypot(run[run.length - 1], part.seg[0]) > 0.04) flush();
      add(part.seg[0]);
      add(part.seg[1]);
    }
  }
  flush();
  return runs;
}
