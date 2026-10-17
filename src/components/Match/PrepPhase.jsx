// Arena construction from the data maps in ./maps (Foundry Labs, Helix Complex).
// Ground slab, roof, outer shell, stairs and trims stay fixed; interior panels,
// doors, slabs and crates can be repainted.
import { mapSpec } from './maps';

export function meshBox(mesh) {
  if (mesh.userData.bounds) return mesh.userData.bounds;
  const { w, h, d } = mesh.userData;
  const p = mesh.position;
  return {
    minX: p.x - w * 0.5,
    maxX: p.x + w * 0.5,
    minY: p.y - h * 0.5,
    maxY: p.y + h * 0.5,
    minZ: p.z - d * 0.5,
    maxZ: p.z + d * 0.5,
  };
}

export function overlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX
    && a.minY < b.maxY && a.maxY > b.minY
    && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export function applyMaterial(mesh, name, mats) {
  const material = mats[name];
  if (!material) return;
  mesh.material = material;
  mesh.userData.materialName = name;
  mesh.userData.solid = true;
  mesh.userData.bounce = name === 'rubber';
  mesh.userData.transparent = name === 'glass';
  mesh.userData.penetrable = name === 'glass' || name === 'wood';
}

export function restoreArena(game) {
  game.passages = [];
  const drop = game.surfaces.filter((mesh) => mesh.userData.stamp || mesh.userData.structural);
  for (const mesh of drop) {
    game.scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (game.meshById && mesh.userData.id) game.meshById.delete(mesh.userData.id);
  }
  if (drop.length) {
    game.surfaces = game.surfaces.filter((mesh) => !mesh.userData.stamp && !mesh.userData.structural);
  }
  const resetMesh = (mesh) => {
    mesh.visible = true;
    mesh.userData.destroyed = false;
    mesh.userData.skipBullets = false;
    mesh.userData.holes = null;
    mesh.userData.openings = null;
    mesh.userData.noMove = false;
    mesh.userData.passage = null;
    mesh.userData.stamps = null;
    mesh.userData.remainder = null;
    mesh.userData.paintRect = null;
    if (mesh.userData.basePaintable != null) mesh.userData.paintable = mesh.userData.basePaintable;
    if (mesh.userData.baseSkinnable != null) mesh.userData.skinnable = mesh.userData.baseSkinnable;
    if (!mesh.userData.initialMaterial || !game.mats[mesh.userData.initialMaterial]) return;
    applyMaterial(mesh, mesh.userData.initialMaterial, game.mats);
  };
  for (const mesh of game.surfaces) resetMesh(mesh);
  for (const mesh of game.floors) {
    if (mesh.userData.paintable || mesh.userData.basePaintable) resetMesh(mesh);
  }
  for (const mesh of game.props) {
    if (mesh.userData.paintable) resetMesh(mesh);
    if (!mesh.userData.hackable) continue;
    mesh.userData.hacked = false;
    mesh.material = game.mats.console;
  }
}

function addBox(game, list, material, spec) {
  const geo = spec.geo || new game.THREE.BoxGeometry(spec.w, spec.h, spec.d);
  if (!spec.geo) game.geometries.push(geo);
  const mesh = new game.THREE.Mesh(geo, material);
  mesh.name = spec.name;
  mesh.position.set(spec.x, spec.y, spec.z);
  const materialName = spec.materialName;
  const axis = spec.axis || (spec.kind === 'floor' ? 'y' : (spec.w <= spec.d ? 'x' : 'z'));
  const area = spec.area
    || (axis === 'x' ? spec.h * spec.d : axis === 'z' ? spec.w * spec.h : spec.w * spec.d);
  mesh.userData = {
    w: spec.w,
    h: spec.h,
    d: spec.d,
    axis,
    area,
    kind: spec.kind,
    skinnable: !!spec.paintable,
    paintable: !!spec.paintable,
    hackable: !!spec.hackable,
    hacked: false,
    door: spec.door || null,
    uplink: !!spec.uplink,
    materialName,
    initialMaterial: materialName,
    solid: true,
    bounce: materialName === 'rubber',
    transparent: materialName === 'glass',
    penetrable: materialName === 'glass' || materialName === 'wood',
  };
  game.scene.add(mesh);
  list.push(mesh);
  return mesh;
}

// Builds the arena from a data map spec (see ./maps). The same spec is used by
// tests/mapCheck.js, so what the test verifies is exactly what gets rendered.
const STYLE_COLORS = {
  shell: 0x343d4c,
  shell2: 0x3a3546,
  shell3: 0x2f4246,
  deck: 0x5c656e,
  step: 0x4b5562,
  trim: 0x6e7884,
  ground: 0x2a3342,
  roof: 0x1c222c,
  accent: 0x3ee0c8,
  light: 0xf6f1e6,
};

export function buildArena(game, mapId) {
  const { THREE, mats } = game;
  const spec = mapSpec(mapId || game.mapId);
  game.map = spec;
  const floors = [];
  const blocks = [];
  const surfaces = [];
  const props = [];
  const lists = { floors, blocks, surfaces, props };
  const styleMats = {};
  const styleMat = (style) => {
    if (!styleMats[style]) {
      const color = STYLE_COLORS[style] ?? STYLE_COLORS.shell;
      styleMats[style] = style === 'light' || style === 'accent'
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshLambertMaterial({ color });
      game.materialDisposables.push(styleMats[style]);
    }
    return styleMats[style];
  };

  for (const box of spec.boxes) {
    const list = lists[box.list] || surfaces;
    const paintable = !!box.paint && !!mats[box.material];
    const materialName = paintable || box.material === 'console' ? box.material : 'struct';
    const material = paintable || box.material === 'console' ? mats[box.material] : styleMat(box.style);
    const axis = box.kind === 'floor' ? 'y' : (box.w <= box.d ? 'x' : 'z');
    addBox(game, list, material, {
      name: box.name,
      x: box.x,
      y: box.y,
      z: box.z,
      w: box.w,
      h: box.h,
      d: box.d,
      kind: box.kind,
      axis,
      materialName,
      paintable,
      hackable: !!box.hackable,
      uplink: !!box.uplink,
      door: box.door || null,
      area: axis === 'y' ? box.w * box.d : Math.max(box.w, box.d) * box.h,
    });
  }

  for (const lamp of spec.lights) {
    const light = new THREE.PointLight(lamp.color, lamp.intensity, lamp.distance);
    light.position.set(lamp.x, lamp.y, lamp.z);
    game.scene.add(light);
  }
  if (spec.fog && game.scene.fog) {
    game.scene.fog.near = spec.fog.near;
    game.scene.fog.far = spec.fog.far;
  }

  // decorative, non-colliding pieces (monitor stand / bezel)
  for (const item of spec.decor || []) {
    const geo = new THREE.BoxGeometry(item.maxX - item.minX, item.maxY - item.minY, item.maxZ - item.minZ);
    game.geometries.push(geo);
    const mesh = new THREE.Mesh(geo, item.type === 'bezel' ? mats.console : mats.iron);
    mesh.position.set((item.minX + item.maxX) / 2, (item.minY + item.maxY) / 2, (item.minZ + item.maxZ) / 2);
    mesh.raycast = () => {};
    game.scene.add(mesh);
  }

  game.uplinkDraw = null;
  if (spec.screen) {
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 256;
    screenCanvas.height = 144;
    const screenCtx = screenCanvas.getContext('2d');
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
    game.materialDisposables.push(screenMat);
    const screenGeo = new THREE.PlaneGeometry(0.62, 0.34);
    game.geometries.push(screenGeo);
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(spec.screen.x, spec.screen.y, spec.screen.z + 0.002);
    screen.raycast = () => {};
    game.scene.add(screen);
    const paintScreen = (percent, active) => {
      screenCtx.fillStyle = '#07140f';
      screenCtx.fillRect(0, 0, 256, 144);
      screenCtx.strokeStyle = '#3ee0a0';
      screenCtx.lineWidth = 8;
      screenCtx.strokeRect(10, 10, 236, 124);
      screenCtx.fillStyle = '#9bffe0';
      screenCtx.textAlign = 'center';
      screenCtx.font = 'bold 28px sans-serif';
      screenCtx.fillText('UPLINK', 128, 52);
      screenCtx.fillStyle = '#f7fff9';
      screenCtx.font = 'bold 26px sans-serif';
      screenCtx.fillText(active ? `${percent}% COMPLETE` : 'READY', 128, 98);
      screenTex.needsUpdate = true;
    };
    paintScreen(0, false);
    game.uplinkDraw = paintScreen;
  }

  game.floors = floors;
  game.blocks = blocks;
  game.surfaces = surfaces;
  game.props = props;
  game.meshById = new Map();
  [...floors, ...blocks, ...surfaces, ...props].forEach((mesh, index) => {
    let id = mesh.name || `m${index}`;
    if (game.meshById.has(id)) id = `${id}#${index}`;
    mesh.userData.id = id;
    game.meshById.set(id, mesh);
  });
  game.spawns = {
    atlas: { ...spec.spawns.atlas },
    outliers: { ...spec.spawns.outliers },
  };
  game.ffaSpawns = (spec.ffaSpawns || []).map((s) => ({ ...s }));
  game.botAnchors = [];
}

// Spawn safety: returns the first spot near (x, z) on the given level where a
// standing player overlaps no solid box. Used at runtime as a last line of
// defence on top of the map test.
export function freeSpot(game, x, y, z) {
  const solids = [...game.blocks, ...game.surfaces, ...game.props]
    .filter((mesh) => mesh.userData.solid !== false && mesh.visible !== false);
  const clear = (px, pz) => {
    const box = { minX: px - 0.4, maxX: px + 0.4, minY: y + 0.05, maxY: y + 1.8, minZ: pz - 0.4, maxZ: pz + 0.4 };
    return !solids.some((mesh) => overlap(box, meshBox(mesh)));
  };
  if (clear(x, z)) return { x, z };
  for (let ring = 1; ring <= 10; ring += 1) {
    const r = ring * 0.4;
    for (let k = 0; k < 8 * ring; k += 1) {
      const a = (k / (8 * ring)) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (clear(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

export default function PrepPhase() {
  return null;
}

