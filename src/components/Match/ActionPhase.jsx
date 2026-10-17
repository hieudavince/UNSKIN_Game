import { applyMaterial, meshBox, overlap } from './PrepPhase';
import { clipStroke, resamplePolyline, ribbonTriangles } from './strokeRibbon';

import { GUNS } from '../../constants/weapons';
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
  for (const remote of game.remoteList || []) {
    if (!remote.alive) continue;
    move.push(remote.body);
    bullets.push(remote.body, remote.head);
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

export function inRegion(point, region) {
  if (!region) return false;
  const outer = Array.isArray(region) ? region : region.points;
  if (!outer || !pointInPoly(point, outer)) return false;
  const holes = Array.isArray(region) ? null : region.holes;
  return !(holes && holes.some((hole) => pointInPoly(point, hole)));
}

function liveStamps(host) {
  return (host.userData.stamps || []).filter((stamp) => (
    stamp
    && !stamp.userData.destroyed
    && !stamp.userData.retired
    && stamp.userData.materialName !== 'gone'
    && stamp.userData.region
  ));
}

function coverAt(host, point) {
  const stamps = liveStamps(host);
  for (let i = stamps.length - 1; i >= 0; i -= 1) {
    if (inRegion(point, stamps[i].userData.region)) return stamps[i];
  }
  return null;
}

export function surfaceAt(host, point) {
  const cover = coverAt(host, point);
  if (cover) return { open: false, material: cover.userData.materialName };
  const open = (host.userData.openings || []).some((region) => inRegion(point, region));
  if (open) return { open: true, material: null };
  return { open: false, material: host.userData.materialName };
}

function rebuildPassage(game, host) {
  clearHostPassage(game, host);
  const painted = (host.userData.openings && host.userData.openings.length) || liveStamps(host).length;
  if (!painted || (host.userData.axis || 'y') === 'y') {
    host.userData.noMove = false;
    return;
  }
  host.userData.noMove = true;
  const rect = host.userData.paintRect || panelRect(host);
  const axis = host.userData.axis || 'z';
  const anchor = host.position[axis];
  const thick = Math.max(0.2, panelThickness(host));
  const step = 0.1;
  const cols = Math.max(1, Math.ceil((rect.maxU - rect.minU) / step - 0.001));
  const rows = Math.max(1, Math.ceil((rect.maxV - rect.minV) / step - 0.001));
  const du = (rect.maxU - rect.minU) / cols;
  const dv = (rect.maxV - rect.minV) / rows;
  const boxes = [];
  const pushRun = (row, from, to, bounce) => {
    const u0 = rect.minU + from * du;
    const u1 = rect.minU + to * du;
    const v0 = rect.minV + row * dv;
    const cu = u1 - u0;
    const world = worldFromUV(axis, anchor, u0 + cu * 0.5, v0 + dv * 0.5);
    const size = axis === 'x' ? { w: thick, h: dv, d: cu } : { w: cu, h: dv, d: thick };
    boxes.push({
      position: world,
      userData: {
        ...size, solid: true, kind: 'wall', skipBullets: true, paintable: false, passage: true, bounce,
      },
    });
  };
  for (let row = 0; row < rows; row += 1) {
    let start = -1;
    let runBounce = false;
    for (let col = 0; col <= cols; col += 1) {
      let solid = false;
      let bounce = false;
      if (col < cols) {
        const cell = surfaceAt(host, { u: rect.minU + (col + 0.5) * du, v: rect.minV + (row + 0.5) * dv });
        solid = !cell.open;
        bounce = cell.material === 'rubber';
      }
      if (start >= 0 && (!solid || bounce !== runBounce)) {
        pushRun(row, start, col, runBounce);
        start = -1;
      }
      if (solid && start < 0) {
        start = col;
        runBounce = bounce;
      }
    }
  }
  host.userData.passage = boxes;
  if (!game.passages) game.passages = [];
  game.passages.push(...boxes);
}

function destroySurface(mesh, game) {
  if (!mesh || mesh.userData.destroyed) return;
  if (game && !game.netMute && mesh.userData.id) game.onShatter?.(mesh.userData.id);
  if (mesh.userData.stamp) {
    const region = mesh.userData.region;
    const hosts = mesh.userData.hosts || (mesh.userData.source ? [mesh.userData.source] : []);
    killMesh(mesh);
    if (game && region) {
      for (const host of hosts) {
        const rect = host.userData.paintRect || panelRect(host);
        const clipped = clipToRect(region.points, rect);
        if (clipped.length < 3) continue;
        if (!host.userData.openings) host.userData.openings = [];
        host.userData.openings.push({ points: clipped, holes: region.holes || [] });
        rebuildPassage(game, host);
      }
    }
    return;
  }
  const root = mesh.userData.source || mesh;
  if (game && root !== mesh && !game.netMute && root.userData.id) game.onShatter?.(root.userData.id);
  killMesh(root);
  killMesh(root.userData.remainder);
  for (const stamp of root.userData.stamps || []) killMesh(stamp);
  if (game) clearHostPassage(game, root);
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
    const first = meshes.find((mesh) => mesh.userData.destroyed);
    game.sfx.shatter?.(first ? first.getWorldPosition(new game.THREE.Vector3()) : null);
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
  if (name === 'rubber') return 0xff9a3c;
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

function hideStroke(game) {
  if (game.stroke) game.stroke.visible = false;
  if (game.strokeFill) game.strokeFill.visible = false;
}

function inkMaterial(game, opacity, factor) {
  return new game.THREE.MeshBasicMaterial({
    color: 0xd8fff6,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    opacity,
    side: game.THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: factor,
    polygonOffsetUnits: factor,
  });
}

function ensureStroke(game) {
  if (game.stroke) return game.stroke;
  const geo = new game.THREE.BufferGeometry();
  geo.setAttribute('position', new game.THREE.BufferAttribute(new Float32Array(9), 3));
  const mat = inkMaterial(game, 0.96, -4);
  const ribbon = new game.THREE.Mesh(geo, mat);
  ribbon.frustumCulled = false;
  ribbon.renderOrder = 6;
  ribbon.raycast = () => {};
  ribbon.visible = false;
  const fillGeo = new game.THREE.BufferGeometry();
  const fillMat = inkMaterial(game, 0.28, -1);
  const fill = new game.THREE.Mesh(fillGeo, fillMat);
  fill.frustumCulled = false;
  fill.renderOrder = 5;
  fill.raycast = () => {};
  fill.visible = false;
  game.materialDisposables.push(mat, fillMat);
  game.geometries.push(geo, fillGeo);
  game.scene.add(ribbon);
  game.scene.add(fill);
  game.stroke = ribbon;
  game.strokeFill = fill;
  return ribbon;
}

function worldFromUV(axis, anchor, u, v) {
  if (axis === 'x') return { x: anchor, y: v, z: u };
  if (axis === 'z') return { x: u, y: v, z: anchor };
  return { x: u, y: anchor, z: v };
}

function updateStrokeFill(game, axis, lift, points, color) {
  const fill = game.strokeFill;
  if (!fill || points.length < 3 || Math.abs(shoelace(points)) < 0.04) {
    if (fill) fill.visible = false;
    return;
  }
  let geo;
  try {
    geo = flatShape(game, points);
  } catch (err) {
    fill.visible = false;
    return;
  }
  const previous = fill.userData.geo;
  if (previous) {
    const index = game.geometries.indexOf(previous);
    if (index >= 0) game.geometries.splice(index, 1);
    previous.dispose();
  }
  fill.userData.geo = geo;
  fill.geometry = geo;
  game.geometries.push(geo);
  orientToPlane(game, fill, axis, lift);
  fill.material.color.setHex(color);
  fill.visible = true;
}

function redrawStroke(game, color) {
  const ribbon = ensureStroke(game);
  const paint = game.paint;
  if (!paint?.points || paint.points.length < 2) {
    hideStroke(game);
    return;
  }
  const { axis, plane, anchor, points, materialName } = paint;
  const lift = plane == null ? anchor : plane;
  ribbon.material.color.setHex(color);
  const sampled = resamplePolyline(points, 0.045);
  if (sampled.length < 2) {
    hideStroke(game);
    return;
  }
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of sampled) {
    minU = Math.min(minU, point.u);
    maxU = Math.max(maxU, point.u);
    minV = Math.min(minV, point.v);
    maxV = Math.max(maxV, point.v);
  }
  const diag = Math.hypot(maxU - minU, maxV - minV);
  const gap = Math.hypot(sampled[0].u - sampled[sampled.length - 1].u, sampled[0].v - sampled[sampled.length - 1].v);
  const closeGap = Math.min(0.65, Math.max(0.25, diag * 0.22));
  const closed = gap <= closeGap && diag >= 0.35;
  const visual = closed ? sampled.concat([sampled[0]]) : sampled;
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
  const flat = [];
  for (const run of clipStroke(visual, rects)) {
    for (const point of ribbonTriangles(run, 0.04)) flat.push(point);
  }
  if (!flat.length) {
    hideStroke(game);
    return;
  }
  const positions = new Float32Array(flat.length * 3);
  for (let i = 0; i < flat.length; i += 1) {
    const world = worldFromUV(axis, lift, flat[i].u, flat[i].v);
    positions[i * 3] = world.x;
    positions[i * 3 + 1] = world.y;
    positions[i * 3 + 2] = world.z;
  }
  ribbon.geometry.setAttribute('position', new game.THREE.BufferAttribute(positions, 3));
  ribbon.geometry.computeBoundingSphere();
  ribbon.visible = true;
  if (closed) updateStrokeFill(game, axis, lift, sampled, color);
  else if (game.strokeFill) game.strokeFill.visible = false;
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

function hostBox(host) {
  const { w, h, d } = host.userData;
  const p = host.position;
  return {
    minX: p.x - w * 0.5, maxX: p.x + w * 0.5,
    minY: p.y - h * 0.5, maxY: p.y + h * 0.5,
    minZ: p.z - d * 0.5, maxZ: p.z + d * 0.5,
  };
}

function regionBounds(axis, anchor, points, half) {
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
  if (axis === 'x') {
    return { minX: anchor - half, maxX: anchor + half, minY: minV, maxY: maxV, minZ: minU, maxZ: maxU };
  }
  if (axis === 'z') {
    return { minX: minU, maxX: maxU, minY: minV, maxY: maxV, minZ: anchor - half, maxZ: anchor + half };
  }
  return { minX: minU, maxX: maxU, minY: anchor - half, maxY: anchor + half, minZ: minV, maxZ: maxV };
}

function register(game, mesh, id) {
  mesh.userData.id = id;
  if (!game.meshById) game.meshById = new Map();
  game.meshById.set(id, mesh);
}

function attachStamp(game, host, region, materialName, thickness, sign, geo, id) {
  const axis = host.userData.axis || 'y';
  const anchor = host.position[axis];
  const points = region.points;
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
    bounds: regionBounds(axis, anchor, points, Math.max(0.04, thickness * 0.5)),
    axis,
    area: Math.abs(shoelace(points)),
    kind: host.userData.kind,
    paintable: true,
    skinnable: true,
    materialName,
    initialMaterial: materialName,
    solid: true,
    bounce: materialName === 'rubber',
    transparent: materialName === 'glass',
    penetrable: materialName === 'glass' || materialName === 'wood',
    visualOnly: true,
    stamp: true,
    shape: true,
    source: host,
    region: {
      points: points.map((point) => ({ u: point.u, v: point.v })),
      holes: (region.holes || []).map((hole) => hole.map((point) => ({ u: point.u, v: point.v }))),
    },
    center: worldFromUV(axis, anchor, su, sv),
  };
  register(game, mesh, id);
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
  const plane = anchor + sign * (half + 0.012);
  const point = aimOnPlane(game, axis, plane) || { x: hit.point.x, y: hit.point.y, z: hit.point.z };
  const uv = planeUV(point, axis);
  game.sfx.unskin?.();
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
    hideStroke(game);
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
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
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

function ringBox(ring) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of ring) {
    minU = Math.min(minU, point.u);
    maxU = Math.max(maxU, point.u);
    minV = Math.min(minV, point.v);
    maxV = Math.max(maxV, point.v);
  }
  return { minU, maxU, minV, maxV };
}

function boxesMeet(a, b, eps = 0.01) {
  return a.minU <= b.maxU + eps && a.maxU >= b.minU - eps && a.minV <= b.maxV + eps && a.maxV >= b.minV - eps;
}

function asRegion(item) {
  return Array.isArray(item) ? { points: item, holes: [] } : { points: item.points, holes: item.holes || [] };
}

function rasterLoops(test, box, cell) {
  const minU = box.minU - cell;
  const minV = box.minV - cell;
  const cols = Math.max(1, Math.ceil((box.maxU + cell - minU) / cell));
  const rows = Math.max(1, Math.ceil((box.maxV + cell - minV) / cell));
  if (cols * rows > 60000) return null;
  const grid = [];
  for (let y = 0; y < rows; y += 1) {
    const row = [];
    const v = minV + (y + 0.5) * cell;
    for (let x = 0; x < cols; x += 1) row.push(test({ u: minU + (x + 0.5) * cell, v }));
    grid.push(row);
  }
  return traceGrid(grid, cols, rows, minU, minV, cell);
}

function loopsToRegions(loops) {
  if (!loops || !loops.length) return [];
  const outers = [];
  const holes = [];
  for (const loop of loops) {
    if (shoelace(loop) < 0) outers.push(loop.slice().reverse());
    else holes.push(loop);
  }
  const regions = outers.map((points) => ({ points, holes: [] }));
  for (const hole of holes) {
    const owner = regions.find((region) => pointInPoly(hole[0], region.points));
    if (owner) owner.holes.push(hole);
  }
  return regions.filter((region) => Math.abs(shoelace(region.points)) > 0.01);
}

function mergeRegions(items, cell = 0.02) {
  const regions = items.map(asRegion);
  const boxes = regions.map((region) => ringBox(region.points));
  let meets = false;
  for (let i = 0; i < boxes.length && !meets; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (boxesMeet(boxes[i], boxes[j])) {
        meets = true;
        break;
      }
    }
  }
  if (!meets) return regions;
  const box = boxes.reduce((acc, b) => ({
    minU: Math.min(acc.minU, b.minU),
    maxU: Math.max(acc.maxU, b.maxU),
    minV: Math.min(acc.minV, b.minV),
    maxV: Math.max(acc.maxV, b.maxV),
  }));
  const loops = rasterLoops((point) => regions.some((region) => inRegion(point, region)), box, cell);
  return loops ? loopsToRegions(loops) : regions;
}

function subtractRegion(item, cutters, cell = 0.02) {
  const region = asRegion(item);
  const box = ringBox(region.points);
  const hits = cutters.map(asRegion).filter((cut) => boxesMeet(box, ringBox(cut.points), 0));
  if (!hits.length) return null;
  const loops = rasterLoops(
    (point) => inRegion(point, region) && !hits.some((cut) => inRegion(point, cut)),
    box,
    cell,
  );
  return loops ? loopsToRegions(loops) : null;
}

function insetAgainst(hole, outline) {
  const eps = 0.05;
  const keep = 0.006;
  return hole.map((point) => {
    let { u, v } = point;
    for (let i = 0; i < outline.length; i += 1) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const du = b.u - a.u;
      const dv = b.v - a.v;
      const len = Math.hypot(du, dv);
      if (len < 1e-6) continue;
      const t = ((u - a.u) * du + (v - a.v) * dv) / (len * len);
      if (t < -0.01 || t > 1.01) continue;
      const nu = -dv / len;
      const nv = du / len;
      const dist = (u - a.u) * nu + (v - a.v) * nv;
      if (dist < keep && dist > -eps) {
        u += nu * (keep - dist);
        v += nv * (keep - dist);
      }
    }
    return { u, v };
  });
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
  return traceGrid(grid, cols, rows, minU, minV, cell);
}

function traceGrid(grid, cols, rows, minU, minV, cell) {
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

function flatShape(game, item) {
  const region = asRegion(item);
  const ring = region.points.slice();
  if (shoelace(ring) < 0) ring.reverse();
  const shape = new game.THREE.Shape();
  shape.moveTo(ring[0].u, ring[0].v);
  for (let i = 1; i < ring.length; i += 1) shape.lineTo(ring[i].u, ring[i].v);
  for (const hole of region.holes) {
    if (!hole || hole.length < 3) continue;
    const pts = hole.slice();
    if (shoelace(pts) > 0) pts.reverse();
    const path = new game.THREE.Path();
    path.moveTo(pts[0].u, pts[0].v);
    for (let i = 1; i < pts.length; i += 1) path.lineTo(pts[i].u, pts[i].v);
    shape.holes.push(path);
  }
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

function overlapsAny(region, others) {
  const box = ringBox(region.points);
  return others.some((other) => {
    if (!boxesMeet(box, ringBox(other.points), 0)) return false;
    return other.points.some((point) => inRegion(point, region))
      || region.points.some((point) => inRegion(point, other));
  });
}

function buildRemainder(game, group, thickness, seed, index) {
  const lead = group[0];
  const holes = [];
  for (const host of group) {
    host.userData.paintRect = host.userData.paintRect || panelRect(host);
    for (const hole of host.userData.holes || []) holes.push(hole);
  }
  const outline = rectsOutline(group.map((host) => host.userData.paintRect));
  if (!outline) throw new Error('outline');
  const merged = mergeRegions(holes, 0.015)
    .map((region) => insetAgainst(region.points, outline))
    .filter((ring) => Math.abs(shoelace(ring)) > 0.02);
  const geo = extrudeOutline(game, outline, merged, thickness);
  const mesh = new game.THREE.Mesh(geo, lead.material);
  const axis = lead.userData.axis || 'y';
  orientToPlane(game, mesh, axis, lead.position[axis]);
  mesh.frustumCulled = false;
  const box = group.map(hostBox).reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX), maxX: Math.max(acc.maxX, b.maxX),
    minY: Math.min(acc.minY, b.minY), maxY: Math.max(acc.maxY, b.maxY),
    minZ: Math.min(acc.minZ, b.minZ), maxZ: Math.max(acc.maxZ, b.maxZ),
  }));
  mesh.userData = {
    w: lead.userData.w,
    h: lead.userData.h,
    d: lead.userData.d,
    bounds: box,
    axis,
    kind: lead.userData.kind,
    paintable: true,
    skinnable: true,
    materialName: lead.userData.materialName,
    initialMaterial: lead.userData.initialMaterial,
    solid: true,
    bounce: !!lead.userData.bounce,
    transparent: !!lead.userData.transparent,
    penetrable: !!lead.userData.penetrable,
    visualOnly: true,
    structural: true,
    shape: true,
    source: lead,
    group: group.slice(),
    center: { x: lead.position.x, y: lead.position.y, z: lead.position.z },
  };
  register(game, mesh, `${seed}_r${index}`);
  return mesh;
}

// Applies a closed stroke to the walls it covers. Local strokes check stock and
// bans; remote strokes replay exactly what the other client already accepted.
export function applyStroke(game, paint, materialName, opts = {}) {
  const remote = !!opts.remote;
  const seed = opts.seed || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (!game.mats[materialName]) return null;
  if (!remote && materialName === game.bannedMaterial) return null;
  const points = dedupeRing(paint.points);
  if (!strokeClosed(points)) return null;
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
  if (!stamped.length) return null;
  const cost = +applied.toFixed(2);
  const have = game.stock[materialName] || 0;
  if (!remote && have < cost - 0.001) return null;
  const thickness = Math.max(0.08, panelThickness(stamped[0].host));
  const fresh = stamped.map((item) => ({ points: item.clipped, holes: [] }));

  const hosts = stamped.map((item) => item.host);
  const eaten = [];
  const trimmed = [];
  for (const host of hosts) {
    for (const stamp of liveStamps(host)) {
      if (eaten.includes(stamp) || trimmed.some((entry) => entry.stamp === stamp)) continue;
      const region = stamp.userData.region;
      if (!overlapsAny(region, fresh)) continue;
      if (stamp.userData.materialName === materialName) {
        eaten.push(stamp);
      } else {
        const rest = subtractRegion(region, fresh);
        if (rest) trimmed.push({ stamp, rest });
      }
    }
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
      for (const host of group.slice()) {
        for (const peer of host.userData.remainder?.userData.group || []) {
          if (grouped.has(peer)) continue;
          grouped.add(peer);
          group.push(peer);
          grew = true;
        }
      }
      for (const other of stamped) {
        if (grouped.has(other.host)) continue;
        if (other.host.userData.materialName !== group[0].userData.materialName) continue;
        if (!group.some((host) => rectsTouch(other.rect, host.userData.paintRect || panelRect(host)))) continue;
        grouped.add(other.host);
        group.push(other.host);
        grew = true;
      }
    }
    groups.push(group);
  }

  const savedHoles = new Map();
  for (const group of groups) {
    for (const host of group) savedHoles.set(host, host.userData.holes ? host.userData.holes.slice() : null);
  }
  for (const item of stamped) {
    item.host.userData.paintRect = item.rect;
    if (!item.host.userData.holes) item.host.userData.holes = [];
    item.host.userData.holes.push(seatHole(item.clipped, item.rect));
  }

  const built = [];
  let shapes;
  try {
    groups.forEach((group, index) => built.push({ group, mesh: buildRemainder(game, group, thickness, seed, index) }));
    shapes = eaten.length
      ? mergeRegions([...fresh, ...eaten.map((stamp) => stamp.userData.region)], 0.02)
      : fresh;
    if (!shapes.length) throw new Error('stamp');
  } catch (err) {
    for (const item of built) {
      item.mesh.geometry.dispose();
      game.meshById?.delete(item.mesh.userData.id);
    }
    for (const [host, holes] of savedHoles) host.userData.holes = holes;
    return null;
  }

  if (!remote) game.stock[materialName] = Math.round((have - cost) * 100) / 100;
  for (const stamp of eaten) retireStamp(game, stamp);
  for (const item of built) {
    for (const host of item.group) dropRemainder(game, host);
    game.geometries.push(item.mesh.geometry);
    game.scene.add(item.mesh);
    game.surfaces.push(item.mesh);
    for (const host of item.group) {
      host.userData.remainder = item.mesh;
      host.visible = false;
      host.userData.skipBullets = true;
    }
  }

  const place = (region, name, sign, id, owners) => {
    const geo = flatShape(game, region);
    game.geometries.push(geo);
    const stamp = attachStamp(game, owners[0], region, name, thickness, sign, geo, id);
    stamp.userData.hosts = owners.slice();
    for (let i = 1; i < owners.length; i += 1) {
      if (!owners[i].userData.stamps) owners[i].userData.stamps = [];
      owners[i].userData.stamps.push(stamp);
    }
    return stamp;
  };
  let trimIndex = 0;
  for (const { stamp, rest } of trimmed) {
    const owners = stamp.userData.hosts || [stamp.userData.source];
    const name = stamp.userData.materialName;
    const side = stamp.userData.sign || 1;
    retireStamp(game, stamp);
    for (const region of rest) {
      const piece = place(region, name, side, `${seed}_t${trimIndex}`, owners);
      piece.userData.sign = side;
      trimIndex += 1;
    }
  }
  shapes.forEach((region, index) => {
    const owners = hosts.filter((host) => {
      const rect = host.userData.paintRect || panelRect(host);
      return boxesMeet(ringBox(region.points), rect, 0);
    });
    const stamp = place(region, materialName, paint.sign, `${seed}_s${index}`, owners.length ? owners : hosts);
    stamp.userData.sign = paint.sign;
  });

  const touched = new Set();
  for (const item of built) item.group.forEach((host) => touched.add(host));
  for (const host of touched) rebuildPassage(game, host);
  rebuildMasks(game);
  return { seed, cost };
}

export function commitPaint(game) {
  const paint = game.paint;
  game.paint = null;
  if (game.paintPreview) game.paintPreview.visible = false;
  if (!paint || game.phase !== 'action') return;
  const materialName = game.portalMaterial;
  const seed = game.newSeed ? game.newSeed() : undefined;
  const round = (n) => Math.round(n * 1000) / 1000;
  const stroke = { ...paint, points: paint.points.map((point) => ({ u: round(point.u), v: round(point.v) })) };
  const done = applyStroke(game, stroke, materialName, { seed });
  if (!done) {
    failStroke(game);
    return;
  }
  hideStroke(game);
  game.sfx.reskin();
  game.onPainted?.({
    seed: done.seed,
    material: materialName,
    axis: stroke.axis,
    anchor: stroke.anchor,
    sign: stroke.sign,
    hostMaterial: stroke.materialName || null,
    points: stroke.points.map((point) => [point.u, point.v]),
  });
  game.onHud?.();
}

export function applyRemoteStroke(game, event) {
  if (!Array.isArray(event.points)) return;
  game.netMute = true;
  try {
    applyStroke(game, {
      axis: event.axis,
      anchor: event.anchor,
      sign: event.sign,
      materialName: event.hostMaterial || null,
      points: event.points.map(([u, v]) => ({ u, v })),
    }, event.material, { remote: true, seed: event.seed });
    if (event.points.length) {
      const u = event.points.reduce((sum, p) => sum + p[0], 0) / event.points.length;
      const v = event.points.reduce((sum, p) => sum + p[1], 0) / event.points.length;
      const at = worldFromUV(event.axis, event.anchor, u, v);
      if (at) game.sfx.reskin?.({ x: at.x, y: at.y, z: at.z });
    }
  } finally {
    game.netMute = false;
  }
}

export function applyRemoteShatter(game, ids) {
  game.netMute = true;
  try {
    let changed = false;
    for (const id of ids || []) {
      const mesh = game.meshById?.get(id);
      if (!mesh || mesh.userData.destroyed) continue;
      if (mesh.userData.materialName === 'glass' && !game.shatterSoundAt) {
        game.shatterSoundAt = true;
        game.sfx.shatter?.(mesh.getWorldPosition(new game.THREE.Vector3()));
      }
      destroySurface(mesh, game);
      changed = true;
    }
    game.shatterSoundAt = false;
    if (changed) rebuildMasks(game);
  } finally {
    game.netMute = false;
  }
}

function failStroke(game) {
  if (game.stroke) {
    game.stroke.material.color.setHex(0xff4d42);
    game.stroke.visible = true;
  }
  if (game.strokeFill) game.strokeFill.visible = false;
  game.strokeErrorUntil = performance.now() + 700;
  game.sfx?.error?.();
}

export function cancelPaint(game) {
  game.paint = null;
  if (game.paintPreview) game.paintPreview.visible = false;
  hideStroke(game);
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
    if (data.type === 'remote') {
      if (!isEnemy(game, data.faction)) return;
      const dmg = data.part === 'head' ? 70 : 46;
      const kill = !!game.onRemoteHit?.(data.uid, dmg, data.part);
      reportHit(game, { dmg, head: data.part === 'head', kill });
      return;
    }
    if (data.type === 'bot') {
      const bot = game.bots[data.botIndex];
      if (bot && bot.state !== 'dead') {
        bot.hp -= 46;
        const kill = bot.hp <= 0;
        if (kill) killBot(game, bot);
        reportHit(game, { dmg: 46, head: false, kill });
      }
      return;
    }
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

// ── Bombs ───────────────────────────────────────────────────────────────
// Thrown bombs keep their original ballistic flight (gravity 14) and stick to
// the first surface they touch. While stuck the bomb is a small box resting on
// that surface; every frame we probe the space just behind it and, if the
// surface is gone (shattered glass, destroyed wood, a painted hole), the bomb
// detaches and falls/rolls with player gravity and collision until it lands.
// Bombs are never part of game.moveMask, so they can never block a player.
export const BOMB_FUSE = 2.5;
const BOMB_R = 0.1; // sphere radius while moving
const BOMB_HALF = { w: 0.11, h: 0.07, t: 0.05 }; // box half-extents while stuck
const LOOSE_GRAVITY = 22;
const TERMINAL = -28;

export function isEnemy(game, faction) {
  return !!game.ffa || faction !== game.faction;
}

function bombObstacles(game) {
  const skip = new Set();
  for (const remote of game.remoteList || []) skip.add(remote.body);
  for (const bot of game.bots || []) skip.add(bot.body);
  return { skip };
}

// Is any solid world geometry inside box? Floors honour painted holes.
function solidIn(game, box, ctx) {
  const touches = (b) => box.minX < b.maxX && box.maxX > b.minX
    && box.minY < b.maxY && box.maxY > b.minY
    && box.minZ < b.maxZ && box.maxZ > b.minZ;
  const cx = (box.minX + box.maxX) * 0.5;
  const cz = (box.minZ + box.maxZ) * 0.5;
  for (const mesh of game.floors) {
    if (mesh.userData.solid === false || mesh.userData.destroyed) continue;
    if (!touches(meshBox(mesh))) continue;
    if ((mesh.userData.openings || mesh.userData.stamps) && surfaceAt(mesh, { u: cx, v: cz }).open) continue;
    return mesh;
  }
  for (const mesh of game.surfaces) {
    if (mesh.userData.kind !== 'floor' || mesh.userData.solid === false || mesh.userData.stamp) continue;
    if (!touches(meshBox(mesh))) continue;
    if ((mesh.userData.openings || mesh.userData.stamps) && surfaceAt(mesh, { u: cx, v: cz }).open) continue;
    return mesh;
  }
  for (const mesh of game.moveMask || []) {
    if (ctx.skip.has(mesh) || mesh.userData.solid === false) continue;
    if (mesh.userData.type === 'remote' || mesh.userData.type === 'bot') continue;
    if (touches(meshBox(mesh))) return mesh;
  }
  return null;
}

function sphereBox(x, y, z, r = BOMB_R) {
  return { minX: x - r, maxX: x + r, minY: y - r, maxY: y + r, minZ: z - r, maxZ: z + r };
}

function stuckHalf(normal) {
  const { w, h, t } = BOMB_HALF;
  if (normal.y) return { x: w, y: t, z: h };
  if (normal.x) return { x: t, y: h, z: w };
  return { x: w, y: h, z: t };
}

function orientBomb(charge) {
  const n = charge.normal;
  if (n.y) charge.mesh.rotation.set(-Math.PI / 2, charge.spin || 0, 0, 'YXZ');
  else if (n.x) charge.mesh.rotation.set(0, Math.PI / 2, 0);
  else charge.mesh.rotation.set(0, 0, 0);
}

// Push a loose bomb out of any geometry it overlaps (shortest way out).
function unstick(game, charge, ctx) {
  if (!solidIn(game, sphereBox(charge.x, charge.y, charge.z), ctx)) return;
  const dirs = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
  for (let d = 0.02; d <= 0.4; d += 0.02) {
    for (const [dx, dy, dz] of dirs) {
      const x = charge.x + dx * d;
      const y = charge.y + dy * d;
      const z = charge.z + dz * d;
      if (!solidIn(game, sphereBox(x, y, z), ctx)) {
        charge.x = x;
        charge.y = y;
        charge.z = z;
        return;
      }
    }
  }
}

function beginLoose(game, charge) {
  charge.state = 'loose';
  charge.grounded = false;
  charge.normal = null;
  charge.vx = (charge.vx || 0) * 0.2;
  charge.vz = (charge.vz || 0) * 0.2;
  charge.vy = 0;
}

function stickToSurface(game, charge, normal, x, y, z) {
  const half = stuckHalf(normal);
  // snap the box flush against the surface we hit
  charge.state = 'stuck';
  charge.flying = false;
  charge.normal = normal;
  charge.x = normal.x ? x - normal.x * (BOMB_R - half.x) : x;
  charge.y = normal.y ? y - normal.y * (BOMB_R - half.y) : y;
  charge.z = normal.z ? z - normal.z * (BOMB_R - half.z) : z;
  charge.vx = 0;
  charge.vy = 0;
  charge.vz = 0;
  charge.mesh.position.set(charge.x, charge.y, charge.z);
  orientBomb(charge);
  game.sfx.stick?.({ x: charge.x, y: charge.y, z: charge.z });
}

// Something solid directly behind the stuck box?
function stillSupported(game, charge, ctx) {
  const n = charge.normal;
  const half = stuckHalf(n);
  const probe = {
    minX: charge.x - half.x * 0.8, maxX: charge.x + half.x * 0.8,
    minY: charge.y - half.y * 0.8, maxY: charge.y + half.y * 0.8,
    minZ: charge.z - half.z * 0.8, maxZ: charge.z + half.z * 0.8,
  };
  const depth = 0.07;
  if (n.x) {
    const face = charge.x - n.x * half.x;
    probe.minX = Math.min(face, face - n.x * depth);
    probe.maxX = Math.max(face, face - n.x * depth);
  } else if (n.y) {
    const face = charge.y - n.y * half.y;
    probe.minY = Math.min(face, face - n.y * depth);
    probe.maxY = Math.max(face, face - n.y * depth);
  } else {
    const face = charge.z - n.z * half.z;
    probe.minZ = Math.min(face, face - n.z * depth);
    probe.maxZ = Math.max(face, face - n.z * depth);
  }
  return !!solidIn(game, probe, ctx);
}

function flyStep(game, charge, dt, ctx) {
  charge.vy -= 14 * dt;
  const dist = Math.hypot(charge.vx, charge.vy, charge.vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.06));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    const axes = [['x', 'vx'], ['y', 'vy'], ['z', 'vz']];
    for (const [axis, vel] of axes) {
      const prev = charge[axis];
      charge[axis] += charge[vel] * h;
      if (solidIn(game, sphereBox(charge.x, charge.y, charge.z), ctx)) {
        const sign = Math.sign(charge[vel]) || -1;
        // bisect to the exact contact point so the bomb ends up flush
        let free = prev;
        let blocked = charge[axis];
        for (let k = 0; k < 8; k += 1) {
          const mid = (free + blocked) / 2;
          charge[axis] = mid;
          if (solidIn(game, sphereBox(charge.x, charge.y, charge.z), ctx)) blocked = mid;
          else free = mid;
        }
        charge[axis] = free;
        const normal = { x: 0, y: 0, z: 0 };
        normal[axis] = -sign;
        stickToSurface(game, charge, normal, charge.x, charge.y, charge.z);
        return;
      }
    }
  }
  charge.mesh.position.set(charge.x, charge.y, charge.z);
  charge.mesh.rotation.x += dt * 8;
  charge.mesh.rotation.z += dt * 5;
}

function looseStep(game, charge, dt, ctx) {
  unstick(game, charge, ctx);
  charge.vy = Math.max(TERMINAL, charge.vy - LOOSE_GRAVITY * dt);
  const dist = Math.hypot(charge.vx, charge.vy, charge.vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / 0.06));
  const h = dt / steps;
  charge.grounded = false;
  for (let i = 0; i < steps; i += 1) {
    for (const axis of ['x', 'z']) {
      const vel = `v${axis}`;
      const prev = charge[axis];
      charge[axis] += charge[vel] * h;
      if (solidIn(game, sphereBox(charge.x, charge.y, charge.z), ctx)) {
        charge[axis] = prev;
        charge[vel] *= -0.3;
      }
    }
    const prevY = charge.y;
    charge.y += charge.vy * h;
    if (solidIn(game, sphereBox(charge.x, charge.y, charge.z), ctx)) {
      charge.y = prevY;
      if (charge.vy < 0) {
        charge.grounded = true;
        charge.vy = charge.vy < -4 ? -charge.vy * 0.25 : 0;
      } else {
        charge.vy = 0;
      }
    }
  }
  if (charge.grounded || solidIn(game, sphereBox(charge.x, charge.y - 0.02, charge.z), ctx)) {
    // rolling friction
    const speed = Math.hypot(charge.vx, charge.vz);
    const next = Math.max(0, speed - 5 * dt);
    if (speed > 0) {
      charge.vx *= next / speed;
      charge.vz *= next / speed;
    }
    charge.mesh.rotation.z -= charge.vx * dt / BOMB_R * 0.5;
    charge.mesh.rotation.x += charge.vz * dt / BOMB_R * 0.5;
  }
  if (charge.y < -20) charge.fuse = 0;
  charge.mesh.position.set(charge.x, charge.y, charge.z);
}

export function useUtility(game) {
  if (game.phase !== 'action' || game.player.hp <= 0) return;
  if (!game.charges) game.charges = [];
  if ((game.bombs || 0) <= 0 || game.charges.filter((c) => !c.remote).length >= 2) return;
  game.bombs -= 1;
  game.onHud?.();
  if (game.view) {
    game.view.throwing = 1;
    game.view.pulse = 1;
  }
  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const throwSpec = {
    id: game.newSeed?.() || `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    x: game._o.x + game._d.x * 0.7,
    y: game._o.y + game._d.y * 0.7 - 0.15,
    z: game._o.z + game._d.z * 0.7,
    vx: game._d.x * 11,
    vy: game._d.y * 11 + 4.2,
    vz: game._d.z * 11,
    mode: 'stick',
  };
  // never start inside a wall when throwing point-blank
  const ctx = bombObstacles(game);
  if (solidIn(game, sphereBox(throwSpec.x, throwSpec.y, throwSpec.z), ctx)) {
    throwSpec.x = game._o.x;
    throwSpec.y = game._o.y - 0.15;
    throwSpec.z = game._o.z;
  }
  spawnCharge(game, throwSpec, null);
  game.onBomb?.(throwSpec);
  game.sfx.swipe();
}

function spawnCharge(game, spec, remote) {
  if (!game.chargeGeo) {
    game.chargeGeo = new game.THREE.BoxGeometry(BOMB_HALF.w * 2, BOMB_HALF.h * 2, BOMB_HALF.t * 2);
    game.geometries.push(game.chargeGeo);
  }
  if (!game.charges) game.charges = [];
  const mesh = new game.THREE.Mesh(game.chargeGeo, game.mats.charge);
  mesh.raycast = () => {};
  mesh.position.set(spec.x, spec.y, spec.z);
  game.scene.add(mesh);
  game.charges.push({
    id: spec.id || null,
    mesh,
    fuse: BOMB_FUSE - (remote?.age || 0),
    nextBeep: 0,
    state: 'flying',
    flying: true,
    x: spec.x,
    y: spec.y,
    z: spec.z,
    vx: spec.vx,
    vy: spec.vy,
    vz: spec.vz,
    spin: Math.random() * Math.PI,
    remote: remote || null,
  });
}

export function spawnRemoteCharge(game, event, ownerFaction, ownerName, age) {
  spawnCharge(game, event, { faction: ownerFaction, name: ownerName, uid: event.from, age: Math.max(0, Math.min(BOMB_FUSE, age || 0)) });
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

function stickTarget(game, x, y, z) {
  for (const remote of game.remoteList || []) {
    if (!remote.alive || !isEnemy(game, remote.faction)) continue;
    const p = remote.body.position;
    if (Math.abs(x - p.x) < 0.43 && Math.abs(z - p.z) < 0.43 && y > p.y - 0.8 && y < p.y + 1.15) return remote;
  }
  return null;
}

function anchorFrame(game, attach) {
  if (attach.self) {
    const p = game.player;
    return { x: p.x, y: p.feetY + 0.66 - (p.crouch || 0) * 0.4, z: p.z, yaw: p.yaw };
  }
  const remote = game.remotes?.get(attach.uid);
  if (!remote) return null;
  const b = remote.body;
  return { x: b.position.x, y: b.position.y, z: b.position.z, yaw: b.rotation.y };
}

function attachCharge(game, charge, attach) {
  charge.attach = attach;
  charge.state = 'attached';
  charge.flying = false;
  charge.vx = 0;
  charge.vy = 0;
  charge.vz = 0;
  followAnchor(game, charge);
}

function followAnchor(game, charge) {
  const frame = anchorFrame(game, charge.attach);
  if (!frame) return;
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  const { lx, ly, lz } = charge.attach;
  charge.x = frame.x + lx * c + lz * s;
  charge.y = frame.y + ly;
  charge.z = frame.z - lx * s + lz * c;
  charge.mesh.position.set(charge.x, charge.y, charge.z);
  charge.mesh.rotation.set(0, frame.yaw, 0);
}

function stickToRemote(game, charge, remote, x, y, z) {
  const b = remote.body;
  const c = Math.cos(b.rotation.y);
  const s = Math.sin(b.rotation.y);
  const dx = x - b.position.x;
  const dz = z - b.position.z;
  const attach = {
    uid: remote.uid,
    lx: Math.round((dx * c - dz * s) * 100) / 100,
    ly: Math.round((y - b.position.y) * 100) / 100,
    lz: Math.round((dx * s + dz * c) * 100) / 100,
  };
  attachCharge(game, charge, attach);
  game.sfx.stick?.();
  game.emit('game:killfeed', { text: `Bomb stuck to ${remote.name}` });
  if (charge.id) game.onBombStick?.({ id: charge.id, to: remote.uid, lx: attach.lx, ly: attach.ly, lz: attach.lz });
}

export function attachChargeById(game, event, selfUid) {
  const charge = (game.charges || []).find((item) => item.id && item.id === event.id);
  if (!charge) return;
  const self = event.to === selfUid;
  if (!self && !game.remotes?.get(event.to)) return;
  attachCharge(game, charge, {
    uid: event.to,
    self,
    lx: Number(event.lx) || 0,
    ly: Number(event.ly) || 0,
    lz: Number(event.lz) || 0,
  });
  if (self) {
    game.sfx.stick?.();
    game.emit('game:killfeed', { text: 'A bomb is stuck to you!' });
  }
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
  const ctx = bombObstacles(game);
  for (let i = game.charges.length - 1; i >= 0; i -= 1) {
    const charge = game.charges[i];
    charge.fuse -= dt;
    if (charge.attach) {
      followAnchor(game, charge);
      // the player it was stuck to left the match: drop it
      if (!charge.attach.self && !game.remotes?.get(charge.attach.uid)) {
        charge.attach = null;
        beginLoose(game, charge);
      }
    } else if (charge.state === 'flying') {
      const target = !charge.remote
        ? stickTarget(game, charge.x + charge.vx * dt, charge.y + charge.vy * dt, charge.z + charge.vz * dt)
        : null;
      if (target) {
        stickToRemote(game, charge, target, charge.x + charge.vx * dt, charge.y + charge.vy * dt, charge.z + charge.vz * dt);
      } else {
        flyStep(game, charge, dt, ctx);
      }
    } else if (charge.state === 'stuck') {
      if (!stillSupported(game, charge, ctx)) beginLoose(game, charge);
    }
    if (charge.state === 'loose') looseStep(game, charge, dt, ctx);

    // blink + beep, faster near the end of the 2.5 s fuse
    const elapsed = BOMB_FUSE - charge.fuse;
    const rate = charge.fuse < 0.8 ? 26 : 12;
    charge.mesh.material = Math.sin(elapsed * rate) > 0 ? game.mats.charge : game.mats.chargeDim;
    if (elapsed >= charge.nextBeep && charge.fuse > 0.05) {
      charge.nextBeep = elapsed + (charge.fuse < 0.8 ? 0.12 : 0.32);
      game.sfx.beep?.({ x: charge.x, y: charge.y, z: charge.z }, charge.fuse < 0.8);
    }
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
  const radius = 4.4;
  spawnBlast(game, charge.x, charge.y, charge.z);
  let changed = false;
  if (!charge.remote) {
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
  }
  if (changed) rebuildMasks(game);
  game.sfx.blast({ x: charge.x, y: charge.y, z: charge.z });
  if (game.view) game.view.kick = 1;
  const blastDamage = (dist) => Math.max(12, Math.round(100 * (1 - dist / radius)));
  const friendly = charge.remote && !isEnemy(game, charge.remote.faction);
  const px = game.player.x - charge.x;
  const py = game.player.feetY + 1 - charge.y;
  const pz = game.player.z - charge.z;
  const dist = Math.hypot(px, py, pz);
  if (!friendly && dist < radius && dist > 0.05 && game.phase === 'action') {
    // Enemy bombs are scored by the thrower's client via hit events.
    if (!charge.remote) damagePlayer(game, blastDamage(dist), 'Bomb');
    game.player.vx += (px / dist) * 8;
    game.player.vz += (pz / dist) * 8;
    game.player.vy = Math.max(game.player.vy, 4);
  }
  if (!charge.remote && game.phase === 'action') {
    const result = { dmg: 0, head: false, kill: false };
    for (const remote of game.remotes?.values?.() || []) {
      if (!remote.alive || !remote.seen || !isEnemy(game, remote.faction)) continue;
      const dx = remote.body.position.x - charge.x;
      const dy = remote.body.position.y - charge.y;
      const dz = remote.body.position.z - charge.z;
      const far = Math.hypot(dx, dy, dz);
      const stuck = charge.attach?.uid === remote.uid;
      if (far >= radius && !stuck) continue;
      const dmg = stuck ? 100 : blastDamage(far);
      if (game.onRemoteHit?.(remote.uid, dmg, 'body')) result.kill = true;
      result.dmg += dmg;
    }
    for (const bot of game.bots || []) {
      if (!bot || !bot.active || bot.state === 'dead') continue;
      const far = Math.hypot(bot.x - charge.x, 1 - charge.y, bot.z - charge.z);
      if (far >= radius) continue;
      const dmg = blastDamage(far);
      bot.hp -= dmg;
      result.dmg += dmg;
      if (bot.hp <= 0) {
        killBot(game, bot);
        result.kill = true;
      }
    }
    if (result.dmg > 0) reportHit(game, result);
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
  game.onUplink?.(30000);
  game.sfx.reskin();
  game.emit('game:killfeed', { text: `${game.playerName} armed the uplink — hold 30s` });
  game.onHud?.();
  if (game.mode === 'hack') game.setWeapon?.('pistol');
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

const TRACER_SPEED = 320;
const TRACER_LENGTH = 1.6;

export function spawnTracer(game, origin, direction, distance, enemy) {
  if (!game.tracers) {
    game.tracers = [];
    const geo = new game.THREE.BoxGeometry(0.035, 0.035, TRACER_LENGTH);
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
  mesh.userData.vx = direction.x * TRACER_SPEED;
  mesh.userData.vy = direction.y * TRACER_SPEED;
  mesh.userData.vz = direction.z * TRACER_SPEED;
  const run = Math.min(distance, 60) - 0.35 - TRACER_LENGTH * 0.5;
  mesh.userData.life = Math.max(0.03, run / TRACER_SPEED);
}

function spawnImpact(game, point, onTarget) {
  if (!game.impacts) {
    game.impacts = [];
    game.impactGeo = new game.THREE.SphereGeometry(0.07, 6, 4);
    game.impactMat = new game.THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, depthWrite: false });
    game.impactHitMat = new game.THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, depthWrite: false });
    game.geometries.push(game.impactGeo);
    game.materialDisposables.push(game.impactMat, game.impactHitMat);
  }
  let mesh = game.impacts.find((item) => !item.userData.live);
  if (!mesh) {
    mesh = new game.THREE.Mesh(game.impactGeo, game.impactMat);
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    game.scene.add(mesh);
    game.impacts.push(mesh);
  }
  mesh.material = onTarget ? game.impactHitMat : game.impactMat;
  mesh.position.copy(point);
  mesh.scale.setScalar(onTarget ? 1.6 : 1);
  mesh.visible = true;
  mesh.userData.live = true;
  mesh.userData.life = 0.14;
}

export function updateTracers(game, dt) {
  for (const mesh of game.impacts || []) {
    if (!mesh.userData.live) continue;
    mesh.userData.life -= dt;
    if (mesh.userData.life <= 0) {
      mesh.userData.live = false;
      mesh.visible = false;
      continue;
    }
    mesh.scale.multiplyScalar(1 + dt * 6);
  }
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

function reflectDirection(dir, normal) {
  const dot = dir.dot(normal);
  dir.addScaledVector(normal, -2 * dot);
  if (dir.lengthSq() < 0.0001) dir.copy(normal);
  else dir.normalize();
}

function shootRicochet(game, origin, direction, range, ignoreBotIndex) {
  const o = origin.clone();
  const d = direction.clone();
  let left = range;
  let scale = 1;
  const segments = [];
  const done = (hit) => ({ hit, scale, segments });
  for (let bounce = 0; bounce < 4; bounce += 1) {
    const shot = resolveBullet(game, o, d, left, ignoreBotIndex);
    scale *= shot.scale;
    const hit = shot.hit;
    const travel = hit ? hit.distance : Math.min(left, 28);
    spawnTracer(game, o, d, travel, false);
    segments.push([o.x, o.y, o.z, d.x, d.y, d.z, travel]);
    if (!hit) return done(null);
    const data = hit.object.userData;
    if (data.materialName !== 'rubber' || !hit.face || bounce === 3) return done(hit);
    const n = game._n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    if (d.dot(n) > 0) n.negate();
    reflectDirection(d, n);
    o.copy(hit.point).addScaledVector(n, 0.08);
    left -= hit.distance;
    if (left < 0.4) return done(hit);
  }
  return done(null);
}

function aimDir(game, spread) {
  const dir = game._d.clone();
  if (spread > 0) {
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
  }
  return dir;
}

export function reloadGun(game) {
  const spec = GUNS[game.mode];
  const ammo = game.ammo?.[game.mode];
  if (!spec || !ammo || game.phase === 'result' || game.reload || game.player.hp <= 0) return false;
  if (ammo.mag >= spec.mag || ammo.reserve <= 0) return false;
  const now = performance.now();
  game.reload = { mode: game.mode, startedAt: now, until: now + spec.reload };
  game.input.firing = false;
  game.ads = false;
  game.sfx.reloadStart?.(game.mode);
  game.onHud?.();
  return true;
}

export function updateReload(game, now) {
  const job = game.reload;
  if (!job) return;
  if (game.mode !== job.mode || game.player.hp <= 0 || game.phase === 'result') {
    game.reload = null;
    game.onHud?.();
    return;
  }
  if (now < job.until) return;
  const spec = GUNS[job.mode];
  const ammo = game.ammo?.[job.mode];
  game.reload = null;
  if (spec && ammo) {
    const take = Math.min(spec.mag - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
  }
  game.sfx.reloadEnd?.();
  game.onHud?.();
}

function fireRifle(game, now) {
  const spec = GUNS[game.mode];
  if (!game.input.firing || !spec) return;
  if (document.pointerLockElement !== game.canvas) return;
  if (game.reload) return;
  if (now - game.lastShot < spec.interval) return;
  const ammo = game.ammo?.[game.mode];
  if (ammo && ammo.mag <= 0) {
    game.input.firing = false;
    game.sfx.empty?.();
    reloadGun(game);
    return;
  }
  if (ammo) ammo.mag -= 1;
  game.lastShot = now;
  game.sfx.shot(spec.id);
  game.onHud?.();
  if (game.view) {
    game.view.muzzle = 0.045;
    game.view.kick = spec.id === 'sniper' ? 1.4 : spec.id === 'shotgun' ? 1.2 : 1;
  }

  game.camera.getWorldPosition(game._o);
  game.camera.getWorldDirection(game._d);
  const spread = (game.ads ? spec.adsSpread : spec.spread) * (spec.id === 'sniper' && !game.ads ? 2.2 : 1);
  const segments = [];
  const result = { dmg: 0, head: false, kill: false };
  for (let pellet = 0; pellet < spec.pellets; pellet += 1) {
    const shot = shootRicochet(game, game._o, aimDir(game, spread), spec.range);
    segments.push(...shot.segments);
    const hit = shot.hit;
    if (!hit) continue;
    const data = hit.object.userData;
    const dmg = Math.max(1, Math.round((data.part === 'head' ? spec.head : spec.body) * shot.scale));
    if (data.type === 'remote' && isEnemy(game, data.faction)) {
      if (game.onRemoteHit?.(data.uid, dmg, data.part)) result.kill = true;
      tallyHit(result, dmg, data.part);
      spawnImpact(game, hit.point, true);
      continue;
    }
    const bot = data.type === 'bot' ? game.bots[data.botIndex] : null;
    if (bot && bot.active && bot.state !== 'dead') {
      bot.hp -= dmg;
      tallyHit(result, dmg, data.part);
      spawnImpact(game, hit.point, true);
      if (bot.hp <= 0) {
        killBot(game, bot);
        result.kill = true;
      }
      continue;
    }
    spawnImpact(game, hit.point, false);
  }
  game.onShot?.(segments);
  reportHit(game, result);
}

function tallyHit(result, dmg, part) {
  result.dmg += dmg;
  if (part === 'head') result.head = true;
}

function reportHit(game, result) {
  if (result.dmg <= 0) {
    game.sfx.miss?.();
    return;
  }
  if (result.kill) game.sfx.kill?.();
  else game.sfx.hit(result.head);
  game.emit('game:hitmarker', result);
}

export function damagePlayer(game, amount, sourceName, sourceId) {
  if (game.phase !== 'action' || game.player.hp <= 0) return;
  if ((game.protectUntil || 0) > performance.now()) return; // FFA spawn protection
  game.player.hp = Math.max(0, game.player.hp - amount);
  game.emit('game:health', { hp: game.player.hp });
  game.emit('game:hurt', { amount });
  if (game.player.hp <= 0) {
    game.input.firing = false;
    cancelPaint(game);
    if (game.onDeath) game.onDeath(sourceName, sourceId);
    else game.emit('game:killfeed', { text: `${sourceName} eliminated ${game.playerName}` });
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
