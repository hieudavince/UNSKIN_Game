// "Foundry Labs" — the objective map for Practice / 1v1 / 2v2 / 3v3 / 5v5.
// Atlas spawns in the south loading bay, Outliers in the north security hall.
// The uplink (Data-Extractor target) sits in the double-height server vault.
// Routes: central atrium (with a decon gate and an upper bridge), two wings with
// corridors + side labs on the ground floor, office floors upstairs with glass
// windows that overlook the vault and the atrium, and annexes beside the vault.
import { createKit } from './mapKit';

export const LAB_ID = 'foundry';

export function labMap() {
  const kit = createKit({ name: 'Foundry Labs', width: 72, depth: 100, levels: [0, 4], ceiling: 8 });
  const { wallX, wallZ, slab, rail, stairs, crate, fixture, light } = kit;
  kit.shell();

  const win = (at, w = 3) => ({ at, w, sill: 5, h: 1.6, fill: 'glass' });
  const upWin = (at, w = 4) => ({ at, w, sill: 1.0, h: 1.6, fill: 'glass' });

  // ── Big partitions shared by both halves ────────────────────────────────
  // Security hall (Outliers) ↔ vault row.
  wallX(-40, -35.5, 35.5, 0, {
    full: true,
    material: 'iron',
    name: 'sec-wall',
    openings: [
      { at: -22, w: 2.6 },
      { at: 0, w: 2.4, fill: 'glass' },
      { at: 22, w: 2.6 },
      win(-27), win(-16), win(16), win(27),
    ],
  });
  // Loading bay (Atlas) ↔ labs.
  wallX(36, -35.5, 35.5, 0, {
    full: true,
    material: 'iron',
    name: 'bay-wall',
    openings: [
      { at: -30, w: 2.6 },
      { at: -21, w: 3.76 },
      { at: 0, w: 4, h: 3.2 },
      { at: 21, w: 3.76 },
      { at: 30, w: 2.6 },
      win(-12, 4), win(12, 4),
    ],
  });
  // Server vault.
  for (const sx of [-1, 1]) {
    wallZ(sx * 10, -40, -26, 0, {
      full: true,
      material: 'iron',
      name: `vault-side-${sx < 0 ? 'w' : 'e'}`,
      openings: [{ at: -33, w: 2.4 }, win(-36.5), win(-29.5)],
    });
  }
  wallX(-26, -10, 10, 0, {
    full: true,
    material: 'iron',
    name: 'vault-front',
    openings: [{ at: 0, w: 3.6, h: 3.0 }, win(-5), win(5)],
  });

  // Atrium decon gate and the upper bridge.
  wallX(12, -8, 8, 0, {
    material: 'wood',
    name: 'decon',
    openings: [{ at: -4.5, w: 2.6 }, { at: 4.5, w: 2.6, fill: 'glass' }],
  });
  slab(1, -8, 8, -6, -2, { material: 'iron', name: 'bridge' });
  rail('x', -5.94, -7.88, 7.88, 4, { name: 'bridge-rail-n' });
  rail('x', -2.06, -7.88, 7.88, 4, { name: 'bridge-rail-s' });

  // ── Wings (mirrored with small variations) ──────────────────────────────
  const wing = (sx) => {
    const tag = sx < 0 ? 'w' : 'e';
    const X = (x) => sx * x;
    const east = sx > 0;
    const matA = east ? 'iron' : 'wood';
    const matB = east ? 'wood' : 'iron';

    slab(1, Math.min(X(10), X(35.5)), Math.max(X(10), X(35.5)), -40, -26, { material: 'iron', name: `up-annex-${tag}` });
    slab(1, Math.min(X(8), X(35.5)), Math.max(X(8), X(35.5)), -26, 36, { material: 'iron', name: `up-${tag}` });

    // ground floor
    wallZ(X(8), -26, 36, 0, {
      material: matA,
      name: `atr-${tag}`,
      openings: [
        { at: -14, w: 2.4, fill: east ? null : 'wood' },
        { at: 6, w: 3 },
        { at: 28, w: 2.4, fill: east ? 'glass' : null },
      ],
    });
    wallZ(X(19), -26, 36, 0, {
      material: matB,
      name: `cor-in-${tag}`,
      openings: [{ at: -13, w: 2.4 }, { at: 14, w: 2.4 }, { at: 27, w: 2.4 }],
    });
    wallZ(X(23), -26, 36, 0, {
      material: matA,
      name: `cor-out-${tag}`,
      openings: [{ at: -17, w: 2.4 }, { at: 3, w: 2.4, fill: 'glass' }, { at: 22, w: 2.4 }],
    });
    wallX(0, X(8), X(19), 0, { material: matB, name: `in-a-${tag}`, openings: [{ at: X(11), w: 2.4 }] });
    wallX(18, X(8), X(19), 0, { material: 'glass', name: `in-b-${tag}`, openings: [{ at: X(12), w: 2.4 }] });
    wallX(-8, X(23), X(35.5), 0, {
      material: matB, name: `out-a-${tag}`, openings: [{ at: X(31), w: 2.4, fill: east ? 'wood' : null }],
    });
    wallX(14, X(23), X(35.5), 0, { material: matA, name: `out-b-${tag}`, openings: [{ at: X(29), w: 2.4 }] });
    wallX(-26, X(10), X(35.5), 0, {
      material: matA,
      name: `annex-s-${tag}`,
      openings: [{ at: X(14), w: 2.4 }, { at: X(21), w: 3.76 }, { at: X(29), w: 2.4 }],
    });

    // upper floor
    wallZ(X(8), -26, 36, 1, {
      material: 'iron',
      name: `up-atr-${tag}`,
      openings: [{ at: -4, w: 3.6 }, upWin(-16), upWin(10), upWin(26)],
    });
    wallX(-26, X(10), X(35.5), 1, {
      material: matB, name: `up-annex-s-${tag}`, openings: [{ at: X(21), w: 3 }, { at: X(30), w: 2.4 }],
    });
    wallX(-8, X(8), X(35.5), 1, {
      material: matA, name: `up-a-${tag}`, openings: [{ at: X(14), w: 3 }, { at: X(29), w: 3 }],
    });
    wallX(14, X(8), X(35.5), 1, {
      material: matB,
      name: `up-b-${tag}`,
      openings: [{ at: X(12), w: 3 }, { at: X(26), w: 3, fill: east ? 'glass' : null }],
    });
    wallZ(X(23), -8, 14, 1, { material: 'glass', name: `up-c-${tag}`, openings: [{ at: 3, w: 3 }] });
    wallZ(X(20), 14, 36, 1, { material: matA, name: `up-d-${tag}`, openings: [{ at: 25, w: 2.6 }] });

    // stairs: stair lab, cold storage, annex
    stairs({ x: X(16), z: 3, dir: '+z', fromLevel: 0, toLevel: 1, name: `stair-lab-${tag}` });
    stairs({ x: X(32), z: 33, dir: '-z', fromLevel: 0, toLevel: 1, name: `stair-cold-${tag}` });
    stairs({ x: X(32), z: -37.5, dir: '+z', fromLevel: 0, toLevel: 1, name: `stair-annex-${tag}` });

    // props, ground floor
    crate(X(13.5), 0, -20, 3.0, 1.0, 1.0, 'iron', `bench-a-${tag}`);
    crate(X(13.5), 0, -8, 3.0, 1.0, 1.0, 'iron', `bench-b-${tag}`);
    crate(X(15), 0, 24, 1.2, 1.2, 1.2, 'wood', `ws-crate-${tag}`);
    crate(X(15), 1.2, 24, 0.9, 0.9, 0.9, 'wood', `ws-crate-top-${tag}`);
    crate(X(11), 0, 33, 2.4, 1.1, 0.8, 'iron', `ws-desk-${tag}`);
    crate(X(29), 0, -17, 2.4, 1.0, 1.2, 'iron', `chem-bench-${tag}`);
    crate(X(33.5), 0, -12, 1.2, 2.2, 2.4, 'iron', `chem-rack-${tag}`);
    crate(X(28), 0, 0, 1.4, 2.4, 1.4, 'glass', `tank-a-${tag}`);
    crate(X(32), 0, 6, 1.4, 2.4, 1.4, 'glass', `tank-b-${tag}`);
    crate(X(30), 0, -4, 1.0, 1.0, 1.0, 'wood', `spec-crate-${tag}`);
    crate(X(26), 0, 30, 1.2, 1.2, 1.2, 'wood', `cold-crate-${tag}`);
    crate(X(27), 0, 18, 1.0, 0.9, 1.0, 'wood', `cold-box-${tag}`);
    crate(X(14), 0, -36, 0.9, 2.4, 2.4, 'iron', `annex-rack-a-${tag}`);
    crate(X(18), 0, -30.5, 2.4, 2.4, 0.9, 'iron', `annex-rack-b-${tag}`);
    crate(X(25), 0, -35, 1.2, 1.2, 1.2, 'wood', `annex-crate-${tag}`);
    // props, upper floor
    crate(X(28), 4, -2, 1.2, 1.0, 1.2, 'wood', `up-crate-a-${tag}`);
    crate(X(14), 4, 24, 2.4, 1.1, 0.8, 'iron', `up-desk-${tag}`);
    crate(X(30), 4, 20, 1.0, 1.0, 1.0, 'wood', `up-crate-b-${tag}`);
    crate(X(18), 4, -20, 1.2, 1.2, 1.2, 'wood', `up-crate-c-${tag}`);
    crate(X(20), 4, -34, 1.2, 1.2, 1.2, 'iron', `up-annex-crate-${tag}`);
    crate(X(13), 4, -14, 2.4, 1.1, 0.8, 'wood', `up-desk-b-${tag}`);

    // light fixtures
    for (const [x, z] of [[13.5, -14], [13.5, 9], [13.5, 27], [29, -17], [29, 3], [27, 25], [21, -10], [21, 20], [22, -33]]) {
      fixture(X(x), 3.72, z, `fx-lo-${tag}-${x}-${z}`);
    }
    for (const [x, z] of [[14, -17], [26, -17], [14, 0], [28, 4], [14, 26], [28, 18], [22, -33]]) {
      fixture(X(x), 8, z, `fx-up-${tag}-${x}-${z}`);
    }
  };
  wing(-1);
  wing(1);

  // ── Open areas: atrium, vault, security, bay ────────────────────────────
  crate(0, 0, 21, 3, 2.4, 6, 'iron', 'container');
  crate(-5, 0, -14, 1.2, 1.2, 1.2, 'wood', 'atr-crate-a');
  crate(5, 0, -18, 1.2, 1.0, 1.2, 'wood', 'atr-crate-b');
  crate(3, 0, 2, 1.6, 1.1, 0.8, 'wood', 'atr-desk');
  crate(-3, 0, 28, 1.2, 1.2, 1.2, 'wood', 'atr-crate-c');
  crate(-5.5, 0, -30, 1.2, 2.2, 2.4, 'iron', 'vault-rack-w');
  crate(5.5, 0, -30, 1.2, 2.2, 2.4, 'iron', 'vault-rack-e');
  crate(-6, 0, -37, 1.2, 1.2, 1.2, 'wood', 'vault-crate-a');
  crate(6.5, 0, -37.5, 1.0, 1.0, 1.0, 'wood', 'vault-crate-b');
  crate(-9, 0, -46, 1.2, 1.2, 1.2, 'wood', 'sec-crate-a');
  crate(9, 0, -46, 1.2, 1.2, 1.2, 'wood', 'sec-crate-b');
  crate(-28, 0, -44, 2.4, 1.1, 0.8, 'iron', 'sec-desk-w');
  crate(28, 0, -44, 2.4, 1.1, 0.8, 'iron', 'sec-desk-e');
  crate(-18, 0, -47, 1.2, 2.2, 2.4, 'iron', 'sec-locker-w');
  crate(18, 0, -47, 1.2, 2.2, 2.4, 'iron', 'sec-locker-e');
  crate(-8, 0, 41, 1.2, 1.2, 1.2, 'wood', 'bay-crate-a');
  crate(8, 0, 41, 1.2, 1.2, 1.2, 'wood', 'bay-crate-b');
  crate(-14, 0, 46, 2.4, 1.0, 1.2, 'iron', 'bay-pallet-w');
  crate(14, 0, 46, 2.4, 1.0, 1.2, 'iron', 'bay-pallet-e');
  crate(-26, 0, 44, 1.2, 1.2, 1.2, 'wood', 'bay-crate-c');
  crate(26, 0, 43, 1.2, 1.2, 1.2, 'wood', 'bay-crate-d');
  crate(26, 1.2, 43, 0.9, 0.9, 0.9, 'wood', 'bay-crate-e');

  // Objective: the uplink console (Atlas installs the extractor chip here).
  kit.add({
    list: 'props', kind: 'prop', name: 'uplink', material: 'console', paint: false, style: 'console',
    carve: false, priority: 9, hackable: true, uplink: true,
    minX: -0.8, maxX: 0.8, minY: 0, maxY: 1.8, minZ: -34.35, maxZ: -33.65,
  });
  kit.add({
    list: 'props', kind: 'wall', name: 'uplink-mast', style: 'accent', carve: false, priority: 9,
    minX: -0.06, maxX: 0.06, minY: 1.8, maxY: 3.2, minZ: -34.06, maxZ: -33.94,
  });
  kit.decor.push(
    { type: 'stand', minX: 1.66, maxX: 1.74, minY: 0, maxY: 1.11, minZ: -34.04, maxZ: -33.96 },
    { type: 'bezel', minX: 1.33, maxX: 2.07, minY: 1.11, maxY: 1.59, minZ: -34.035, maxZ: -33.965 },
  );
  kit.screen = { x: 1.7, y: 1.35, z: -33.96, facing: 'z' };

  // ceiling fixtures for the tall rooms
  for (const [x, z] of [[-14, 43], [14, 43], [0, 46], [-14, -45], [14, -45], [0, -48], [0, -33], [0, -14], [0, 6], [0, 28]]) {
    fixture(x, 8, z, `fx-hall-${x}-${z}`);
  }
  light(0, 6.5, 43, 0xffe1c2, 0.75, 24);
  light(0, 6.5, -45, 0x9ef6e4, 0.75, 24);
  light(0, 6.6, -33, 0x7dffe8, 0.9, 16);
  light(0, 6.8, -8, 0xd5e4ff, 0.55, 22);
  light(0, 6.8, 22, 0xffe9d0, 0.55, 22);
  light(-21, 3.0, 0, 0xffe1c2, 0.45, 20);
  light(21, 3.0, 0, 0xc6d8ff, 0.45, 20);
  light(0, 7.4, -20, 0xd5e4ff, 0.35, 40);

  const boxes = kit.finalize();
  return {
    id: LAB_ID,
    name: kit.name,
    levels: kit.levels,
    ceiling: kit.ceiling,
    bounds: { minX: -36, maxX: 36, minZ: -50, maxZ: 50 },
    boxes,
    decor: kit.decor,
    screen: kit.screen,
    lights: kit.lights,
    reserved: kit.reserved,
    fog: { near: 40, far: 130 },
    spawns: {
      atlas: { x: 0, y: 0, z: 43, yaw: 0 },
      outliers: { x: 0, y: 0, z: -45, yaw: Math.PI },
    },
    teamSpread: 1.6,
    ffaSpawns: [
      { x: 0, y: 0, z: 43, yaw: 0 },
      { x: 0, y: 0, z: -45, yaw: Math.PI },
      { x: -21, y: 0, z: 5, yaw: 0 },
      { x: 21, y: 0, z: -5, yaw: Math.PI },
      { x: -26, y: 4, z: 0, yaw: Math.PI / 2 },
      { x: 26, y: 4, z: 0, yaw: -Math.PI / 2 },
    ],
  };
}
