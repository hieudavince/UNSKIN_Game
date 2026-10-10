// Two-storey lab with a lobby, side rooms, a vault, and two stairwells.
// Ground slab, roof, and the outer shell stay fixed.
// Interior panels, doors, stairs, and the upper floor can be repainted.

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
  game.passages = [];
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
  const skyMat = new THREE.MeshLambertMaterial({
    color: 0xb7dcff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
  });
  const plasterMat = new THREE.MeshLambertMaterial({ color: 0x6e6258 });
  game.materialDisposables.push(shell, groundMat, apronMat, roofMat, lightMat, accentMat, skyMat, plasterMat);

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
  fixed(floors, skyMat, {
    name: 'skylight', x: 0, y: 8.32, z: 0, w: 9.2, h: 0.08, d: 7.4, kind: 'floor',
  });

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
    if (Math.abs(x) > 14.2 || Math.abs(z) > 16.2) return false;
    if (x < -8.2 && x > -15.4 && z > 5 && z < 14.6) return false;
    if (x > 8.2 && x < 15.4 && z > 5 && z < 14.6) return false;
    if (Math.abs(x) < 4.2 && z > 10.2 && z < 16.4) return false;
    if (Math.abs(x) < 4.6 && Math.abs(z) < 4.4 && Math.abs(x) > 1.45) return false;
    return true;
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
  const doorway = (axis, at, mid, materialName, name) => {
    panel(axis, at, mid - 1.15, 1.6, 0.7, 3.2, materialName);
    panel(axis, at, mid + 1.15, 1.6, 0.7, 3.2, materialName);
    panel(axis, at, mid, 2.9, 1.6, 0.6, materialName);
    door(axis, at, mid, 1.3, 2.6, materialName, name);
  };

  run('z', 10.6, -14.6, -14.4, 0, 3.2, 'iron');
  run('z', 10.6, -9.6, -8.2, 0, 3.2, 'iron');
  run('z', 10.6, -6.6, -1.5, 0, 3.2, 'wood');
  doorway('z', 10.6, 0, 'wood', 'door-lobby');
  run('z', 10.6, 1.5, 6.6, 0, 3.2, 'wood');
  run('z', 10.6, 8.2, 9.6, 0, 3.2, 'iron');
  panel('z', 10.6, -12.2, 2.9, 4.2, 0.55, 'iron', { name: 'stair-lintel-w' });
  panel('z', 10.6, 12.2, 2.9, 4.2, 0.55, 'iron', { name: 'stair-lintel-e' });

  panel('x', -7.6, -17.15, 1.6, 2.3, 3.2, 'iron');
  panel('x', 7.6, -17.15, 1.6, 2.3, 3.2, 'iron');
  run('x', -7.6, -16, 5, 0, 3.2, 'iron', [
    { from: -15.6, to: -13.4, top: 2.7 },
    { from: -6.6, to: -4.4, top: 2.7 },
    { from: 2.4, to: 4.6, top: 2.7 },
  ]);
  doorway('x', -7.6, -14.5, 'iron', 'door-w-vault');
  doorway('x', -7.6, -5.5, 'wood', 'door-w-mid');
  doorway('x', -7.6, 3.5, 'wood', 'door-w-front');
  run('z', -10, -15.3, -7.9, 0, 3.2, 'wood', [{ from: -11.6, to: -9.8, top: 2.7 }]);
  doorway('z', -10, -10.8, 'wood', 'door-w-back');
  run('z', -2, -15.3, -7.9, 0, 3.2, 'deck', [{ from: -11.6, to: -9.8, top: 2.7 }]);
  doorway('z', -2, -10.8, 'glass', 'door-w-glass');

  run('x', 7.6, -16, 5, 0, 3.2, 'iron', [
    { from: -15.6, to: -13.4, top: 2.7 },
    { from: -6.6, to: -4.4, top: 2.7 },
    { from: 2.4, to: 4.6, top: 2.7 },
  ]);
  doorway('x', 7.6, -14.5, 'iron', 'door-e-vault');
  doorway('x', 7.6, -5.5, 'glass', 'door-e-lab');
  doorway('x', 7.6, 3.5, 'wood', 'door-e-front');
  run('z', -10, 7.9, 15.3, 0, 3.2, 'glass', [{ from: 11.2, to: 13.4, top: 2.7 }]);
  doorway('z', -10, 12.4, 'glass', 'door-e-back');
  run('z', -2, 7.9, 15.3, 0, 3.2, 'wood', [{ from: 11.2, to: 13.4, top: 2.7 }]);
  doorway('z', -2, 12.4, 'wood', 'door-e-mid');

  panel('z', -9.2, -4.35, 1.6, 5.7, 3.2, 'iron');
  doorway('z', -9.2, 0, 'iron', 'door-vault');
  panel('z', -9.2, 2.85, 1.6, 2.7, 3.2, 'iron');
  panel('z', -9.2, 5.7, 1.6, 3, 3.2, 'glass', { name: 'vault-window' });

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
  const stairWell = (side) => {
    const x0 = side * 12.1;
    const x1 = side * 13.6;
    flight(x0, 12.6, -1, 0, 12);
    addBox(game, floors, mats.deck, {
      name: `landing-${side}`, x: x0, y: 2.28, z: 6.6, w: 3.4, h: 0.24, d: 2.6,
      axis: 'y', kind: 'floor', materialName: 'deck', paintable: true, area: 8,
    });
    flight(x1, 7.1, 1, 2.4, 13);
    addBox(game, floors, mats.deck, {
      name: `stair-exit-${side}`, x: side * 11.2, y: 4.88, z: 14.4, w: 4.2, h: 0.24, d: 2.4,
      axis: 'y', kind: 'floor', materialName: 'deck', paintable: true, area: 10,
    });
    run('x', side * 15.05, 6.2, 13.6, 0, 1.15, 'iron');
    run('x', side * 9.35, 6.2, 10.15, 0, 2.4, 'deck');
    run('x', side * 9.35, 10.35, 13.4, 0, 1.15, 'iron');
  };
  stairWell(-1);
  stairWell(1);

  run('x', -7.6, -16, 4, 5, 7.5, 'wood', [{ from: -4, to: -1, top: 7.6 }]);
  panel('x', -7.6, -3.65, 6.25, 0.7, 2.5, 'wood');
  panel('x', -7.6, -1.35, 6.25, 0.7, 2.5, 'wood');
  door('x', -7.6, -2.5, 6.15, 2.2, 'wood', 'door-up-w');
  run('x', 7.6, -16, 4, 5, 7.5, 'glass', [{ from: -4, to: -1, top: 7.6 }]);
  panel('x', 7.6, -3.65, 6.25, 0.7, 2.5, 'glass');
  panel('x', 7.6, -1.35, 6.25, 0.7, 2.5, 'glass');
  door('x', 7.6, -2.5, 6.15, 2.2, 'glass', 'door-up-e');
  run('x', 1.7, -4, 4, 5, 6.15, 'iron');
  run('x', -1.7, -4, 4, 5, 6.15, 'iron');
  run('z', 4.3, -8, -2.1, 5, 6.15, 'iron');
  run('z', 4.3, 2.1, 8, 5, 6.15, 'iron');
  run('z', -4.3, -8, -2.1, 5, 6.15, 'iron');
  run('z', -4.3, 2.1, 8, 5, 6.15, 'iron');

  [[-4.5, -4.5], [-4.5, 4.5], [4.5, -4.5], [4.5, 4.5]].forEach(([x, z], i) => {
    addBox(game, surfaces, mats.iron, {
      name: `col-${i}`, x, y: 4.2, z, w: 0.48, h: 8.4, d: 0.48,
      axis: 'y', kind: 'wall', materialName: 'iron', paintable: true, area: 4,
    });
  });
  addBox(game, surfaces, mats.iron, {
    name: 'beam-n', x: 0, y: 7.2, z: -6.5, w: 14, h: 0.28, d: 0.36,
    axis: 'y', kind: 'wall', materialName: 'iron', paintable: true, area: 5,
  });
  addBox(game, surfaces, mats.deck, {
    name: 'beam-s', x: 0, y: 7.2, z: 6.5, w: 14, h: 0.28, d: 0.36,
    axis: 'y', kind: 'wall', materialName: 'deck', paintable: true, area: 5,
  });

  const block = (name, x, y, z, w, h, d, materialName) => {
    addBox(game, props, mats[materialName], {
      name, x, y, z, w, h, d,
      axis: w <= d ? 'x' : 'z', kind: 'wall', materialName, paintable: true, area: Math.max(w, d) * h,
    });
  };
  block('desk', 0, 0.55, 14.2, 3.4, 1.1, 0.8, 'wood');
  block('hall-a', -2.2, 0.55, 3.4, 2.4, 1.1, 0.42, 'wood');
  block('hall-b', 2.8, 0.55, -1.2, 1.6, 1.1, 0.42, 'iron');
  block('hall-c', -0.4, 0.55, -5.6, 2.6, 1.1, 0.42, 'wood');
  block('crate-a', -3.4, 0.4, 6.8, 0.85, 0.8, 0.85, 'wood');
  block('crate-b', 3.6, 0.45, 7.4, 0.7, 0.9, 0.7, 'wood');
  block('rack-a', 12.4, 1.05, -5.6, 0.7, 2.1, 1.6, 'iron');
  block('rack-b', 13.6, 1.05, -5.6, 0.7, 2.1, 1.6, 'iron');
  block('out-l', -5.2, 0.6, 23.5, 2.6, 1.2, 0.5, 'iron');
  block('out-r', 5.2, 0.6, 23.5, 2.6, 1.2, 0.5, 'iron');
  block('out-c', 0, 0.45, 26.5, 2.2, 0.9, 0.7, 'wood');

  addBox(game, props, mats.console, {
    name: 'uplink', x: 0, y: 1.25, z: -13.2, w: 1.5, h: 1.7, d: 0.7,
    kind: 'prop', materialName: 'console', hackable: true, uplink: true, paintable: false,
  });
  addBox(game, props, accentMat, {
    name: 'uplink-mast', x: 0, y: 3.15, z: -13.2, w: 0.12, h: 2.2, d: 0.12,
    kind: 'prop', materialName: 'struct', paintable: false,
  });
  addBox(game, props, accentMat, {
    name: 'uplink-lamp', x: 0, y: 4.3, z: -13.2, w: 0.42, h: 0.1, d: 0.42,
    kind: 'prop', materialName: 'struct', paintable: false,
  });
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 256;
  screenCanvas.height = 144;
  const screenCtx = screenCanvas.getContext('2d');
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.48, 0.07), mats.console);
  bezel.position.set(1.62, 1.38, -12.95);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), mats.iron);
  stand.position.set(1.62, 0.86, -12.95);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.34),
    new THREE.MeshBasicMaterial({ map: screenTex }),
  );
  screen.position.set(1.62, 1.38, -12.9);
  game.scene.add(bezel, stand, screen);
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
  fixed(props, plasterMat, {
    name: 'pier-l', x: -2.35, y: 2.4, z: 18.05, w: 0.42, h: 4.8, d: 0.42, kind: 'wall',
  });
  fixed(props, plasterMat, {
    name: 'pier-r', x: 2.35, y: 2.4, z: 18.05, w: 0.42, h: 4.8, d: 0.42, kind: 'wall',
  });
  [[-10, 8], [10, 8], [-10, -6], [10, -6], [0, 0], [0, 14]].forEach(([x, z], i) => {
    addBox(game, props, lightMat, {
      name: `light-${i}`, x, y: z > 12 ? 6.4 : 3.35, z, w: 1.4, h: 0.06, d: 0.22,
      kind: 'prop', materialName: 'struct', paintable: false,
    });
  });
  [[-11, 2], [0, -3], [11, 2]].forEach(([x, z], i) => {
    addBox(game, props, mats.iron, {
      name: `pipe-${i}`, x, y: 3.12, z, w: 4.5, h: 0.1, d: 0.1,
      axis: 'y', kind: 'wall', materialName: 'iron', paintable: false, area: 0.4,
    });
  });

  const lamp = (x, y, z, color, intensity, distance) => {
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.set(x, y, z);
    game.scene.add(light);
  };
  lamp(0, 6.2, 14, 0xffe1c2, 0.85, 14);
  lamp(0, 3.5, 2, 0xd5e4ff, 0.55, 16);
  lamp(0, 3.3, -12.4, 0x7dffe8, 0.9, 11);
  lamp(-11.5, 3.2, -6, 0xffe1c2, 0.4, 9);
  lamp(12.2, 3.2, -6, 0xc6d8ff, 0.45, 9);
  lamp(0, 7.3, 0, 0xe7eeff, 0.4, 18);

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

