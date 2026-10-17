export const GUNS = {
  pistol: {
    id: 'pistol', label: 'Pistol', price: 0,
    body: 22, head: 48, range: 46, interval: 260, pellets: 1,
    spread: 0.014, adsSpread: 0.004, zoom: 1.35, mag: 12, reserve: 36, reload: 3000,
  },
  rifle: {
    id: 'rifle', label: 'Rifle', price: 650,
    body: 18, head: 44, range: 78, interval: 105, pellets: 1,
    spread: 0.008, adsSpread: 0.002, zoom: 1.65, mag: 30, reserve: 90, reload: 3000,
  },
  shotgun: {
    id: 'shotgun', label: 'Shotgun', price: 500,
    body: 12, head: 16, range: 16, interval: 760, pellets: 7,
    spread: 0.09, adsSpread: 0.055, zoom: 1.22, mag: 6, reserve: 18, reload: 3000,
  },
  sniper: {
    id: 'sniper', label: 'Sniper', price: 800,
    body: 78, head: 140, range: 140, interval: 1150, pellets: 1,
    spread: 0.02, adsSpread: 0.0006, zoom: 3.3, mag: 5, reserve: 15, reload: 3000,
  },
};

export const GUN_LIST = [GUNS.rifle, GUNS.shotgun, GUNS.sniper];

export const BOMB_PRICE = 300;
export const AMMO_PRICE = 120;
export const ROUND_WIN_CREDITS = 1000;
export const ROUND_LOSS_CREDITS = 300;
export const MAX_CREDITS = 9000;

// accent = sights/stripes, metal/dark = receiver and barrel, body = polymer furniture.
export const GUN_SKINS = [
  { id: 'stock', label: 'Stock', price: 0, accent: 0x8fd6c8, metal: 0x4d555d, dark: 0x2a3036, body: 0x23262b },
  { id: 'night', label: 'Night', price: 400, accent: 0x7f8cff, metal: 0x2b2f45, dark: 0x16182a, body: 0x0f1018 },
  { id: 'brass', label: 'Brass', price: 700, accent: 0xe0b15a, metal: 0xb08a4a, dark: 0x5c4424, body: 0x3a2a1c },
  { id: 'mint', label: 'Mint', price: 900, accent: 0x7dffe8, metal: 0xd8ece6, dark: 0x5f8d84, body: 0xa9e3d6 },
];

export const SUITS = [
  { id: 'default', label: 'Default', price: 0, skin: 0xc99672, glove: 0x1a1e24 },
  { id: 'atlas', label: 'Atlas', price: 500, skin: 0xd8c6ae, glove: 0x1d3f86 },
  { id: 'outlier', label: 'Outlier', price: 500, skin: 0xd8c6ae, glove: 0x8a2e28 },
  { id: 'night', label: 'Night Ops', price: 800, skin: 0x8d735f, glove: 0x101114 },
];

export function gunSkinOf(id) {
  return GUN_SKINS.find((item) => item.id === id) || GUN_SKINS[0];
}

export function suitOf(id) {
  return SUITS.find((item) => item.id === id) || SUITS[0];
}

export function levelFromXp(xp) {
  return 1 + Math.floor(Math.max(0, xp || 0) / 400);
}

export function freshAmmo() {
  return {
    pistol: { mag: GUNS.pistol.mag, reserve: GUNS.pistol.reserve },
    rifle: { mag: 0, reserve: 0 },
    shotgun: { mag: 0, reserve: 0 },
    sniper: { mag: 0, reserve: 0 },
  };
}

export function fillAmmo(ammo, id) {
  const spec = GUNS[id];
  if (!spec || !ammo[id]) return;
  ammo[id].mag = spec.mag;
  ammo[id].reserve = spec.reserve;
}
