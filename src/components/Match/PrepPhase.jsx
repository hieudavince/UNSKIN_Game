// Two-storey lab. Ground slab, roof, and the outer shell stay fixed.
// Every interior panel, door, stair, and upper floor tile can be repainted.

export function meshBox(mesh) {
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
  const drop = game.surfaces.filter((mesh) => mesh.userData.stamp || mesh.userData.structural);
  for (const mesh of drop) {
    game.scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
  }
  if (drop.length) {
    game.surfaces = game.surfaces.filter((mesh) => !mesh.userData.stamp && !mesh.userData.structural);
  }
  const resetMesh = (mesh) => {
    mesh.visible = true;
    mesh.userData.destroyed = false;
    mesh.userData.skipBullets = false;
    mesh.userData.holes = null;
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

export function buildArena(game) {
  const { THREE, mats } = game;
  const floors = [];
  const blocks = [];
  const surfaces = [];
  const props = [];
  const shell = new THREE.MeshLambertMaterial({ color: 0x343d4c });
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x2a3342 });
  const apronMat = new THREE.MeshLambertMaterial({ color: 0x3a4454 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x1a1f28 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xf6f1e6 });
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x3ee0c8 });
  game.materialDisposables.push(shell, groundMat, apronMat, roofMat, lightMat, accentMat);

  const fixed = (list, material, spec) => addBox(game, list, material, {
    ...spec, materialName: 'struct', paintable: false,
  });

  fixed(floors, groundMat, {
    name: 'ground', x: 0, y: -0.2, z: 2, w: 46, h: 0.4, d: 78, kind: 'floor',
  });
  fixed(floors, apronMat, {
    name: 'apron', x: 0, y: 0.02, z: 26, w: 18, h: 0.06, d: 14, kind: 'floor',
  });

  const roof = (name, x, z, w, d) => fixed(floors, roofMat, {
    name, x, y: 8.55, z, w, h: 0.36, d, kind: 'floor',
  });
  roof('roof-s', 0, 13, 32, 12);
  roof('roof-n', 0, -13, 32, 12);
  roof('roof-e', 11, 0, 10, 14);
  roof('roof-w', -11, 0, 10, 14);

  const shellWall = (name, x, y, z, w, h, d) => fixed(blocks, shell, {
    name, x, y, z, w, h, d, kind: 'wall',
  });
  shellWall('shell-n', 0, 4.4, -18.3, 33, 8.8, 0.6);
  shellWall('shell-e-n', 16.3, 4.4, -9.5, 0.6, 8.8, 17);
  shellWall('shell-e-s', 16.3, 4.4, 9.5, 0.6, 8.8, 17);
  shellWall('shell-e-lintel', 16.3, 7.3, 0, 0.6, 3, 3.2);
  shellWall('shell-w', -16.3, 4.4, 0, 0.6, 8.8, 36.6);
  shellWall('shell-s-w', -8.6, 4.4, 18.3, 15.2, 8.8, 0.6);
  shellWall('shell-s-e', 8.6, 4.4, 18.3, 15.2, 8.8, 0.6);
  shellWall('shell-s-lintel', 0, 7.2, 18.3, 3.4, 3.4, 0.6);

  const slabGeo = new THREE.BoxGeometry(3, 0.22, 3);
  game.geometries.push(slabGeo);
  const onUpper = (x, z) => {
    const court = Math.abs(x) < 5.2 && Math.abs(z) < 5.2;
    const bridge = Math.abs(x) < 2.2 && Math.abs(z) < 1.7;
    const stair = x < -8.4 && x > -15.2 && z > 5.2 && z < 14.2;
    if (stair) return false;
    if (court && !bridge) return false;
    if (Math.abs(x) > 14.2 || Math.abs(z) > 16.2) return false;
    const wing = (z > 6 && z < 16.2) || (z < -6 && z > -16.2) || (x > 6 && x < 14.2 && Math.abs(z) < 6) || (x < -6 && x > -14.2 && Math.abs(z) < 6);
    return wing || bridge;
  };
  let slab = 0;
  for (let x = -13.5; x <= 13.5; x += 3) {
    for (let z = -15; z <= 15; z += 3) {
      if (!onUpper(x, z)) continue;
      const materialName = ((x + z) / 3) % 2 === 0 ? 'deck' : 'iron';
      addBox(game, floors, mats[materialName], {
        name: `slab-${slab}`,
        x, y: 4.89, z, w: 3, h: 0.22, d: 3,
        geo: slabGeo, axis: 'y', kind: 'floor', materialName, paintable: true, area: 9,
      });
      slab += 1;
    }
  }

  let panelCount = 0;
  const panel = (axis, at, along, y, len, height, materialName, extra = {}) => {
    const spec = axis === 'x'
      ? { x: at, y, z: along, w: 0.22, h: height, d: len }
      : { x: along, y, z: at, w: len, h: height, d: 0.22 };
    addBox(game, surfaces, mats[materialName], {
      name: extra.name || `p-${panelCount}`,
      ...spec,
      axis,
      kind: extra.door ? 'door' : 'wall',
      materialName,
      paintable: true,
      door: extra.door || null,
      area: len * height,
    });
    panelCount += 1;
  };
  const run = (axis, at, a0, a1, y0, y1, materialName, gaps = []) => {
    for (let yb = y0; yb < y1 - 0.15; yb += 1.6) {
      const height = Math.min(1.6, y1 - yb);
      const y = yb + height * 0.5;
      for (let c = a0; c < a1 - 0.3; c += 3) {
        const len = Math.min(3, a1 - c);
        const mid = c + len * 0.5;
        if (gaps.some((g) => mid > g.from && mid < g.to && y < (g.top ?? 99))) continue;
        panel(axis, at, mid, y, len, height, materialName);
      }
    }
  };
  const door = (axis, at, along, y, h, materialName, name) => {
    panel(axis, at, along, y, 1.6, h, materialName, { door: materialName, name });
  };

  door('z', 18.3, 0, 1.55, 3.1, 'glass', 'door-entry');
  run('z', 10, -8, 8, 0, 3.2, 'wood', [{ from: -1.3, to: 1.3, top: 2.4 }]);
  run('x', -6, -5, 5, 0, 3.2, 'glass', [{ from: -1.2, to: 1.6, top: 3.3 }]);
  run('x', 6, -5, 5, 0, 3.2, 'wood', [{ from: 2.2, to: 5, top: 3.3 }]);
  run('z', -8, -12, 12, 0, 3.2, 'iron', [{ from: -1.2, to: 1.2, top: 2.6 }]);
  door('z', -8, 0, 1.35, 2.7, 'iron', 'door-north');
  run('z', -8, -10, 10, 5, 7.6, 'glass', [{ from: -1.4, to: 1.4, top: 7.2 }]);
  door('z', -8, 0, 6.2, 2.4, 'glass', 'door-up');
  run('x', 8, 6, 15, 5, 7.4, 'iron', [{ from: 9, to: 11.2, top: 7 }]);
  door('x', 8, 10.1, 6.15, 2.3, 'wood', 'door-loft');

  const rail = (axis, at, along) => panel(axis, at, along, 5.55, 2.4, 1.05, 'iron');
  [-4, -1.5, 1.5, 4].forEach((v) => {
    rail('z', 5.3, v);
    rail('z', -5.3, v);
    rail('x', 5.3, v);
    rail('x', -5.3, v);
  });

  const flight = (x, z0, dir, base, count) => {
    for (let i = 0; i < count; i += 1) {
      const top = base + 0.2 * (i + 1);
      addBox(game, floors, mats.iron, {
        name: `step-${x}-${i}-${dir}`,
        x,
        y: top - 0.1,
        z: z0 + dir * i * 0.46,
        w: 1.7,
        h: 0.2,
        d: 0.56,
        axis: 'y',
        kind: 'floor',
        materialName: 'iron',
        paintable: true,
        area: 0.85,
      });
    }
  };
  flight(-12.1, 12.6, -1, 0, 12);
  addBox(game, floors, mats.deck, {
    name: 'landing', x: -12.1, y: 2.28, z: 6.6, w: 3.6, h: 0.24, d: 2.8,
    axis: 'y', kind: 'floor', materialName: 'deck', paintable: true, area: 10,
  });
  flight(-13.6, 7.1, 1, 2.4, 13);
  addBox(game, floors, mats.deck, {
    name: 'stair-exit', x: -11.2, y: 4.88, z: 14.4, w: 4.2, h: 0.24, d: 2.4,
    axis: 'y', kind: 'floor', materialName: 'deck', paintable: true, area: 10,
  });
  run('x', -15.1, 6, 14, 0, 5, 'iron', [{ from: 12.2, to: 14, top: 3 }]);
  run('x', -9.3, 6, 13, 0, 5, 'deck', []);

  [[-6, -6], [-6, 6], [6, -6], [6, 6]].forEach(([x, z], i) => {
    addBox(game, surfaces, mats.iron, {
      name: `col-${i}`, x, y: 4.2, z, w: 0.55, h: 8.4, d: 0.55,
      axis: 'y', kind: 'wall', materialName: 'iron', paintable: true, area: 4.6,
    });
  });
  addBox(game, surfaces, mats.iron, {
    name: 'beam', x: 0, y: 7.15, z: 0, w: 12, h: 0.28, d: 0.42,
    axis: 'y', kind: 'wall', materialName: 'iron', paintable: true, area: 5,
  });

  addBox(game, props, mats.iron, {
    name: 'cover-l', x: -4.2, y: 0.55, z: 24, w: 2.4, h: 1.1, d: 0.45,
    axis: 'z', kind: 'wall', materialName: 'iron', paintable: true, area: 2.6,
  });
  addBox(game, props, mats.iron, {
    name: 'cover-r', x: 4.2, y: 0.55, z: 24, w: 2.4, h: 1.1, d: 0.45,
    axis: 'z', kind: 'wall', materialName: 'iron', paintable: true, area: 2.6,
  });
  addBox(game, props, mats.console, {
    name: 'uplink', x: 0, y: 1.25, z: -12.4, w: 1.6, h: 1.7, d: 0.7,
    kind: 'prop', materialName: 'console', hackable: true, uplink: true, paintable: false,
  });
  addBox(game, props, accentMat, {
    name: 'uplink-mast', x: 0, y: 3.3, z: -12.4, w: 0.14, h: 2.4, d: 0.14,
    kind: 'prop', materialName: 'struct', paintable: false,
  });
  addBox(game, props, accentMat, {
    name: 'uplink-lamp', x: 0, y: 4.55, z: -12.4, w: 0.45, h: 0.12, d: 0.45,
    kind: 'prop', materialName: 'struct', paintable: false,
  });
  [[-10, 12, 4.55], [10, 12, 4.55], [-10, -12, 4.55], [10, -12, 4.55], [0, 0, 7.6]].forEach(([x, z, y], i) => {
    addBox(game, props, lightMat, {
      name: `light-${i}`, x, y, z, w: 1.8, h: 0.06, d: 0.28,
      kind: 'prop', materialName: 'struct', paintable: false,
    });
  });

  game.floors = floors;
  game.blocks = blocks;
  game.surfaces = surfaces;
  game.props = props;
  game.spawns = {
    atlas: { x: 0, z: 30, yaw: 0 },
    outliers: { x: 0, z: -13.5, yaw: Math.PI },
  };
  game.botAnchors = [];
}
export default function PrepPhase() {
  return null;
}

