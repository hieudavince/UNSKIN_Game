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
    if (canMove && !mesh.userData.visualOnly) move.push(mesh);
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

function destroySurface(mesh) {
  if (!mesh) return;
  if (mesh.userData.stamp) {
    killMesh(mesh);
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
    destroySurface(mesh);
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
  if (name === 'wood') return 0xc4844a;
  if (name === 'iron') return 0xd7dee6;
  return 0x9bfff0;
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
  geo.setAttribute('position', new game.THREE.BufferAttribute(new Float32Array(6), 3));
  geo.setDrawRange(0, 0);
  const mat = new game.THREE.LineBasicMaterial({ color: 0x9bfff0 });
  const line = new game.THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 8;
  line.visible = false;
  game.materialDisposables.push(mat);
  game.geometries.push(geo);
  game.scene.add(line);
  game.stroke = line;
  return line;
}

function worldFromUV(axis, anchor, u, v) {
  if (axis === 'x') return { x: anchor, y: v, z: u };
  if (axis === 'z') return { x: u, y: v, z: anchor };
  return { x: u, y: anchor, z: v };
}

function redrawStroke(game, color) {
  const line = ensureStroke(game);
  const { axis, anchor, points } = game.paint;
  const count = points.length;
  const positions = new Float32Array(Math.max(2, count) * 3);
  for (let i = 0; i < count; i += 1) {
    const world = worldFromUV(axis, anchor, points[i].u, points[i].v);
    positions[i * 3] = world.x;
    positions[i * 3 + 1] = world.y;
    positions[i * 3 + 2] = world.z;
  }
  line.geometry.setAttribute('position', new game.THREE.BufferAttribute(positions, 3));
  line.geometry.setDrawRange(0, count);
  line.material.color.setHex(color);
  line.visible = count > 1;
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

function loosenHole(hole, rect) {
  const margin = 0.025;
  let touches = false;
  for (const point of hole) {
    if (point.u <= rect.minU + margin || point.u >= rect.maxU - margin
      || point.v <= rect.minV + margin || point.v >= rect.maxV - margin) {
      touches = true;
      break;
    }
  }
  if (!touches) return hole.map((point) => ({ u: point.u, v: point.v }));
  let cu = 0;
  let cv = 0;
  for (const point of hole) {
    cu += point.u;
    cv += point.v;
  }
  cu /= hole.length;
  cv /= hole.length;
  const loosened = hole.map((point) => {
    const du = cu - point.u;
    const dv = cv - point.v;
    const len = Math.hypot(du, dv) || 1;
    return { u: point.u + (du / len) * 0.03, v: point.v + (dv / len) * 0.03 };
  });
  if (Math.abs(shoelace(loosened)) < 0.05) return hole.map((point) => ({ u: point.u, v: point.v }));
  return loosened;
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
  game.paint = { axis, anchor, plane, sign, points: [uv] };
  if (game.paintPreview) game.paintPreview.visible = false;
  redrawStroke(game, portalHex(game.portalMaterial));
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
  const last = game.paint.points[game.paint.points.length - 1];
  if (uvDist(last, uv) < 0.05) return;
  game.paint.points.push(uv);
  if (game.paint.points.length > 700) game.paint.points.shift();
  redrawStroke(game, portalHex(game.portalMaterial));
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
  const prepared = [];
  try {
    for (const item of stamped) {
      const thickness = Math.max(0.08, panelThickness(item.host));
      const hole = loosenHole(item.clipped, item.rect);
      const nextHoles = (item.host.userData.holes || []).concat([hole]);
      const shapeGeo = extrudePolygon(game, item.clipped, thickness);
      let remainGeo = null;
      try {
        remainGeo = extrudeWithHoles(game, item.rect, nextHoles, thickness);
      } catch (err) {
        shapeGeo.dispose();
        throw err;
      }
      prepared.push({
        host: item.host,
        clipped: item.clipped,
        hole,
        nextHoles,
        thickness,
        shapeGeo,
        remainGeo,
      });
    }
  } catch (err) {
    for (const item of prepared) {
      item.shapeGeo.dispose();
      item.remainGeo.dispose();
    }
    failStroke(game);
    return;
  }
  game.stock[materialName] = Math.round((have - cost) * 100) / 100;
  for (const item of prepared) {
    game.geometries.push(item.shapeGeo, item.remainGeo);
    attachRemainder(game, item.host, item.nextHoles, item.remainGeo);
    attachStamp(game, item.host, item.clipped, materialName, item.thickness, paint.sign, item.shapeGeo);
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
    const canCut = data.paintable && (data.materialName === 'wood' || data.materialName === 'glass');
    if (canCut) {
      destroySurface(hits[i].object);
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
  const x = game._o.x + game._d.x * 0.7;
  const y = game._o.y + game._d.y * 0.7 - 0.15;
  const z = game._o.z + game._d.z * 0.7;
  mesh.position.set(x, y, z);
  game.scene.add(mesh);
  game.charges.push({
    mesh,
    fuse: 2.2,
    flying: true,
    x,
    y,
    z,
    vx: game._d.x * 14,
    vy: game._d.y * 14 + 5.5,
    vz: game._d.z * 14,
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
  return y < 0.05;
}

export function updateBombs(game, dt) {
  if (!game.charges || !game.charges.length) return;
  for (let i = game.charges.length - 1; i >= 0; i -= 1) {
    const charge = game.charges[i];
    charge.fuse -= dt;
    if (charge.flying) {
      charge.vy -= 14 * dt;
      const nx = charge.x + charge.vx * dt;
      const ny = charge.y + charge.vy * dt;
      const nz = charge.z + charge.vz * dt;
      charge.mesh.position.set(nx, ny, nz);
      charge.mesh.rotation.x += dt * 9;
      charge.mesh.rotation.z += dt * 6;
      if (chargeHits(game, nx, ny, nz) || charge.fuse <= 0) {
        charge.x = nx;
        charge.y = ny;
        charge.z = nz;
        game.scene.remove(charge.mesh);
        game.charges.splice(i, 1);
        detonate(game, charge);
        continue;
      }
      charge.x = nx;
      charge.y = ny;
      charge.z = nz;
    }
    charge.mesh.material = Math.sin(charge.fuse * 30) > 0 ? game.mats.charge : game.mats.chargeDim;
    if (!charge.flying && charge.fuse <= 0) {
      game.scene.remove(charge.mesh);
      game.charges.splice(i, 1);
      detonate(game, charge);
    }
  }
}
function detonate(game, charge) {
  const radius = 3.6;
  let changed = false;
  for (const mesh of game.paintMask || []) {
    const center = mesh.userData.center || mesh.position;
    const dx = center.x - charge.x;
    const dy = center.y - charge.y;
    const dz = center.z - charge.z;
    if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
    const name = mesh.userData.materialName;
    if (name !== 'wood' && name !== 'glass') continue;
    destroySurface(mesh);
    changed = true;
  }
  if (changed) rebuildMasks(game);
  game.sfx.blast();
  if (game.view) game.view.kick = 1;
  const px = game.player.x - charge.x;
  const py = game.player.feetY + 1 - charge.y;
  const pz = game.player.z - charge.z;
  const dist = Math.hypot(px, py, pz);
  if (dist < 2.8 && dist > 0.05 && game.phase === 'action') {
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
