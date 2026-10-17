// Locker preview renderer. One shared, offscreen three.js renderer draws the
// real in-game weapon/hand models with the chosen skin, then the pixels are
// copied into ordinary 2D canvases (thumbnails + a turntable), so the lobby
// never holds more than one WebGL context. If WebGL is unavailable a flat
// colour swatch is drawn instead.
import { loadThree } from '../../three/loadThree';
import { WEAPON_BUILDERS, weaponMaterials } from '../Match/Viewmodel';

let shared = null;
let failed = false;

async function ensure() {
  if (shared || failed) return shared;
  try {
    const THREE = await loadThree();
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xbfd0e6, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(1.2, 1.6, 1.4);
    const rim = new THREE.DirectionalLight(0x7dffe8, 0.55);
    rim.position.set(-1.5, 0.6, -1.2);
    scene.add(key, rim);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    shared = { THREE, renderer, scene, camera, models: new Map() };
  } catch {
    failed = true;
  }
  return shared;
}

function modelFor(ctx, kind, gun, suit) {
  const id = `${kind}:${gun?.id}:${suit?.id}`;
  if (ctx.models.has(id)) return ctx.models.get(id);
  const { THREE } = ctx;
  const fake = { THREE, geometries: [] };
  const mats = weaponMaterials(THREE, { gun, suit });
  const root = new THREE.Group();
  if (kind === 'gun') {
    const rifle = WEAPON_BUILDERS.rifle(fake, mats);
    rifle.rotation.set(0, Math.PI / 2, 0);
    // gun skins: show the bare weapon, without the viewmodel's hand/glove parts
    const handParts = [];
    rifle.traverse((node) => {
      if (node !== rifle && (node.isGroup || node.material === mats.skin || node.material === mats.glove)) handParts.push(node);
    });
    handParts.forEach((node) => node.parent && node.parent.remove(node));
    root.add(rifle);
  } else {
    // suits change the hands: show both hands holding the pistol
    const pistol = WEAPON_BUILDERS.pistol(fake, mats);
    pistol.rotation.set(0, Math.PI / 2, 0);
    pistol.scale.setScalar(1.3);
    root.add(pistol);
    const left = WEAPON_BUILDERS.hand(fake, mats, -1);
    left.position.set(0.02, -0.02, -0.16);
    left.rotation.set(0.4, 1.2, 0.2);
    left.scale.setScalar(1.6);
    root.add(left);
  }
  root.traverse((node) => { node.frustumCulled = false; });
  // frame only what is visible (hidden muzzle flashes would skew the centre)
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((node) => {
    let shown = node.visible;
    for (let p = node.parent; p && shown; p = p.parent) shown = p.visible;
    if (node.isMesh && shown) box.expandByObject(node);
  });
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  root.position.sub(center);
  const holder = new THREE.Group();
  holder.add(root);
  const model = { holder, radius: Math.max(size.x, size.y, size.z) * 0.62 };
  ctx.models.set(id, model);
  return model;
}

function swatch(target, kind, gun, suit) {
  const g = target.getContext('2d');
  const hex = (n) => `#${(n ?? 0).toString(16).padStart(6, '0')}`;
  g.clearRect(0, 0, target.width, target.height);
  const colors = kind === 'gun' ? [gun.body, gun.metal, gun.dark, gun.accent] : [suit.glove, suit.skin];
  const w = target.width / colors.length;
  colors.forEach((c, i) => {
    g.fillStyle = hex(c);
    g.fillRect(i * w, target.height * 0.3, w, target.height * 0.4);
  });
}

// Draw one frame of the preview into a 2D canvas.
export async function drawPreview(target, { kind, gun, suit, angle = 0.6, tilt = 0.18 }) {
  const ctx = await ensure();
  if (!ctx) {
    swatch(target, kind, gun, suit);
    return false;
  }
  const { renderer, scene, camera } = ctx;
  const w = target.width;
  const h = target.height;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const model = modelFor(ctx, kind, gun, suit);
  scene.add(model.holder);
  model.holder.rotation.set(tilt, angle, 0);
  const dist = model.radius / Math.tan((camera.fov * Math.PI) / 360) * (camera.aspect < 1 ? 1.0 / camera.aspect : 0.55);
  camera.position.set(0, model.radius * 0.25, dist);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  scene.remove(model.holder);
  const g = target.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.drawImage(renderer.domElement, 0, 0, w, h);
  return true;
}
