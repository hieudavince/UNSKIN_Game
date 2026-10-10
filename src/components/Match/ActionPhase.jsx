import { applyMaterial, meshBox, overlap } from './PrepPhase';

const RIFLE_INTERVAL_MS = 100;
const RIFLE_RANGE = 100;
const SKIN_RANGE = 15;
const BODY_DAMAGE = 25;
const HEAD_DAMAGE = 75;
const BOT_DAMAGE = 10;
const BOT_SHOT_MS = 900;
const BOT_HIT_CHANCE = 0.7;
const CHASE_RANGE = 20;
const LOSE_RANGE = 24;
const ATTACK_RANGE = 15;
const DROP_ATTACK_RANGE = 18;
const BOT_SPEED = 3.5;
const RESKIN_INTERVAL_MS = 10000;
const RESKIN_CHANCE = 0.3;

function noop() {}

export function inventorySlots(game) {
  const items = game.inventory;
  if (!items.length) return [null, null];
  const count = items.length;
  const index = ((game.slotIndex % count) + count) % count;
  game.slotIndex = index;
  return [items[index], count > 1 ? items[(index + 1) % count] : null];
}

export function emitInventory(game) {
  game.emit('game:inventory', { slots: inventorySlots(game) });
}

export function rebuildMasks(game) {
  const move = [];
  const bullets = [];
  const skin = [];
  const paint = [];
  const consider = (mesh) => {
    if (mesh.userData.paintable && mesh.visible) paint.push(mesh);
  };
  const addSolid = (mesh, canMove) => {
    if (mesh.userData.solid === false) return;
    if (!mesh.userData.skipBullets) bullets.push(mesh);
    if (canMove && !mesh.userData.visualOnly && !mesh.userData.noMove) move.push(mesh);
  };
  for (const mesh of game.floors) {
    consider(mesh);
    addSolid(mesh, false);
  }
  for (const mesh of game.blocks) {
    move.push(mesh);
    if (mesh.userData.solid !== false && !mesh.userData.skipBullets) bullets.push(mesh);
  }
  for (const mesh of game.surfaces) {
    consider(mesh);
    if (mesh.userData.skinnable && mesh.visible) skin.push(mesh);
    addSolid(mesh, mesh.userData.kind !== 'floor');
  }
  for (const mesh of game.props) {
    consider(mesh);
    addSolid(mesh, true);
  }
  for (const bot of game.bots || []) {
    if (!bot.active || bot.state === 'dead') continue;
    move.push(bot.body);
    bullets.push(bot.body, bot.head);
  }
  for (const cell of game.passages || []) {
    if (cell.userData.solid !== false) move.push(cell);
  }

  game.moveMask = move;
  game.bulletMask = bullets;
  game.skinMask = skin;
  game.paintMask = paint;
}

export function setSurfaceMaterial(game, mesh, name) {
  if (game.aimMesh === mesh) {
    mesh.onBeforeRender = noop;
    mesh.onAfterRender = noop;
    game.aimMesh = null;
    game.aimMat = null;
  }
  applyMaterial(mesh, name, game.mats);
  rebuildMasks(game);
}

export function allBotsDown(game) {
  const active = game.bots.filter((bot) => bot.active);
  return active.length > 0 && active.every((bot) => bot.state === 'dead');
}

function killMesh(mesh) {
  if (!mesh || mesh.userData.destroyed) return;
  if (mesh.userData.basePaintable == null) mesh.userData.basePaintable = !!mesh.userData.paintable;
  if (mesh.userData.baseSkinnable == null) mesh.userData.baseSkinnable = !!mesh.userData.skinnable;
  mesh.visible = false;
  mesh.userData.destroyed = true;
  mesh.userData.solid = false;
  mesh.userData.paintable = false;
  mesh.userData.skinnable = false;
  mesh.userData.materialName = 'gone';
  mesh.userData.penetrable = false;
  mesh.userData.skipBullets = true;
}

function clearHostPassage(game, host) {
  if (!game.passages || !host.userData.passage) return;
  const mine = new Set(host.userData.passage);
  game.passages = game.passages.filter((cell) => !mine.has(cell));
  host.userData.passage = null;
}

function rebuildPassage(game, host) {
  clearHostPassage(game, host);
  const openings = host.userData.openings || [];
  if (!openings.length || (host.userData.axis || 'y') === 'y') {
    host.userData.noMove = false;
    return;
  }
  host.userData.noMove = true;
  const rect = host.userData.paintRect || panelRect(host);
  const axis = host.userData.axis || 'z';
  const anchor = host.position[axis];
  const thick = Math.max(0.2, panelThickness(host));
  const step = 0.36;
  const boxes = [];
  for (let u = rect.minU; u < rect.maxU - 0.02; u += step) {
    for (let v = rect.minV; v < rect.maxV - 0.02; v += step) {
      const cu = Math.min(step, rect.maxU - u);
      const cv = Math.min(step, rect.maxV - v);
      const sample = { u: u + cu * 0.5, v: v + cv * 0.5 };
      const open = openings.some((poly) => pointInPoly(sample, poly));
      const covered = (host.userData.stamps || []).some((stamp) => (
        stamp
        && !stamp.userData.destroyed
        && stamp.userData.materialName !== 'gone'
        && stamp.userData.region
        && pointInPoly(sample, stamp.userData.region.points)
      ));
      if (open && !covered) continue;
      const world = worldFromUV(axis, anchor, sample.u, sample.v);
      const size = axis === 'x' ? { w: thick, h: cv, d: cu } : { w: cu, h: cv, d: thick };
      boxes.push({
        position: world,
        userData: { ...size, solid: true, kind: 'wall', skipBullets: true, paintable: false, passage: true },
      });
    }
  }
  host.userData.passage = boxes;
  if (!game.passages) game.passages = [];
  game.passages.push(...boxes);
}

function destroySurface(mesh, game) {
  if (!mesh) return;
  if (mesh.userData.stamp) {
    const glass = mesh.userData.materialName === 'glass';
    const poly = mesh.userData.region && mesh.userData.region.points;
    const hosts = mesh.userData.hosts || (mesh.userData.source ? [mesh.userData.source] : []);
    killMesh(mesh);
    if (game && glass && poly) {
      for (const host of hosts) {
        const rect = host.userData.paintRect || panelRect(host);
        const clipped = clipToRect(poly, rect);
        if (clipped.length < 3) continue;
        if (!host.userData.openings) host.userData.openings = [];
        host.userData.openings.push(clipped);
        rebuildPassage(game, host);
      }
    }
    return;
  }
  const root = mesh.userData.source || mesh;
  killMesh(root);
  killMesh(root.userData.remainder);
  for (const stamp of root.userData.stamps || []) killMesh(stamp);
}

function shatterGlass(game, meshes) {
  let changed = false;
  for (const mesh of meshes) {
    if (!mesh.userData.paintable || mesh.userData.materialName !== 'glass') continue;
    destroySurface(mesh, game);
    changed = true;
  }
  if (changed) {
    rebuildMasks(game);
    game.sfx.swipe();
  }
  return changed;
}

function resolveBullet(game, origin, direction, far, ignoreBotIndex) {
  const ray = game.raycaster;
  ray.set(origin, direction);
  ray.far = far;
  const hits = ray.intersectObjects(game.bulletMask, false);
  const broken = [];
  let throughWood = false;
  let stop = null;
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const data = hit.object.userData;
    if (data.type === 'bot' && data.botIndex === ignoreBotIndex) continue;
    if (data.solid === false) continue;
    if (data.materialName === 'glass') {
      broken.push(hit.object);
      continue;
    }
    if (data.materialName === 'wood') {
      throughWood = true;
      continue;
    }
    stop = hit;
    break;
  }
  shatterGlass(game, broken);
  return { hit: stop, scale: throughWood ? 0.4 : 1 };
}

function skinPick(game) {
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const ray = game.raycaster;
  ray.set(game._o, game._d);
  ray.far = SKIN_RANGE;
  const hits = ray.intersectObjects(game.skinMask, false);
  return hits[0] || null;
}

function clearAim(game) {
  const mesh = game.aimMesh;
  if (!mesh) return;
  mesh.onBeforeRender = noop;
  mesh.onAfterRender = noop;
  game.aimMesh = null;
  game.aimMat = null;
}

export function updateHighlight(game) {
  if (game.highlight) game.highlight.visible = false;
  clearAim(game);
}

function paintAim(game) {
  if (!game.paintMask || !game.paintMask.length) return null;
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const ray = game.raycaster;
  ray.set(game._o, game._d);
  ray.far = 32;
  const hits = ray.intersectObjects(game.paintMask, false);
  return hits[0] || null;
}

function aimOnPlane(game, axis, plane) {
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const denom = axis === 'x' ? game._d.x : axis === 'z' ? game._d.z : game._d.y;
  if (Math.abs(denom) < 0.0001) return null;
  const origin = axis === 'x' ? game._o.x : axis === 'z' ? game._o.z : game._o.y;
  const t = (plane - origin) / denom;
  if (t < 0.04 || t > 42) return null;
  return {
    x: game._o.x + game._d.x * t,
    y: game._o.y + game._d.y * t,
    z: game._o.z + game._d.z * t,
  };
}

function planeUV(point, axis) {
  if (axis === 'x') return { u: point.z, v: point.y };
  if (axis === 'z') return { u: point.x, v: point.y };
  return { u: point.x, v: point.z };
}

function panelUV(mesh) {
  return planeUV(mesh.position, mesh.userData.axis || 'y');
}

function portalHex(name) {
  if (name === 'wood') return 0xffe14a;
  if (name === 'iron') return 0x7ee8ff;
  return 0xd8fff6;
}

function uvDist(a, b) {
  return Math.hypot(a.u - b.u, a.v - b.v);
}

function shoelace(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length];
    sum += points[i].u * next.v - next.u * points[i].v;
  }
  return sum * 0.5;
}

function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q.u - p.u) * (r.v - p.v) - (q.v - p.v) * (r.u - p.u);
  const ab = cross(a, b, c);
  const cd = cross(a, b, d);
  const ac = cross(c, d, a);
  const bd = cross(c, d, b);
  return ab * cd < 0 && ac * bd < 0;
}

function strokeClosed(points) {
  if (points.length < 8) return false;
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += uvDist(points[i - 1], points[i]);
  if (length < 0.85) return false;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of points) {
    minU = Math.min(minU, point.u);
    maxU = Math.max(maxU, point.u);
    minV = Math.min(minV, point.v);
    maxV = Math.max(maxV, point.v);
  }
  const diag = Math.hypot(maxU - minU, maxV - minV);
  if (diag < 0.35) return false;
  const gap = Math.min(0.65, Math.max(0.25, diag * 0.22));
  if (uvDist(points[0], points[points.length - 1]) > gap) return false;
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % count];
    for (let j = i + 2; j < count; j += 1) {
      if (i === 0 && j === count - 1) continue;
      const nearJoin = (i < 3 || i > count - 4) && j > count - 4;
      if (nearJoin) continue;
      const c = points[j];
      const d = points[(j + 1) % count];
      if (segmentsCross(a, b, c, d)) return false;
    }
  }
  return Math.abs(shoelace(points)) >= 0.12;
}

function ensureStroke(game) {
  if (game.stroke) return game.stroke;
  const geo = new game.THREE.BufferGeometry();
  geo.setAttribute('position', new game.THREE.BufferAttribute(new Float32Array(9), 3));
  const mat = new game.THREE.MeshBasicMaterial({
    color: 0xd8fff6,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.96,
    side: game.THREE.DoubleSide,
  });
  const ribbon = new game.THREE.Mesh(geo, mat);
  ribbon.frustumCulled = false;
  ribbon.renderOrder = 25;
  ribbon.raycast = () => {};
  ribbon.visible = false;
  game.materialDisposables.push(mat);
  game.geometries.push(geo);
  game.scene.add(ribbon);
  game.stroke = ribbon;
  return ribbon;
}

function worldFromUV(axis, anchor, u, v) {
  if (axis === 'x') return { x: anchor, y: v, z: u };
  if (axis === 'z') return { x: u, y: v, z: anchor };
  return { x: u, y: anchor, z: v };
}

function clipSegment(a, b, rect) {
  let ax = a.u;
  let ay = a.v;
  let bx = b.u;
  let by = b.v;
  let ca = (ax < rect.minU ? 1 : 0) | (ax > rect.maxU ? 2 : 0) | (ay < rect.minV ? 4 : 0) | (ay > rect.maxV ? 8 : 0);
  let cb = (bx < rect.minU ? 1 : 0) | (bx > rect.maxU ? 2 : 0) | (by < rect.minV ? 4 : 0) | (by > rect.maxV ? 8 : 0);
  for (let i = 0; i < 8; i += 1) {
    if (!(ca | cb)) return [{ u: ax, v: ay }, { u: bx, v: by }];
    if (ca & cb) return null;
    const code = ca || cb;
    let x = 0;
    let y = 0;
    if (code & 1) {
      y = ay + (by - ay) * (rect.minU - ax) / ((bx - ax) || 1e-9);
      x = rect.minU;
    } else if (code & 2) {
      y = ay + (by - ay) * (rect.maxU - ax) / ((bx - ax) || 1e-9);
      x = rect.maxU;
    } else if (code & 4) {
      x = ax + (bx - ax) * (rect.minV - ay) / ((by - ay) || 1e-9);
      y = rect.minV;
    } else {
      x = ax + (bx - ax) * (rect.maxV - ay) / ((by - ay) || 1e-9);
      y = rect.maxV;
    }
    if (code === ca) {
      ax = x;
      ay = y;
      ca = (ax < rect.minU ? 1 : 0) | (ax > rect.maxU ? 2 : 0) | (ay < rect.minV ? 4 : 0) | (ay > rect.maxV ? 8 : 0);
    } else {
      bx = x;
      by = y;
      cb = (bx < rect.minU ? 1 : 0) | (bx > rect.maxU ? 2 : 0) | (by < rect.minV ? 4 : 0) | (by > rect.maxV ? 8 : 0);
    }
  }
  return [{ u: ax, v: ay }, { u: bx, v: by }];
}

function redrawStroke(game, color) {
  const ribbon = ensureStroke(game);
  const { axis, plane, anchor, points, materialName } = game.paint;
  ribbon.material.color.setHex(color);
  if (!points || points.length < 2) {
    ribbon.visible = false;
    return;
  }
  const lift = plane == null ? anchor : plane;
  const rects = [];
  const seen = new Set();
  for (const mesh of game.paintMask || []) {
    const host = mesh.userData.source || mesh;
    if (seen.has(host) || host.userData.destroyed) continue;
    if ((host.userData.axis || 'y') !== axis) continue;
    if (Math.abs(host.position[axis] - anchor) > 0.15) continue;
    if (materialName && host.userData.materialName !== materialName) continue;
    seen.add(host);
    rects.push(host.userData.paintRect || panelRect(host));
  }
  const pieces = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    let hit = false;
    for (const rect of rects) {
      const seg = clipSegment(points[i], points[i + 1], rect);
      if (!seg) continue;
      if (Math.hypot(seg[0].u - seg[1].u, seg[0].v - seg[1].v) < 0.02) continue;
      pieces.push(seg);
      hit = true;
    }
    if (!hit && !rects.length) pieces.push([points[i], points[i + 1]]);
  }
  if (!pieces.length) {
    ribbon.visible = false;
    return;
  }
  const half = 0.045;
  const positions = new Float32Array(pieces.length * 18);
  let offset = 0;
  const push = (u, v) => {
    const world = worldFromUV(axis, lift, u, v);
    positions[offset] = world.x;
    positions[offset + 1] = world.y;
    positions[offset + 2] = world.z;
    offset += 3;
  };
  for (const [a, b] of pieces) {
    let du = b.u - a.u;
    let dv = b.v - a.v;
    const len = Math.hypot(du, dv) || 1;
    du /= len;
    dv /= len;
    const pu = -dv * half;
    const pv = du * half;
    push(a.u + pu, a.v + pv);
    push(a.u - pu, a.v - pv);
    push(b.u + pu, b.v + pv);
    push(a.u - pu, a.v - pv);
    push(b.u - pu, b.v - pv);
    push(b.u + pu, b.v + pv);
  }
  ribbon.geometry.setAttribute('position', new game.THREE.BufferAttribute(positions, 3));
  ribbon.visible = true;
}

function clipToRect(poly, rect) {
  const edges = [
    [(p) => p.u >= rect.minU, (s, e) => {
      const t = (rect.minU - s.u) / (e.u - s.u);
      return { u: rect.minU, v: s.v + (e.v - s.v) * t };
    }],
    [(p) => p.u <= rect.maxU, (s, e) => {
      const t = (rect.maxU - s.u) / (e.u - s.u);
      return { u: rect.maxU, v: s.v + (e.v - s.v) * t };
    }],
    [(p) => p.v >= rect.minV, (s, e) => {
      const t = (rect.minV - s.v) / (e.v - s.v);
      return { u: s.u + (e.u - s.u) * t, v: rect.minV };
    }],
    [(p) => p.v <= rect.maxV, (s, e) => {
      const t = (rect.maxV - s.v) / (e.v - s.v);
      return { u: s.u + (e.u - s.u) * t, v: rect.maxV };
    }],
  ];
  let output = poly;
  for (const [inside, split] of edges) {
    if (output.length < 3) return [];
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      const curIn = inside(current);
      const prevIn = inside(previous);
      if (curIn) {
        if (!prevIn) output.push(split(previous, current));
        output.push(current);
      } else if (prevIn) output.push(split(previous, current));
    }
  }
  return output;
}

function panelRect(mesh) {
  if (mesh.userData.paintRect) return mesh.userData.paintRect;
  if (mesh.userData.region) {
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const point of mesh.userData.region.points) {
      minU = Math.min(minU, point.u);
      maxU = Math.max(maxU, point.u);
      minV = Math.min(minV, point.v);
      maxV = Math.max(maxV, point.v);
    }
    return { minU, maxU, minV, maxV };
  }
  const axis = mesh.userData.axis || 'y';
  const p = mesh.position;
  const { w, h, d } = mesh.userData;
  if (axis === 'x') {
    return { minU: p.z - d * 0.5, maxU: p.z + d * 0.5, minV: p.y - h * 0.5, maxV: p.y + h * 0.5 };
  }
  if (axis === 'z') {
    return { minU: p.x - w * 0.5, maxU: p.x + w * 0.5, minV: p.y - h * 0.5, maxV: p.y + h * 0.5 };
  }
  return { minU: p.x - w * 0.5, maxU: p.x + w * 0.5, minV: p.z - d * 0.5, maxV: p.z + d * 0.5 };
}

function panelThickness(mesh) {
  const axis = mesh.userData.axis || 'y';
  if (axis === 'x') return mesh.userData.w;
  if (axis === 'z') return mesh.userData.d;
  return mesh.userData.h;
}

function orientToPlane(game, mesh, axis, anchor) {
  const uAxis = new game.THREE.Vector3(axis === 'x' ? 0 : 1, 0, axis === 'x' ? 1 : 0);
  const vAxis = new game.THREE.Vector3(0, axis === 'y' ? 0 : 1, axis === 'y' ? 1 : 0);
  const normal = new game.THREE.Vector3().crossVectors(uAxis, vAxis).normalize();
  mesh.quaternion.setFromRotationMatrix(new game.THREE.Matrix4().makeBasis(uAxis, vAxis, normal));
  const origin = worldFromUV(axis, anchor, 0, 0);
  mesh.position.set(origin.x, origin.y, origin.z);
}

function assertExtrude(geo) {
  const pos = geo.attributes && geo.attributes.position;
  if (!pos || pos.count < 3) throw new Error('shape');
  return geo;
}

function extrudePolygon(game, points, thickness) {
  const shape = new game.THREE.Shape();
  shape.moveTo(points[0].u, points[0].v);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i].u, points[i].v);
  const geo = new game.THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness * 0.5);
  return assertExtrude(geo);
}

function extrudeWithHoles(game, rect, holes, thickness) {
  const shape = new game.THREE.Shape();
  shape.moveTo(rect.minU, rect.minV);
  shape.lineTo(rect.maxU, rect.minV);
  shape.lineTo(rect.maxU, rect.maxV);
  shape.lineTo(rect.minU, rect.maxV);
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    const path = new game.THREE.Path();
    const reversed = hole.slice().reverse();
    path.moveTo(reversed[0].u, reversed[0].v);
    for (let i = 1; i < reversed.length; i += 1) path.lineTo(reversed[i].u, reversed[i].v);
    shape.holes.push(path);
  }
  const geo = new game.THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness * 0.5);
  return assertExtrude(geo);
}

function seatHole(hole, rect) {
  const eps = 0.04;
  return hole.map((point) => {
    let u = point.u;
    let v = point.v;
    if (Math.abs(u - rect.minU) <= eps) u = rect.minU;
    else if (Math.abs(u - rect.maxU) <= eps) u = rect.maxU;
    if (Math.abs(v - rect.minV) <= eps) v = rect.minV;
    else if (Math.abs(v - rect.maxV) <= eps) v = rect.maxV;
    return { u, v };
  });
}

function insetBoundary(hole, rect) {
  const eps = 0.05;
  const nudge = 0.004;
  return hole.map((point) => {
    let u = point.u;
    let v = point.v;
    if (u <= rect.minU + eps) u = rect.minU + nudge;
    else if (u >= rect.maxU - eps) u = rect.maxU - nudge;
    if (v <= rect.minV + eps) v = rect.minV + nudge;
    else if (v >= rect.maxV - eps) v = rect.maxV - nudge;
    return { u, v };
  });
}

function dedupeRing(points) {
  const out = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && uvDist(last, point) < 0.02) continue;
    out.push({ u: point.u, v: point.v });
  }
  if (out.length > 2 && uvDist(out[0], out[out.length - 1]) < 0.02) out.pop();
  return out;
}

function attachRemainder(game, host, holes, geo) {
  const rect = host.userData.paintRect || panelRect(host);
  host.userData.paintRect = rect;
  host.userData.holes = holes;
  const axis = host.userData.axis || 'y';
  let remainder = host.userData.remainder;
  if (!remainder) {
    remainder = new game.THREE.Mesh(geo, host.material);
    orientToPlane(game, remainder, axis, host.position[axis]);
    remainder.frustumCulled = false;
    remainder.userData = {
      w: host.userData.w,
      h: host.userData.h,
      d: host.userData.d,
      axis,
      area: host.userData.area,
      kind: host.userData.kind,
      paintable: true,
      skinnable: true,
      materialName: host.userData.materialName,
      initialMaterial: host.userData.initialMaterial,
      solid: true,
      bounce: !!host.userData.bounce,
      transparent: !!host.userData.transparent,
      penetrable: !!host.userData.penetrable,
      visualOnly: true,
      structural: true,
      shape: true,
      source: host,
      paintRect: rect,
      door: host.userData.door || null,
      center: { x: host.position.x, y: host.position.y, z: host.position.z },
    };
    game.scene.add(remainder);
    game.surfaces.push(remainder);
    host.userData.remainder = remainder;
  } else {
    remainder.geometry.dispose();
    remainder.geometry = geo;
    remainder.material = host.material;
    remainder.visible = true;
    remainder.userData.materialName = host.userData.materialName;
    remainder.userData.penetrable = !!host.userData.penetrable;
    remainder.userData.transparent = !!host.userData.transparent;
    remainder.userData.solid = true;
    remainder.userData.destroyed = false;
    remainder.userData.paintable = true;
  }
  host.visible = false;
  host.userData.skipBullets = true;
}

function attachStamp(game, host, points, materialName, thickness, sign, geo) {
  const axis = host.userData.axis || 'y';
  const anchor = host.position[axis];
  const mesh = new game.THREE.Mesh(geo, game.mats[materialName]);
  orientToPlane(game, mesh, axis, anchor + (sign || 1) * 0.015);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  let su = 0;
  let sv = 0;
  for (const point of points) {
    su += point.u;
    sv += point.v;
  }
  su /= points.length;
  sv /= points.length;
  mesh.userData = {
    w: thickness,
    h: thickness,
    d: thickness,
    axis,
    area: Math.abs(shoelace(points)),
    kind: host.userData.kind,
    paintable: true,
    skinnable: true,
    materialName,
    initialMaterial: materialName,
    solid: true,
    bounce: false,
    transparent: materialName === 'glass',
    penetrable: materialName === 'glass' || materialName === 'wood',
    visualOnly: true,
    stamp: true,
    shape: true,
    source: host,
    region: { points: points.map((point) => ({ u: point.u, v: point.v })) },
    center: worldFromUV(axis, anchor, su, sv),
  };
  game.scene.add(mesh);
  game.surfaces.push(mesh);
  if (!host.userData.stamps) host.userData.stamps = [];
  host.userData.stamps.push(mesh);
  return mesh;
}

export function beginPaint(game) {
  if (game.phase !== 'action' || game.player.hp <= 0 || game.mode !== 'portal') return;
  const hit = paintAim(game);
  if (!hit || !hit.object.userData.paintable) return;
  const host = hit.object.userData.source || hit.object;
  const axis = host.userData.axis || 'y';
  const anchor = host.position[axis];
  const half = panelThickness(host) * 0.5;
  const cam = axis === 'x' ? game.camera.position.x : axis === 'z' ? game.camera.position.z : game.camera.position.y;
  const sign = cam >= anchor ? 1 : -1;
  const plane = anchor + sign * (half + 0.03);
  const point = aimOnPlane(game, axis, plane) || { x: hit.point.x, y: hit.point.y, z: hit.point.z };
  const uv = planeUV(point, axis);
  const materialName = host.userData.materialName;
  const rect = !!(game.input.keys.ControlLeft || game.input.keys.ControlRight);
  game.paint = {
    axis,
    anchor,
    plane,
    sign,
    rect,
    origin: uv,
    materialName,
    points: [uv],
  };
  if (game.paintPreview) game.paintPreview.visible = false;
  redrawStroke(game, portalHex(game.portalMaterial));
}

function rectangleLoop(origin, current) {
  const corners = [
    { u: origin.u, v: origin.v },
    { u: current.u, v: origin.v },
    { u: current.u, v: current.v },
    { u: origin.u, v: current.v },
  ];
  const points = [];
  const samples = 8;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    for (let s = 0; s < samples; s += 1) {
      const t = s / samples;
      points.push({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return points;
}

export function updatePaint(game) {
  if (game.strokeErrorUntil && performance.now() > game.strokeErrorUntil && game.stroke && !game.paint) {
    game.stroke.visible = false;
    game.strokeErrorUntil = 0;
  }
  if (!game.paint) return;
  const point = aimOnPlane(game, game.paint.axis, game.paint.plane);
  if (!point) return;
  const uv = planeUV(point, game.paint.axis);
  if (game.paint.rect) {
    game.paint.points = rectangleLoop(game.paint.origin, uv);
    redrawStroke(game, portalHex(game.portalMaterial));
    return;
  }
  const last = game.paint.points[game.paint.points.length - 1];
  if (uvDist(last, uv) < 0.05) return;
  game.paint.points.push(uv);
  if (game.paint.points.length > 700) game.paint.points.shift();
  redrawStroke(game, portalHex(game.portalMaterial));
}

export function pointInPoly(point, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i += 1) {
    const a = poly[i];
    const b = poly[j];
    const hit = (a.v > point.v) !== (b.v > point.v)
      && point.u < ((b.u - a.u) * (point.v - a.v)) / ((b.v - a.v) || 1e-9) + a.u;
    if (hit) inside = !inside;
  }
  return inside;
}

function rectsTouch(a, b) {
  const eps = 0.08;
  const uOverlap = a.minU < b.maxU - eps && a.maxU > b.minU + eps;
  const vOverlap = a.minV < b.maxV - eps && a.maxV > b.minV + eps;
  const uTouch = Math.abs(a.maxU - b.minU) < eps || Math.abs(b.maxU - a.minU) < eps;
  const vTouch = Math.abs(a.maxV - b.minV) < eps || Math.abs(b.maxV - a.minV) < eps;
  return (uTouch && vOverlap) || (vTouch && uOverlap);
}

function groupAdjacent(hosts) {
  const left = hosts.slice();
  const groups = [];
  while (left.length) {
    const group = [left.pop()];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = left.length - 1; i >= 0; i -= 1) {
        const host = left[i];
        if (host.userData.materialName !== group[0].userData.materialName) continue;
        const rect = host.userData.paintRect || panelRect(host);
        const touch = group.some((other) => rectsTouch(rect, other.userData.paintRect || panelRect(other)));
        if (!touch) continue;
        group.push(host);
        left.splice(i, 1);
        grew = true;
      }
    }
    groups.push(group);
  }
  return groups;
}

function rectsOutline(rects) {
  const q = (n) => Math.round(n * 500) / 500;
  const key = (x1, y1, x2, y2) => `${q(x1)},${q(y1)},${q(x2)},${q(y2)}`;
  const count = new Map();
  const add = (x1, y1, x2, y2) => {
    const forward = key(x1, y1, x2, y2);
    const back = key(x2, y2, x1, y1);
    if (count.has(back)) {
      count.set(back, count.get(back) - 1);
      if (count.get(back) <= 0) count.delete(back);
    } else count.set(forward, (count.get(forward) || 0) + 1);
  };
  for (const rect of rects) {
    add(rect.minU, rect.minV, rect.maxU, rect.minV);
    add(rect.maxU, rect.minV, rect.maxU, rect.maxV);
    add(rect.maxU, rect.maxV, rect.minU, rect.maxV);
    add(rect.minU, rect.maxV, rect.minU, rect.minV);
  }
  const unused = [];
  for (const [id, n] of count) {
    if (n <= 0) continue;
    const [a, b, c, d] = id.split(',').map(Number);
    unused.push({ a, b, c, d });
  }
  const loops = [];
  while (unused.length) {
    const first = unused.pop();
    const loop = [{ u: first.a, v: first.b }];
    let cu = first.c;
    let cv = first.d;
    let guard = 0;
    while (guard < 800) {
      loop.push({ u: cu, v: cv });
      if (Math.abs(cu - first.a) < 0.004 && Math.abs(cv - first.b) < 0.004) break;
      const idx = unused.findIndex((edge) => Math.abs(edge.a - cu) < 0.004 && Math.abs(edge.b - cv) < 0.004);
      if (idx < 0) break;
      const edge = unused.splice(idx, 1)[0];
      cu = edge.c;
      cv = edge.d;
      guard += 1;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  loops.sort((a, b) => Math.abs(shoelace(b)) - Math.abs(shoelace(a)));
  const outer = loops[0];
  if (outer && shoelace(outer) < 0) outer.reverse();
  return outer || null;
}

function gridLoops(polys, cell) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const poly of polys) {
    for (const point of poly) {
      minU = Math.min(minU, point.u);
      maxU = Math.max(maxU, point.u);
      minV = Math.min(minV, point.v);
      maxV = Math.max(maxV, point.v);
    }
  }
  if (!Number.isFinite(minU)) return [];
  minU -= cell;
  minV -= cell;
  maxU += cell;
  maxV += cell;
  const cols = Math.max(1, Math.ceil((maxU - minU) / cell));
  const rows = Math.max(1, Math.ceil((maxV - minV) / cell));
  if (cols * rows > 24000) return polys.map((poly) => poly.slice());
  const grid = [];
  for (let y = 0; y < rows; y += 1) {
    const row = [];
    const v = minV + (y + 0.5) * cell;
    for (let x = 0; x < cols; x += 1) {
      const u = minU + (x + 0.5) * cell;
      row.push(polys.some((poly) => pointInPoly({ u, v }, poly)));
    }
    grid.push(row);
  }
  const edges = [];
  const add = (x1, y1, x2, y2) => edges.push([x1, y1, x2, y2]);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!grid[y][x]) continue;
      if (y === 0 || !grid[y - 1][x]) add(x + 1, y, x, y);
      if (y === rows - 1 || !grid[y + 1][x]) add(x, y + 1, x + 1, y + 1);
      if (x === 0 || !grid[y][x - 1]) add(x, y, x, y + 1);
      if (x === cols - 1 || !grid[y][x + 1]) add(x + 1, y + 1, x + 1, y);
    }
  }
  const key = (x, y) => `${x},${y}`;
  const from = new Map();
  for (const edge of edges) {
    const id = key(edge[0], edge[1]);
    if (!from.has(id)) from.set(id, []);
    from.get(id).push(edge);
  }
  const used = new Set();
  const edgeId = (edge) => `${edge[0]},${edge[1]}>${edge[2]},${edge[3]}`;
  const loops = [];
  for (const edge of edges) {
    if (used.has(edgeId(edge))) continue;
    const loop = [];
    let cur = edge;
    for (let n = 0; n < edges.length + 2; n += 1) {
      const id = edgeId(cur);
      if (used.has(id)) break;
      used.add(id);
      loop.push({ u: minU + cur[0] * cell, v: minV + cur[1] * cell });
      const nexts = from.get(key(cur[2], cur[3])) || [];
      const nxt = nexts.find((item) => !used.has(edgeId(item)));
      if (!nxt) break;
      cur = nxt;
    }
    const cleaned = [];
    for (const point of loop) {
      const last = cleaned[cleaned.length - 1];
      if (last && Math.hypot(last.u - point.u, last.v - point.v) < cell * 0.4) continue;
      cleaned.push(point);
    }
    if (cleaned.length >= 4) loops.push(cleaned);
  }
  return loops.sort((a, b) => Math.abs(shoelace(b)) - Math.abs(shoelace(a)));
}

function extrudeOutline(game, outer, holes, thickness) {
  const ring = outer.slice();
  if (shoelace(ring) < 0) ring.reverse();
  const shape = new game.THREE.Shape();
  shape.moveTo(ring[0].u, ring[0].v);
  for (let i = 1; i < ring.length; i += 1) {
    const point = ring[i];
    if (Math.abs(point.u - ring[0].u) < 0.0001 && Math.abs(point.v - ring[0].v) < 0.0001) continue;
    shape.lineTo(point.u, point.v);
  }
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    const pts = hole.slice();
    if (shoelace(pts) > 0) pts.reverse();
    const path = new game.THREE.Path();
    path.moveTo(pts[0].u, pts[0].v);
    for (let i = 1; i < pts.length; i += 1) path.lineTo(pts[i].u, pts[i].v);
    shape.holes.push(path);
  }
  const geo = new game.THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.translate(0, 0, -thickness * 0.5);
  return assertExtrude(geo);
}

function flatShape(game, points) {
  const ring = points.slice();
  if (shoelace(ring) < 0) ring.reverse();
  const shape = new game.THREE.Shape();
  shape.moveTo(ring[0].u, ring[0].v);
  for (let i = 1; i < ring.length; i += 1) shape.lineTo(ring[i].u, ring[i].v);
  return new game.THREE.ShapeGeometry(shape);
}

function dropRemainder(game, host) {
  const mesh = host.userData.remainder;
  if (!mesh || mesh.userData.removed) {
    host.userData.remainder = null;
    return;
  }
  mesh.userData.removed = true;
  game.scene.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
  const index = game.surfaces.indexOf(mesh);
  if (index >= 0) game.surfaces.splice(index, 1);
  host.userData.remainder = null;
}

function retireStamp(game, mesh) {
  if (!mesh || mesh.userData.retired) return;
  mesh.userData.retired = true;
  killMesh(mesh);
  game.scene.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
  const index = game.surfaces.indexOf(mesh);
  if (index >= 0) game.surfaces.splice(index, 1);
  for (const host of mesh.userData.hosts || []) {
    if (!host.userData.stamps) continue;
    host.userData.stamps = host.userData.stamps.filter((stamp) => stamp !== mesh);
  }
}

export function commitPaint(game) {
  const paint = game.paint;
  game.paint = null;
  if (game.paintPreview) game.paintPreview.visible = false;
  if (!paint || game.phase !== 'action') return;
  const materialName = game.portalMaterial;
  if (!game.mats[materialName] || materialName === game.bannedMaterial) {
    failStroke(game);
    return;
  }
  const points = dedupeRing(paint.points);
  if (!strokeClosed(points)) {
    failStroke(game);
    return;
  }
  if (shoelace(points) < 0) points.reverse();
  const seen = new Set();
  const stamped = [];
  let applied = 0;
  for (const mesh of game.paintMask) {
    const host = mesh.userData.source || mesh;
    if (seen.has(host) || host.userData.destroyed) continue;
    if ((host.userData.axis || 'y') !== paint.axis) continue;
    if (Math.abs(host.position[paint.axis] - paint.anchor) > 0.15) continue;
    if (paint.materialName && host.userData.materialName !== paint.materialName) continue;
    seen.add(host);
    const rect = host.userData.paintRect || panelRect(host);
    const clipped = dedupeRing(clipToRect(points, rect));
    if (clipped.length < 3 || Math.abs(shoelace(clipped)) < 0.08) continue;
    if (shoelace(clipped) < 0) clipped.reverse();
    const area = Math.abs(shoelace(clipped));
    stamped.push({ host, clipped, rect, area });
    applied += area;
  }
  if (!stamped.length) {
    failStroke(game);
    return;
  }
  const cost = +applied.toFixed(2);
  const have = game.stock[materialName] || 0;
  if (have < cost - 0.001) {
    failStroke(game);
    return;
  }
  const thickness = Math.max(0.08, panelThickness(stamped[0].host));
  const stampLoops = gridLoops(stamped.map((item) => item.clipped), 0.03).filter((loop) => Math.abs(shoelace(loop)) > 0.08);
  if (!stampLoops.length) {
    failStroke(game);
    return;
  }
  const groups = [];
  const grouped = new Set();
  for (const item of stamped) {
    if (grouped.has(item.host)) continue;
    const group = [item.host];
    grouped.add(item.host);
    let grew = true;
    while (grew) {
      grew = false;
      for (const other of stamped) {
        if (grouped.has(other.host)) continue;
        if (other.host.userData.materialName !== group[0].userData.materialName) continue;
        const rect = other.rect;
        if (!group.some((host) => rectsTouch(rect, host.userData.paintRect || panelRect(host)))) continue;
        grouped.add(other.host);
        group.push(other.host);
        grew = true;
      }
    }
    groups.push(group);
  }
  const built = [];
  let shapes = [];
  try {
    for (const group of groups) {
      const holes = [];
      for (const host of group) {
        const item = stamped.find((entry) => entry.host === host);
        const rect = item ? item.rect : (host.userData.paintRect || panelRect(host));
        host.userData.paintRect = rect;
        if (item) holes.push(seatHole(item.clipped, rect));
        for (const hole of host.userData.holes || []) holes.push(hole);
      }
      const outline = rectsOutline(group.map((host) => host.userData.paintRect));
      const merged = gridLoops(holes, 0.03).filter((loop) => Math.abs(shoelace(loop)) > 0.05);
      const geo = extrudeOutline(game, outline, merged, thickness);
      built.push({ group, geo, holes });
    }
    let polys = stampLoops.slice();
    const eaten = [];
    for (const item of stamped) {
      for (const stamp of item.host.userData.stamps || []) {
        if (!stamp || stamp.userData.destroyed || stamp.userData.retired) continue;
        if (stamp.userData.materialName !== materialName || eaten.includes(stamp)) continue;
        const region = stamp.userData.region && stamp.userData.region.points;
        if (!region) continue;
        if (polys.some((poly) => poly.some((point) => pointInPoly(point, region)) || region.some((point) => pointInPoly(point, poly)))) {
          polys.push(region);
          eaten.push(stamp);
        }
      }
    }
    shapes = eaten.length ? gridLoops(polys, 0.03).filter((loop) => Math.abs(shoelace(loop)) > 0.08) : polys;
    if (!shapes.length) throw new Error('stamp');
    for (const stamp of eaten) retireStamp(game, stamp);
  } catch (err) {
    for (const item of built) item.geo.dispose();
    failStroke(game);
    return;
  }
  game.stock[materialName] = Math.round((have - cost) * 100) / 100;
  for (const item of built) {
    for (const host of item.group) dropRemainder(game, host);
    game.geometries.push(item.geo);
    const mesh = new game.THREE.Mesh(item.geo, item.group[0].material);
    const axis = item.group[0].userData.axis || 'y';
    orientToPlane(game, mesh, axis, item.group[0].position[axis]);
    mesh.frustumCulled = false;
    mesh.userData = {
      w: item.group[0].userData.w,
      h: item.group[0].userData.h,
      d: item.group[0].userData.d,
      axis,
      kind: item.group[0].userData.kind,
      paintable: true,
      skinnable: true,
      materialName: item.group[0].userData.materialName,
      initialMaterial: item.group[0].userData.initialMaterial,
      solid: true,
      transparent: !!item.group[0].userData.transparent,
      penetrable: !!item.group[0].userData.penetrable,
      visualOnly: true,
      structural: true,
      shape: true,
      source: item.group[0],
      center: {
        x: item.group[0].position.x,
        y: item.group[0].position.y,
        z: item.group[0].position.z,
      },
    };
    game.scene.add(mesh);
    game.surfaces.push(mesh);
    for (const host of item.group) {
      const own = stamped.find((entry) => entry.host === host);
      if (own) {
        if (!host.userData.holes) host.userData.holes = [];
        host.userData.holes.push(seatHole(own.clipped, own.rect));
      }
      host.userData.remainder = mesh;
      host.visible = false;
      host.userData.skipBullets = true;
    }
  }
  for (const loop of shapes) {
    const geo = flatShape(game, loop);
    game.geometries.push(geo);
    const stamp = attachStamp(game, stamped[0].host, loop, materialName, thickness, paint.sign, geo);
    stamp.userData.hosts = stamped.map((item) => item.host);
    for (let i = 1; i < stamped.length; i += 1) {
      if (!stamped[i].host.userData.stamps) stamped[i].host.userData.stamps = [];
      stamped[i].host.userData.stamps.push(stamp);
    }
  }
  if (game.stroke) game.stroke.visible = false;
  rebuildMasks(game);
  game.sfx.reskin();
  game.onHud?.();
}

function failStroke(game) {
  if (game.stroke) {
    game.stroke.material.color.setHex(0xff4d42);
    game.stroke.visible = true;
  }
  game.strokeErrorUntil = performance.now() + 700;
  game.sfx?.error?.();
}

export function cancelPaint(game) {
  game.paint = null;
  if (game.paintPreview) game.paintPreview.visible = false;
  if (game.stroke) game.stroke.visible = false;
}

export function swingMelee(game, now) {
  if (!game.view || game.view.swing > 0.08) return;
  if (now - (game.lastMelee || 0) < 460) return;
  game.lastMelee = now || performance.now();
  game.view.swing = 1;
  game.sfx.swipe();
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const ray = game.raycaster;
  ray.set(game._o, game._d);
  ray.far = 2.4;
  const hits = ray.intersectObjects(game.bulletMask, false);
  let cut = false;
  for (let i = 0; i < hits.length; i += 1) {
    const data = hits[i].object.userData;
    if (data.solid === false) continue;
    const canCut = data.paintable && data.materialName === 'glass';
    if (canCut) {
      destroySurface(hits[i].object, game);
      cut = true;
      continue;
    }
    break;
  }
  if (cut) {
    rebuildMasks(game);
    game.sfx.hit();
  }
}

function attachFuse(game, parent) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const tex = new game.THREE.CanvasTexture(canvas);
  const mat = new game.THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  game.materialDisposables.push(mat);
  const sprite = new game.THREE.Sprite(mat);
  sprite.position.set(0, 0.32, 0);
  sprite.scale.set(0.46, 0.46, 1);
  sprite.raycast = () => {};
  parent.add(sprite);
  const draw = (n) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = n <= 2 ? '#ff3b2e' : '#ffd7a1';
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a100c';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 32, 34);
    tex.needsUpdate = true;
  };
  draw(5);
  return draw;
}

export function useUtility(game) {
  if (game.phase !== 'action' || game.player.hp <= 0) return;
  if (!game.charges) game.charges = [];
  if (game.charges.length >= 2) return;
  if (game.view) {
    game.view.throwing = 1;
    game.view.pulse = 1;
  }
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  if (!game.chargeGeo) {
    game.chargeGeo = new game.THREE.BoxGeometry(0.22, 0.14, 0.1);
    game.geometries.push(game.chargeGeo);
  }
  const mesh = new game.THREE.Mesh(game.chargeGeo, game.mats.charge);
  mesh.raycast = () => {};
  const draw = attachFuse(game, mesh);
  const x = game._o.x + game._d.x * 0.7;
  const y = game._o.y + game._d.y * 0.7 - 0.15;
  const z = game._o.z + game._d.z * 0.7;
  mesh.position.set(x, y, z);
  game.scene.add(mesh);
  game.charges.push({
    mesh,
    draw,
    shown: 5,
    fuse: 5,
    mode: game.bombMode === 'roll' ? 'roll' : 'stick',
    flying: true,
    x,
    y,
    z,
    vx: game._d.x * 11,
    vy: game._d.y * 11 + 4.2,
    vz: game._d.z * 11,
  });
  game.sfx.swipe();
}

function chargeHits(game, x, y, z) {
  const box = {
    minX: x - 0.12, maxX: x + 0.12,
    minY: y - 0.1, maxY: y + 0.1,
    minZ: z - 0.12, maxZ: z + 0.12,
  };
  for (const mesh of game.moveMask) {
    if (mesh.userData.solid === false) continue;
    const bounds = meshBox(mesh);
    if (box.minX < bounds.maxX && box.maxX > bounds.minX
      && box.minY < bounds.maxY && box.maxY > bounds.minY
      && box.minZ < bounds.maxZ && box.maxZ > bounds.minZ) return true;
  }
  return y < 0.12;
}

function stickCharge(charge, x, y, z) {
  charge.flying = false;
  charge.vx = 0;
  charge.vy = 0;
  charge.vz = 0;
  charge.x = x;
  charge.y = Math.max(0.16, y);
  charge.z = z;
  charge.mesh.position.set(charge.x, charge.y, charge.z);
  charge.mesh.rotation.set(0, charge.mesh.rotation.y, 0);
}

function clearBlast(game, blast) {
  game.scene.remove(blast.mesh);
  game.scene.remove(blast.ring);
  game.scene.remove(blast.light);
  for (const spark of blast.sparks) game.scene.remove(spark.mesh);
  blast.mesh.geometry.dispose();
  blast.ring.geometry.dispose();
  blast.mesh.material.dispose();
  blast.ring.material.dispose();
}

function updateBlasts(game, dt) {
  if (!game.blasts || !game.blasts.length) return;
  for (let i = game.blasts.length - 1; i >= 0; i -= 1) {
    const blast = game.blasts[i];
    blast.life -= dt;
    const t = 1 - Math.max(0, blast.life) / blast.max;
    const scale = 0.35 + t * 3.5;
    blast.mesh.scale.setScalar(scale);
    blast.mesh.material.opacity = 0.85 * (1 - t);
    blast.ring.scale.setScalar(0.4 + t * 4.2);
    blast.ring.material.opacity = 0.7 * (1 - t);
    blast.light.intensity = 6 * (1 - t);
    for (const spark of blast.sparks) {
      spark.vx *= 0.96;
      spark.vy -= 9 * dt;
      spark.vz *= 0.96;
      spark.mesh.position.x += spark.vx * dt;
      spark.mesh.position.y += spark.vy * dt;
      spark.mesh.position.z += spark.vz * dt;
    }
    if (blast.life <= 0) {
      clearBlast(game, blast);
      game.blasts.splice(i, 1);
    }
  }
}

function spawnBlast(game, x, y, z) {
  const THREE = game.THREE;
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffb15a,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(0.3);
  mesh.raycast = () => {};
  game.scene.add(mesh);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xfff1c9,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.7, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, Math.max(0.08, y - 0.2), z);
  ring.raycast = () => {};
  game.scene.add(ring);
  const light = new THREE.PointLight(0xff8a3a, 6, 16);
  light.position.set(x, y + 0.4, z);
  game.scene.add(light);
  if (!game.sparkGeo) {
    game.sparkGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    game.geometries.push(game.sparkGeo);
  }
  const sparks = [];
  for (let i = 0; i < 12; i += 1) {
    const spark = new THREE.Mesh(game.sparkGeo, mat);
    spark.position.set(x, y, z);
    spark.raycast = () => {};
    game.scene.add(spark);
    const yaw = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 6;
    sparks.push({
      mesh: spark,
      vx: Math.cos(yaw) * speed,
      vy: 2 + Math.random() * 6,
      vz: Math.sin(yaw) * speed,
    });
  }
  if (!game.blasts) game.blasts = [];
  game.blasts.push({ mesh, ring, light, sparks, life: 0.48, max: 0.48 });
}

export function updateBombs(game, dt) {
  updateBlasts(game, dt);
  if (!game.charges || !game.charges.length) return;
  for (let i = game.charges.length - 1; i >= 0; i -= 1) {
    const charge = game.charges[i];
    charge.fuse -= dt;
    if (charge.flying) {
      charge.vy -= 14 * dt;
      let nx = charge.x + charge.vx * dt;
      let ny = charge.y + charge.vy * dt;
      let nz = charge.z + charge.vz * dt;
      if (charge.mode === 'roll') {
        if (chargeHits(game, nx, charge.y, charge.z)) {
          charge.vx *= -0.4;
          nx = charge.x;
        }
        if (ny < 0.16 || chargeHits(game, charge.x, ny, charge.z)) {
          ny = Math.max(0.16, charge.y);
          charge.vy = charge.vy < -1.4 ? -charge.vy * 0.32 : 0;
          charge.vx *= 0.9;
          charge.vz *= 0.9;
        }
        if (chargeHits(game, charge.x, charge.y, nz)) {
          charge.vz *= -0.4;
          nz = charge.z;
        }
        charge.mesh.rotation.z += charge.vx * dt * 3;
        charge.mesh.rotation.x += charge.vz * dt * 3;
      } else if (chargeHits(game, nx, ny, nz)) {
        stickCharge(charge, nx, ny, nz);
        nx = charge.x;
        ny = charge.y;
        nz = charge.z;
      } else {
        charge.mesh.rotation.x += dt * 8;
        charge.mesh.rotation.z += dt * 5;
      }
      charge.x = nx;
      charge.y = ny;
      charge.z = nz;
      charge.mesh.position.set(nx, ny, nz);
    }
    const shown = Math.max(0, Math.ceil(charge.fuse));
    if (shown !== charge.shown) {
      charge.shown = shown;
      charge.draw?.(shown);
    }
    const blink = charge.fuse < 2 ? 22 : 8;
    charge.mesh.material = Math.sin(charge.fuse * blink) > 0 ? game.mats.charge : game.mats.chargeDim;
    if (charge.fuse <= 0) {
      game.scene.remove(charge.mesh);
      game.charges.splice(i, 1);
      detonate(game, charge);
    }
  }
}

function blastReaches(mesh, x, y, z, radius) {
  const bounds = mesh.userData.stamp ? null : meshBox(mesh);
  if (!bounds || !Number.isFinite(bounds.minX)) {
    const center = mesh.userData.center || mesh.position;
    const dx = center.x - x;
    const dy = center.y - y;
    const dz = center.z - z;
    return dx * dx + dy * dy + dz * dz <= radius * radius;
  }
  const cx = Math.max(bounds.minX, Math.min(x, bounds.maxX));
  const cy = Math.max(bounds.minY, Math.min(y, bounds.maxY));
  const cz = Math.max(bounds.minZ, Math.min(z, bounds.maxZ));
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

function detonate(game, charge) {
  const radius = 3.6;
  spawnBlast(game, charge.x, charge.y, charge.z);
  let changed = false;
  for (const mesh of game.paintMask || []) {
    if (!blastReaches(mesh, charge.x, charge.y, charge.z, radius)) continue;
    const name = mesh.userData.materialName;
    if (name === 'glass') {
      destroySurface(mesh, game);
      changed = true;
    } else if (name === 'wood' && Math.random() < 0.6) {
      destroySurface(mesh, game);
      changed = true;
    }
  }
  if (changed) rebuildMasks(game);
  game.sfx.blast();
  if (game.view) game.view.kick = 1;
  const px = game.player.x - charge.x;
  const py = game.player.feetY + 1 - charge.y;
  const pz = game.player.z - charge.z;
  const dist = Math.hypot(px, py, pz);
  if (dist < radius && dist > 0.05 && game.phase === 'action') {
    damagePlayer(game, 18, 'Bomb');
    game.player.vx += (px / dist) * 8;
    game.player.vz += (pz / dist) * 8;
    game.player.vy = Math.max(game.player.vy, 4);
  }
}

export function installChip(game) {
  if (game.hackingChips <= 0 || game.faction !== 'atlas' || game.uplinkEndsAt) return;
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const hit = firstSolid(game, game._o, game._d, 3.2, undefined, true, true);
  if (!hit || !hit.object.userData.uplink || hit.object.userData.hacked) return;
  game.hackingChips -= 1;
  hit.object.userData.hacked = true;
  hit.object.material = game.mats.hacked;
  game.uplinkEndsAt = performance.now() + 30000;
  game.holdSent = 30;
  game.onHold?.(30);
  game.sfx.reskin();
  game.emit('game:killfeed', { text: `${game.playerName} armed the uplink — hold 30s` });
  game.onHud?.();
  if (game.mode === 'hack') game.setWeapon?.('rifle');
}

function firstSolid(game, origin, direction, far, ignoreBotIndex, skipFloors, skipGlass) {
  const ray = game.raycaster;
  ray.set(origin, direction);
  ray.far = far;
  const hits = ray.intersectObjects(game.bulletMask, false);
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const data = hit.object.userData;
    if (data.type === 'bot' && data.botIndex === ignoreBotIndex) continue;
    if (skipFloors && data.kind === 'floor') continue;
    if (data.solid === false) continue;
    if (skipGlass && data.materialName === 'glass') continue;
    return hit;
  }
  return null;
}

export function unskinAimed(game) {
  const hit = skinPick(game);
  if (!hit || !hit.object.userData.skinnable) return;
  if (!game.mats[hit.object.userData.materialName]) return;
}

export function reskinAimed(game) {
  const hit = skinPick(game);
  if (!hit || !hit.object.userData.skinnable || !game.inventory.length) return;
  const count = game.inventory.length;
  const index = ((game.slotIndex % count) + count) % count;
  const name = game.inventory[index];
  if (!name || name === game.bannedMaterial || !game.mats[name]) return;
  if (hit.object.userData.materialName === name) return;
  game.inventory.splice(index, 1);
  game.slotIndex = game.inventory.length ? Math.min(index, game.inventory.length - 1) : 0;
  setSurfaceMaterial(game, hit.object, name);
  emitInventory(game);
  game.sfx.reskin();
}

function killBot(game, bot) {
  if (bot.state === 'dead') return;
  bot.state = 'dead';
  bot.hp = 0;
  bot.body.visible = false;
  bot.head.visible = false;
  rebuildMasks(game);
  game.emit('game:killfeed', { text: `${game.playerName} eliminated ${bot.name}` });
}

function spawnTracer(game, origin, direction, distance, enemy) {
  if (!game.tracers) {
    game.tracers = [];
    const geo = new game.THREE.BoxGeometry(0.04, 0.04, 0.9);
    const mat = new game.THREE.MeshBasicMaterial({ color: 0xffe39a });
    const enemyMat = new game.THREE.MeshBasicMaterial({ color: 0xff3b2e });
    game.geometries.push(geo);
    game.materialDisposables.push(mat, enemyMat);
    game.tracerGeo = geo;
    game.tracerMat = mat;
    game.tracerEnemyMat = enemyMat;
  }
  let mesh = null;
  for (const item of game.tracers) {
    if (!item.userData.live) {
      mesh = item;
      break;
    }
  }
  if (!mesh) {
    mesh = new game.THREE.Mesh(game.tracerGeo, enemy ? game.tracerEnemyMat : game.tracerMat);
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    game.scene.add(mesh);
    game.tracers.push(mesh);
  }
  mesh.material = enemy ? game.tracerEnemyMat : game.tracerMat;
  const ox = origin.x + direction.x * 0.35;
  const oy = origin.y + direction.y * 0.35 - (enemy ? 0 : 0.12);
  const oz = origin.z + direction.z * 0.35;
  mesh.position.set(ox, oy, oz);
  mesh.lookAt(ox + direction.x, oy + direction.y, oz + direction.z);
  mesh.visible = true;
  mesh.userData.live = true;
  mesh.userData.vx = direction.x * 78;
  mesh.userData.vy = direction.y * 78;
  mesh.userData.vz = direction.z * 78;
  mesh.userData.life = Math.max(0.06, Math.min(distance, 40) / 78);
}

export function updateTracers(game, dt) {
  if (!game.tracers) return;
  for (const mesh of game.tracers) {
    if (!mesh.userData.live) continue;
    mesh.userData.life -= dt;
    if (mesh.userData.life <= 0) {
      mesh.userData.live = false;
      mesh.visible = false;
      continue;
    }
    mesh.position.x += mesh.userData.vx * dt;
    mesh.position.y += mesh.userData.vy * dt;
    mesh.position.z += mesh.userData.vz * dt;
  }
}

function fireRifle(game, now) {
  if (!game.input.firing || (game.mode !== 'rifle' && game.mode !== 'weapon')) return;
  if (document.pointerLockElement !== game.canvas) return;
  if (now - game.lastShot < RIFLE_INTERVAL_MS) return;
  game.lastShot = now;
  game.sfx.shot();
  if (game.view) {
    game.view.muzzle = 0.045;
    game.view.kick = 1;
  }

  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const shot = resolveBullet(game, game._o, game._d, RIFLE_RANGE);
  const travel = shot.hit ? shot.hit.distance : 28;
  spawnTracer(game, game._o, game._d, travel, false);
  const hit = shot.hit;
  if (!hit) return;

  const data = hit.object.userData;
  if (data.materialName === 'rubber' && hit.face) {
    const n = game._n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    game.player.vx += n.x * 11;
    game.player.vz += n.z * 11;
    game.player.vy = Math.max(game.player.vy, 3.2);
  }
  if (data.type !== 'bot') return;

  const bot = game.bots[data.botIndex];
  if (!bot || !bot.active || bot.state === 'dead') return;
  const base = data.part === 'head' ? HEAD_DAMAGE : BODY_DAMAGE;
  bot.hp -= Math.max(1, Math.round(base * shot.scale));
  game.sfx.hit();
  if (bot.hp <= 0) killBot(game, bot);
}

function damagePlayer(game, amount, sourceName) {
  if (game.phase !== 'action' || game.player.hp <= 0) return;
  game.player.hp = Math.max(0, game.player.hp - amount);
  game.emit('game:health', { hp: game.player.hp });
  if (game.player.hp <= 0) {
    game.emit('game:killfeed', { text: `${sourceName} eliminated ${game.playerName}` });
  }
}

function seesPlayer(game, bot) {
  const origin = game._o.set(bot.x, 1.35, bot.z);
  const dir = game._d.set(
    game.player.x - bot.x,
    game.player.feetY + 1.15 - 1.35,
    game.player.z - bot.z,
  );
  const dist = dir.length();
  if (dist < 0.8) return true;
  dir.multiplyScalar(1 / dist);
  origin.addScaledVector(dir, 0.55);
  const hit = firstSolid(game, origin, dir, dist - 0.55, bot.index, true, true);
  return !hit;
}

function botBox(x, z) {
  return {
    minX: x - 0.32,
    maxX: x + 0.32,
    minY: 0.2,
    maxY: 1.5,
    minZ: z - 0.32,
    maxZ: z + 0.32,
  };
}

function occupied(game, x, z, self) {
  const box = botBox(x, z);
  for (const mesh of game.moveMask) {
    if (mesh === self.body || mesh.userData.kind === 'floor' || mesh.userData.solid === false) continue;
    if (overlap(box, meshBox(mesh))) return true;
  }
  const dx = x - game.player.x;
  const dz = z - game.player.z;
  return dx * dx + dz * dz < 0.72 * 0.72;
}

function moveBot(game, bot, dt, now) {
  const dx = game.player.x - bot.x;
  const dz = game.player.z - bot.z;
  const len = Math.hypot(dx, dz) || 1;
  let mx = dx / len;
  let mz = dz / len;
  if (now < bot.strafeUntil) {
    mx = -mz * bot.strafe;
    mz = dx / len * bot.strafe;
  }
  const step = BOT_SPEED * dt;
  const nx = bot.x + mx * step;
  const nz = bot.z + mz * step;
  if (!occupied(game, nx, nz, bot)) {
    bot.x = nx;
    bot.z = nz;
    return;
  }
  if (!occupied(game, nx, bot.z, bot)) {
    bot.x = nx;
    return;
  }
  if (!occupied(game, bot.x, nz, bot)) {
    bot.z = nz;
    return;
  }
  if (now >= bot.strafeUntil) {
    bot.strafe = Math.random() < 0.5 ? -1 : 1;
    bot.strafeUntil = now + 0.45;
  }
}

function botShoot(game, bot, now) {
  if (now < bot.nextShot || game.player.hp <= 0) return;
  bot.nextShot = now + BOT_SHOT_MS;
  const accurate = Math.random() < BOT_HIT_CHANCE;
  const origin = game._o.set(bot.x, 1.35, bot.z);
  const dir = game._d.set(
    game.player.x - bot.x,
    game.player.feetY + 1.1 - 1.35,
    game.player.z - bot.z,
  );
  if (dir.lengthSq() < 0.0001) return;
  dir.normalize();
  if (!accurate) {
    dir.x += (Math.random() - 0.5) * 0.7;
    dir.y += (Math.random() - 0.5) * 0.35;
    dir.z += (Math.random() - 0.5) * 0.7;
    dir.normalize();
  }
  origin.addScaledVector(dir, 0.55);
  const reach = Math.hypot(game.player.x - origin.x, game.player.feetY + 1.1 - origin.y, game.player.z - origin.z);
  game.sfx.shot(0.018);
  const shot = resolveBullet(game, origin, dir, Math.max(0.4, reach));
  const travel = shot.hit ? Math.min(shot.hit.distance, reach) : reach;
  spawnTracer(game, origin, dir, travel, true);
  if (!accurate || shot.hit) return;
  damagePlayer(game, Math.max(1, Math.round(BOT_DAMAGE * shot.scale)), bot.name);
}

function commitBot(bot, player) {
  bot.body.position.set(bot.x, 0.725, bot.z);
  bot.body.lookAt(player.x, 0.725, player.z);
}

function updateBot(game, bot, dt, now) {
  if (!bot.active || bot.state === 'dead') return;
  const dist = Math.hypot(game.player.x - bot.x, game.player.z - bot.z);
  const los = dist < LOSE_RANGE && seesPlayer(game, bot);

  if (bot.state === 'dead') return;
  if (bot.state === 'attack') {
    if (dist > DROP_ATTACK_RANGE || !los) bot.state = 'chase';
  } else if (dist <= ATTACK_RANGE && los) {
    bot.state = 'attack';
  } else if (dist <= CHASE_RANGE) {
    bot.state = 'chase';
  } else if (dist > LOSE_RANGE) {
    bot.state = 'idle';
  }

  if (bot.state === 'chase') moveBot(game, bot, dt, now);
  commitBot(bot, game.player);
  if (bot.state === 'attack') botShoot(game, bot, now);
}

function tacticalReskin(game) {
  const bots = game.bots.filter((bot) => bot.active && bot.state !== 'dead');
  if (!bots.length || Math.random() >= RESKIN_CHANCE) return;
  const bot = bots[Math.floor(Math.random() * bots.length)];
  const nearby = game.surfaces.filter((mesh) => {
    const dx = mesh.position.x - bot.x;
    const dy = mesh.position.y - 1.2;
    const dz = mesh.position.z - bot.z;
    return dx * dx + dy * dy + dz * dz < 64;
  });
  if (!nearby.length) return;
  const mesh = nearby[Math.floor(Math.random() * nearby.length)];
  const options = ['titanium', 'glass', 'rubber'].filter((name) => name !== game.bannedMaterial);
  const name = options[Math.floor(Math.random() * options.length)];
  setSurfaceMaterial(game, mesh, name);
}

export function updateCombat(game, dt, now) {
  game.scene.updateMatrixWorld(true);
  fireRifle(game, now);
}

export function createBots(game) {
  const { THREE, scene } = game;
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xb4232a });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xf2d2cb });
  game.materialDisposables.push(bodyMat, headMat);
  const bodyGeo = new THREE.BoxGeometry(0.62, 1.45, 0.62);
  const headGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  game.geometries.push(bodyGeo, headGeo);
  const team = game.faction === 'atlas' ? 'Outlier' : 'Atlas';

  game.bots = [0, 1, 2].map((index) => {
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.userData = {
      w: 0.62,
      h: 1.45,
      d: 0.62,
      kind: 'bot',
      type: 'bot',
      part: 'body',
      botIndex: index,
      solid: true,
      materialName: 'bot',
      skinnable: false,
    };
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0, 0.92, 0);
    head.userData = {
      type: 'bot',
      part: 'head',
      botIndex: index,
      solid: true,
      materialName: 'bot',
      skinnable: false,
    };
    body.add(head);
    body.visible = false;
    scene.add(body);
    return {
      index,
      name: `${team} ${index + 1}`,
      active: false,
      hp: 100,
      state: 'idle',
      x: 0,
      z: 0,
      nextShot: 0,
      strafe: 1,
      strafeUntil: 0,
      body,
      head,
    };
  });
}

export function resetBots(game) {
  const count = 1 + Math.floor(Math.random() * 3);
  const anchors = game.botAnchors && game.botAnchors.length
    ? game.botAnchors
    : [{ x: 2, z: 0 }, { x: -2, z: 2 }, { x: 0, z: -4 }];
  game.bots.forEach((bot, index) => {
    const spot = anchors[index] || anchors[0];
    bot.active = index < count;
    bot.hp = 100;
    bot.state = 'idle';
    bot.x = spot.x;
    bot.z = spot.z;
    bot.nextShot = 0;
    bot.strafeUntil = 0;
    bot.body.visible = bot.active;
    bot.head.visible = bot.active;
    bot.body.position.set(bot.x, 0.725, bot.z);
    bot.body.lookAt(game.spawns[game.faction].x, 0.725, game.spawns[game.faction].z);
  });
}

export default function ActionPhase() {
  return null;
}
