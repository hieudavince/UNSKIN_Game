import { doc, runTransaction } from 'firebase/firestore';
import { auth, firestore } from './config';
import { GUN_SKINS, SUITS, levelFromXp } from '../constants/weapons';

function uid() {
  const id = auth.currentUser?.uid;
  if (!id) throw new Error('Sign in required.');
  return id;
}

export async function grantMatchResult(match, playerId) {
  if (!match?.id || !playerId || !firestore) return;
  const key = `unskin-award:${match.id}:${playerId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* ignore */
  }
  const atlas = match.teams?.ATLAS?.playerIds || [];
  const mine = atlas.includes(playerId) ? 'ATLAS' : 'OUTLIERS';
  // FFA: only the top fragger wins (stored by the host as ffaWinner).
  const won = match.mode === 'FFA' ? match.ffaWinner === playerId : match.winner === mine;
  const xpGain = won ? 180 : 70;
  const pointsGain = won ? 120 : 30;
  const ref = doc(firestore, 'players', playerId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const stats = data.stats || {};
    const xp = Math.min(200000, (data.xp || 0) + xpGain);
    const prevLevel = data.level || levelFromXp(data.xp || 0);
    const level = levelFromXp(xp);
    const bonus = level > prevLevel ? 40 : 0;
    tx.update(ref, {
      xp,
      level,
      points: Math.min(80000, (data.points || 0) + pointsGain + bonus),
      stats: {
        matchesPlayed: (stats.matchesPlayed || 0) + 1,
        wins: (stats.wins || 0) + (won ? 1 : 0),
        losses: (stats.losses || 0) + (won ? 0 : 1),
        kills: stats.kills || 0,
        deaths: stats.deaths || 0,
        skinSynergyAssists: stats.skinSynergyAssists || 0,
      },
    });
  });
}

export async function buyCosmetic(kind, id) {
  const playerId = uid();
  const catalog = kind === 'gun' ? GUN_SKINS : SUITS;
  const item = catalog.find((entry) => entry.id === id);
  if (!item) throw new Error('Unknown item.');
  const field = kind === 'gun' ? 'ownedGuns' : 'ownedSuits';
  const equipped = kind === 'gun' ? 'gunSkin' : 'playerSkin';
  const ref = doc(firestore, 'players', playerId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Profile missing.');
    const data = snap.data();
    const owned = Array.isArray(data[field]) ? data[field].slice() : [catalog[0].id];
    if (owned.includes(id)) {
      tx.update(ref, { [equipped]: id });
      return;
    }
    const points = data.points || 0;
    if (points < item.price) throw new Error('Not enough points.');
    owned.push(id);
    tx.update(ref, {
      points: points - item.price,
      [field]: owned,
      [equipped]: id,
    });
  });
}

export async function equipCosmetic(kind, id) {
  const playerId = uid();
  const catalog = kind === 'gun' ? GUN_SKINS : SUITS;
  if (!catalog.some((entry) => entry.id === id)) return;
  const field = kind === 'gun' ? 'ownedGuns' : 'ownedSuits';
  const equipped = kind === 'gun' ? 'gunSkin' : 'playerSkin';
  const ref = doc(firestore, 'players', playerId);
  await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const owned = snap.data()[field] || [catalog[0].id];
    if (!owned.includes(id) && id !== catalog[0].id) throw new Error('Not owned.');
    tx.update(ref, { [equipped]: id });
  });
}
