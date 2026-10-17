const HELD = {
  pistol: { right: [0.1, -0.1, -0.52], left: [0.04, -0.13, -0.5], muzzle: -0.74 },
  rifle: { right: [0.13, -0.14, -0.38], left: [0.05, -0.1, -0.72], muzzle: -1 },
  shotgun: { right: [0.13, -0.14, -0.38], left: [0.05, -0.12, -0.74], muzzle: -0.98 },
  sniper: { right: [0.13, -0.14, -0.36], left: [0.05, -0.1, -0.78], muzzle: -1.2 },
  portal: { right: [0.13, -0.14, -0.42], left: [0.05, -0.12, -0.6], muzzle: -0.7 },
  melee: { right: [0.18, -0.2, -0.46], left: [-0.2, -0.45, -0.12] },
  utility: { right: [0.16, -0.16, -0.5], left: [-0.2, -0.45, -0.12] },
  hack: { right: [0.16, -0.16, -0.5], left: [-0.2, -0.45, -0.12] },
};
const SHOULDER_R = [0.27, 0, 0];
const SHOULDER_L = [-0.27, 0, 0];

function heldParts(game) {
  if (game.heldParts) return game.heldParts;
  const THREE = game.THREE;
  const geos = new Map();
  const box = (w, h, d) => {
    const key = `${w},${h},${d}`;
    if (!geos.has(key)) {
      const geo = new THREE.BoxGeometry(w, h, d);
      game.geometries.push(geo);
      geos.set(key, geo);
    }
    return geos.get(key);
  };
  const make = (material) => {
    game.materialDisposables.push(material);
    return material;
  };
  const mats = {
    metal: make(new THREE.MeshLambertMaterial({ color: 0x4d555d })),
    dark: make(new THREE.MeshLambertMaterial({ color: 0x23262b })),
    wood: make(new THREE.MeshLambertMaterial({ color: 0x6a4630 })),
    edge: make(new THREE.MeshLambertMaterial({ color: 0xd5dbe2 })),
    bomb: make(new THREE.MeshLambertMaterial({ color: 0xff6a2a, emissive: 0xff4a1a, emissiveIntensity: 0.6 })),
    glow: make(new THREE.MeshLambertMaterial({ color: 0x9bfff0, emissive: 0x9bfff0, emissiveIntensity: 0.9 })),
    chip: make(new THREE.MeshLambertMaterial({ color: 0x143028, emissive: 0x39e07a, emissiveIntensity: 0.6 })),
    skin: make(new THREE.MeshLambertMaterial({ color: 0xe9d3c4 })),
    flash: make(new THREE.MeshBasicMaterial({ color: 0xfff1c2 })),
  };
  game.heldParts = { box, mats };
  return game.heldParts;
}

function buildHeld(game, name) {
  const { box, mats } = heldParts(game);
  const group = new game.THREE.Group();
  const add = (mat, w, h, d, x, y, z) => {
    const mesh = new game.THREE.Mesh(box(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  };
  const [gx, gy, gz] = HELD[name].right;
  if (name === 'pistol') {
    add(mats.dark, 0.05, 0.07, 0.22, gx, gy + 0.05, gz - 0.08);
    add(mats.metal, 0.04, 0.1, 0.05, gx, gy - 0.02, gz);
  } else if (name === 'rifle') {
    add(mats.metal, 0.07, 0.1, 0.5, gx, gy + 0.05, gz - 0.14);
    add(mats.dark, 0.03, 0.03, 0.22, gx, gy + 0.07, gz - 0.48);
    add(mats.dark, 0.06, 0.16, 0.07, gx, gy - 0.06, gz - 0.12);
    add(mats.dark, 0.06, 0.1, 0.22, gx, gy + 0.03, gz + 0.16);
  } else if (name === 'shotgun') {
    add(mats.metal, 0.07, 0.08, 0.7, gx, gy + 0.05, gz - 0.22);
    add(mats.wood, 0.08, 0.07, 0.16, gx, gy + 0.02, gz - 0.38);
    add(mats.wood, 0.06, 0.1, 0.24, gx, gy + 0.02, gz + 0.16);
  } else if (name === 'sniper') {
    add(mats.dark, 0.06, 0.08, 0.6, gx, gy + 0.05, gz - 0.12);
    add(mats.metal, 0.035, 0.035, 0.42, gx, gy + 0.06, gz - 0.6);
    add(mats.metal, 0.06, 0.06, 0.26, gx, gy + 0.14, gz - 0.14);
    add(mats.dark, 0.06, 0.1, 0.24, gx, gy + 0.03, gz + 0.22);
  } else if (name === 'portal') {
    add(mats.dark, 0.1, 0.12, 0.26, gx, gy + 0.04, gz - 0.06);
    add(mats.glow, 0.07, 0.07, 0.06, gx, gy + 0.05, gz - 0.22);
  } else if (name === 'melee') {
    add(mats.dark, 0.035, 0.04, 0.1, gx, gy, gz);
    add(mats.edge, 0.015, 0.04, 0.24, gx, gy + 0.01, gz - 0.17);
  } else if (name === 'utility') {
    add(mats.bomb, 0.14, 0.09, 0.08, gx, gy + 0.03, gz - 0.04);
  } else if (name === 'hack') {
    add(mats.chip, 0.03, 0.08, 0.05, gx, gy + 0.04, gz - 0.03);
  }
  const muzzle = HELD[name].muzzle;
  group.userData.flash = muzzle == null ? null : add(mats.flash, 0.07, 0.07, 0.07, gx, gy + 0.06, muzzle);
  if (group.userData.flash) group.userData.flash.visible = false;
  group.visible = false;
  return group;
}

function makeArm(game, mat) {
  const { box, mats } = heldParts(game);
  const arm = new game.THREE.Mesh(box(0.11, 0.11, 1), mat);
  const hand = new game.THREE.Mesh(box(0.09, 0.09, 0.09), mats.skin);
  arm.raycast = () => {};
  hand.raycast = () => {};
  return { arm, hand };
}

function aimArm(game, limb, from, to) {
  const v = game._armV || (game._armV = new game.THREE.Vector3());
  const z = game._armZ || (game._armZ = new game.THREE.Vector3(0, 0, 1));
  v.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const len = v.length() || 0.01;
  limb.arm.scale.set(1, 1, len);
  limb.arm.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
  limb.arm.quaternion.setFromUnitVectors(z, v.multiplyScalar(1 / len));
  limb.hand.position.set(to[0], to[1], to[2]);
}

export function holdWeapon(game, holder, name) {
  const key = HELD[name] ? name : 'pistol';
  if (holder.weapon === key) return;
  holder.weapon = key;
  for (const [id, group] of Object.entries(holder.held)) group.visible = id === key;
  aimArm(game, holder.armR, SHOULDER_R, HELD[key].right);
  aimArm(game, holder.armL, SHOULDER_L, HELD[key].left);
}

export function attachHeldRig(game, body, armMat, shoulderY, weapon = 'pistol') {
  const rig = new game.THREE.Group();
  rig.position.set(0, shoulderY, 0);
  const armR = makeArm(game, armMat);
  const armL = makeArm(game, armMat);
  rig.add(armR.arm, armR.hand, armL.arm, armL.hand);
  const held = {};
  for (const name of Object.keys(HELD)) {
    held[name] = buildHeld(game, name);
    rig.add(held[name]);
  }
  body.add(rig);
  const holder = { rig, armR, armL, held, weapon: null };
  holdWeapon(game, holder, weapon);
  return holder;
}

export function heldFlash(holder) {
  return holder.held[holder.weapon]?.userData.flash || null;
}
