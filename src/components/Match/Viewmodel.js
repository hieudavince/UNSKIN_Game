const PORTAL_COLORS = {
  glass: 0x9bfff0,
  wood: 0xc4844a,
  iron: 0xd7dee6,
};

function remember(game, geo) {
  game.geometries.push(geo);
  return geo;
}

function part(game, parent, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const geo = remember(game, new game.THREE.BoxGeometry(w, h, d));
  const mesh = new game.THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.raycast = () => {};
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

function tube(game, parent, mat, radius, length, x, y, z, along = 'z') {
  const geo = remember(game, new game.THREE.CylinderGeometry(radius, radius, length, 12));
  const mesh = new game.THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  if (along === 'z') mesh.rotation.x = Math.PI / 2;
  if (along === 'x') mesh.rotation.z = Math.PI / 2;
  mesh.raycast = () => {};
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

function makeHand(game, mats, side) {
  const hand = new game.THREE.Group();
  const s = side;
  part(game, hand, mats.skin, 0.084, 0.042, 0.1, s * 0.01, 0, 0.01);
  part(game, hand, mats.glove, 0.09, 0.048, 0.045, s * 0.01, -0.004, 0.07);
  part(game, hand, mats.glove, 0.038, 0.032, 0.07, s * 0.01, -0.01, 0.11, 0.45, 0, s * 0.12);
  for (let i = 0; i < 4; i += 1) {
    const x = s * (-0.03 + i * 0.02);
    part(game, hand, mats.skin, 0.018, 0.022, 0.042, x, -0.002, -0.055, 0.4, 0, 0);
    part(game, hand, mats.skin, 0.016, 0.018, 0.026, x, -0.01, -0.088, 0.75, 0, 0);
  }
  part(game, hand, mats.skin, 0.022, 0.02, 0.046, s * 0.052, 0.008, -0.008, 0.35, 0, s * -0.8);
  part(game, hand, mats.skin, 0.018, 0.016, 0.028, s * 0.07, 0, -0.03, 0.85, 0, s * -0.45);
  hand.scale.setScalar(1.22);
  return hand;
}

function buildRifle(game, mats) {
  const gun = new game.THREE.Group();
  part(game, gun, mats.metal, 0.048, 0.064, 0.26, 0, 0.02, -0.02);
  part(game, gun, mats.metalDark, 0.046, 0.07, 0.2, 0, 0.01, 0.2);
  part(game, gun, mats.polymer, 0.038, 0.09, 0.05, 0, 0.02, 0.32);
  tube(game, gun, mats.metal, 0.011, 0.42, 0, 0.038, -0.34);
  tube(game, gun, mats.metalDark, 0.016, 0.045, 0, 0.038, -0.56);
  part(game, gun, mats.polymer, 0.04, 0.048, 0.18, 0, 0.012, -0.2);
  part(game, gun, mats.metalDark, 0.026, 0.12, 0.04, 0, -0.075, 0.01, 0.22);
  part(game, gun, mats.polymer, 0.032, 0.1, 0.042, 0, -0.04, 0.09, 0.42);
  part(game, gun, mats.metal, 0.014, 0.018, 0.2, 0, 0.058, -0.12);
  part(game, gun, mats.accent, 0.01, 0.03, 0.01, 0, 0.072, -0.28);
  part(game, gun, mats.accent, 0.01, 0.022, 0.014, 0, 0.062, 0.02);
  const flash = part(game, gun, mats.flash, 0.028, 0.028, 0.05, 0, 0.038, -0.6);
  flash.visible = false;

  part(game, gun, mats.skin, 0.036, 0.078, 0.05, 0.038, -0.03, 0.09);
  part(game, gun, mats.glove, 0.04, 0.04, 0.05, 0.04, -0.07, 0.12);
  part(game, gun, mats.skin, 0.04, 0.016, 0.028, -0.012, -0.01, 0.1);
  part(game, gun, mats.skin, 0.04, 0.016, 0.028, -0.012, -0.028, 0.095);
  part(game, gun, mats.skin, 0.04, 0.016, 0.028, -0.012, -0.046, 0.088);
  part(game, gun, mats.skin, 0.034, 0.015, 0.026, -0.01, -0.062, 0.08);
  part(game, gun, mats.skin, 0.02, 0.016, 0.042, 0.012, 0.012, 0.07);

  part(game, gun, mats.skin, 0.072, 0.026, 0.055, 0.006, 0.048, -0.18);
  part(game, gun, mats.skin, 0.014, 0.016, 0.05, -0.024, 0.04, -0.24);
  part(game, gun, mats.skin, 0.014, 0.016, 0.052, -0.008, 0.04, -0.245);
  part(game, gun, mats.skin, 0.014, 0.016, 0.05, 0.008, 0.04, -0.24);
  part(game, gun, mats.skin, 0.013, 0.015, 0.044, 0.023, 0.038, -0.23);
  part(game, gun, mats.skin, 0.016, 0.014, 0.04, 0.046, 0.042, -0.17);

  gun.userData.flash = flash;
  return gun;
}

function buildPortal(game, mats) {
  const gun = new game.THREE.Group();
  part(game, gun, mats.polymer, 0.07, 0.09, 0.16, 0, 0, 0.02);
  part(game, gun, mats.metal, 0.055, 0.05, 0.1, 0, 0.01, -0.1);
  tube(game, gun, mats.metalDark, 0.02, 0.12, 0, 0.015, -0.2);
  const emitterMat = new game.THREE.MeshLambertMaterial({
    color: PORTAL_COLORS.glass,
    emissive: PORTAL_COLORS.glass,
    emissiveIntensity: 0.9,
  });
  game.materialDisposables.push(emitterMat);
  const emitter = part(game, gun, emitterMat, 0.046, 0.046, 0.05, 0, 0.02, -0.27);
  part(game, gun, mats.accent, 0.02, 0.03, 0.01, 0.04, 0.03, 0.02);
  part(game, gun, mats.metalDark, 0.02, 0.08, 0.03, 0, -0.07, 0.04, 0.4);

  const right = makeHand(game, mats, 1);
  right.position.set(0.03, -0.06, 0.04);
  right.rotation.set(0.85, 0.2, 0.25);
  gun.add(right);
  const left = makeHand(game, mats, -1);
  left.position.set(-0.02, -0.03, -0.08);
  left.rotation.set(1.05, 0, -0.2);
  gun.add(left);
  gun.userData.emitterMat = emitterMat;
  gun.userData.emitter = emitter;
  return gun;
}

function buildMelee(game, mats) {
  const knife = new game.THREE.Group();
  part(game, knife, mats.edge, 0.012, 0.028, 0.2, 0, 0.01, -0.16);
  part(game, knife, mats.metal, 0.004, 0.04, 0.18, 0.01, 0.012, -0.15);
  part(game, knife, mats.metalDark, 0.03, 0.012, 0.04, 0, 0, -0.04);
  part(game, knife, mats.polymer, 0.02, 0.028, 0.09, 0, -0.01, 0.04);
  part(game, knife, mats.accent, 0.022, 0.01, 0.012, 0, -0.01, 0.0);
  const right = makeHand(game, mats, 1);
  right.position.set(0.01, -0.035, 0.05);
  right.rotation.set(1.2, 0.4, 0.1);
  knife.add(right);
  return knife;
}

function buildUtility(game, mats) {
  const tool = new game.THREE.Group();
  tube(game, tool, mats.polymer, 0.028, 0.14, 0, 0, -0.02, 'y');
  tube(game, tool, mats.metal, 0.032, 0.03, 0, 0.07, -0.02, 'y');
  const lens = part(game, tool, mats.flash, 0.02, 0.02, 0.012, 0, 0.145, -0.02);
  part(game, tool, mats.accent, 0.01, 0.02, 0.04, 0.03, 0.02, -0.02);
  const right = makeHand(game, mats, 1);
  right.position.set(0.03, -0.02, 0.01);
  right.rotation.set(0.4, 0.3, 0.5);
  tool.add(right);
  const left = makeHand(game, mats, -1);
  left.position.set(-0.04, -0.01, 0.0);
  left.rotation.set(0.5, -0.2, -0.4);
  tool.add(left);
  tool.userData.lens = lens;
  return tool;
}

function buildChip(game, mats) {
  const rig = new game.THREE.Group();
  part(game, rig, mats.chip, 0.018, 0.055, 0.034, 0, 0.02, -0.04);
  part(game, rig, mats.edge, 0.01, 0.008, 0.028, -0.004, 0.0, -0.04);
  part(game, rig, mats.accent, 0.006, 0.012, 0.012, 0.006, 0.03, -0.04);
  const right = makeHand(game, mats, 1);
  right.position.set(0.02, -0.03, 0.0);
  right.rotation.set(1.0, 0.5, 0.4);
  rig.add(right);
  return rig;
}

export function createViewmodel(game) {
  const { THREE, camera } = game;
  const make = (material) => {
    game.materialDisposables.push(material);
    return material;
  };
  const mats = {
    skin: make(new THREE.MeshLambertMaterial({ color: 0xc99672 })),
    glove: make(new THREE.MeshLambertMaterial({ color: 0x1a1e24 })),
    metal: make(new THREE.MeshLambertMaterial({ color: 0x4d555d })),
    metalDark: make(new THREE.MeshLambertMaterial({ color: 0x2a3036 })),
    polymer: make(new THREE.MeshLambertMaterial({ color: 0x23262b })),
    accent: make(new THREE.MeshLambertMaterial({ color: 0x8fd6c8, emissive: 0x1c4a44, emissiveIntensity: 0.6 })),
    edge: make(new THREE.MeshLambertMaterial({ color: 0xd5dbe2, emissive: 0x22262c, emissiveIntensity: 0.25 })),
    flash: make(new THREE.MeshBasicMaterial({ color: 0xfff1c2 })),
    chip: make(new THREE.MeshLambertMaterial({ color: 0x143028, emissive: 0x0d3a2c, emissiveIntensity: 0.5 })),
  };

  const root = new THREE.Group();
  root.frustumCulled = false;
  const rifle = buildRifle(game, mats);
  const portal = buildPortal(game, mats);
  const melee = buildMelee(game, mats);
  const utility = buildUtility(game, mats);
  const hack = buildChip(game, mats);
  rifle.position.set(0.26, -0.24, -0.48);
  rifle.rotation.set(0.06, 0.22, -0.04);
  portal.position.set(0.22, -0.22, -0.42);
  portal.rotation.set(0.08, 0.2, -0.02);
  melee.position.set(0.22, -0.16, -0.38);
  melee.rotation.set(0.2, 0.15, 0.05);
  utility.position.set(0.2, -0.18, -0.4);
  utility.rotation.set(-0.4, 0.15, 0.1);
  hack.position.set(0.18, -0.16, -0.36);
  hack.rotation.set(0.5, -0.2, 0.1);
  root.add(rifle, portal, melee, utility, hack);
  camera.add(root);

  const lamp = new THREE.PointLight(0xfff4e5, 0.45, 2.8, 2);
  lamp.position.set(0, 0, -0.2);
  root.add(lamp);

  game.view = {
    root,
    groups: { rifle, portal, melee, utility, hack },
    emitterMat: portal.userData.emitterMat,
    flash: rifle.userData.flash,
    lens: utility.userData.lens,
    muzzle: 0,
    kick: 0,
    swing: 0,
    pulse: 0,
    equip: 1,
    bob: 0,
    swayX: 0,
    swayY: 0,
    base: {
      rifle: rifle.position.clone(),
      portal: portal.position.clone(),
      melee: melee.position.clone(),
      utility: utility.position.clone(),
      hack: hack.position.clone(),
    },
    baseRot: {
      rifle: rifle.rotation.clone(),
      portal: portal.rotation.clone(),
      melee: melee.rotation.clone(),
      utility: utility.rotation.clone(),
      hack: hack.rotation.clone(),
    },
  };
  showWeapon(game, 'rifle');
  syncEmitter(game);
}

export function showWeapon(game, name) {
  const view = game.view;
  if (!view) return;
  for (const [key, group] of Object.entries(view.groups)) {
    group.visible = key === name;
  }
  view.equip = 0;
}

export function syncEmitter(game) {
  const mat = game.view && game.view.emitterMat;
  if (!mat) return;
  const hex = PORTAL_COLORS[game.portalMaterial] || PORTAL_COLORS.glass;
  mat.color.setHex(hex);
  mat.emissive.setHex(hex);
}

export function updateViewmodel(game, dt) {
  const view = game.view;
  if (!view) return;
  const mode = game.mode;
  const speed = Math.hypot(game.player.vx, game.player.vz);
  const moving = game.player.onGround ? Math.min(speed / 6, 1) : 0;
  view.bob += dt * (moving > 0.05 ? 9 : 1.6);
  view.equip = Math.min(1, view.equip + dt * 5.5);
  view.kick = Math.max(0, view.kick - dt * 8);
  view.swing = Math.max(0, view.swing - dt * 2.1);
  view.throwing = Math.max(0, (view.throwing || 0) - dt * 2.4);
  view.pulse = Math.max(0, view.pulse - dt * 2.2);
  view.muzzle = Math.max(0, view.muzzle - dt);
  view.swayX += ((game.input.lookX || 0) * 0.002 - view.swayX) * Math.min(1, dt * 8);
  view.swayY += ((game.input.lookY || 0) * 0.002 - view.swayY) * Math.min(1, dt * 8);
  game.input.lookX = 0;
  game.input.lookY = 0;

  const group = view.groups[mode];
  if (!group) return;
  const base = view.base[mode];
  const rot = view.baseRot[mode];
  const drop = (1 - view.equip) * 0.28;
  const bobY = Math.sin(view.bob) * 0.012 * moving;
  const bobX = Math.cos(view.bob * 0.5) * 0.008 * moving;
  const swinging = mode === 'melee' && view.swing > 0;
  const t = swinging ? 1 - view.swing : 0;
  const slash = swinging ? Math.sin(t * Math.PI) : 0;
  const throwing = mode === 'utility' ? view.throwing : 0;
  group.position.set(
    base.x + bobX - view.swayX * 0.35 + (swinging ? -0.08 * slash : 0),
    base.y + bobY - drop - view.kick * 0.03 - view.swayY * 0.2 + (throwing * 0.06),
    base.z + view.kick * 0.04 - slash * 0.12 - throwing * 0.16,
  );
  group.rotation.set(
    rot.x + view.swayY * 0.35 + view.kick * 0.08 + (swinging ? (-1.1 + t * 2.3) : 0) - throwing * 1.3,
    rot.y + view.swayX * 0.45 + (swinging ? (-0.8 + t * 1.6) : 0),
    rot.z + (swinging ? (0.2 - t * 1.3) : 0),
  );
  if (view.flash) view.flash.visible = view.muzzle > 0;
  if (view.lens) {
    const hot = 0.35 + Math.sin(view.bob * 3) * 0.15 + view.pulse * 0.8;
    view.lens.scale.setScalar(1 + view.pulse * 0.6);
    view.lens.material.color.setRGB(hot, hot * 0.96, hot * 0.75);
  }
}

export function portalColor(name) {
  return PORTAL_COLORS[name] || PORTAL_COLORS.glass;
}
