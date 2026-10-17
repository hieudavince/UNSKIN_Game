import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { onDisconnect, onValue, ref, remove, serverTimestamp as rtdbStamp, set, update } from 'firebase/database';
import { auth, firestore, rtdb, serverNow } from './config';
import { openLiveMatch } from './matchService';
import { DRAFT_MS, mapIdOf, modeOf, phaseMs } from '../constants/modes';

function uid() {
  const id = auth.currentUser?.uid;
  if (!id) throw new Error('Sign in required.');
  return id;
}

function playerRef(id) {
  return doc(firestore, 'players', id);
}

export async function ensurePlayer(displayName) {
  const id = uid();
  const ref0 = playerRef(id);
  const snap = await getDoc(ref0);
  const nextName = String(displayName || snap.data()?.displayName || 'Player').trim().slice(0, 24) || 'Player';
  if (!snap.exists()) {
    const player = {
      uid: id,
      displayName: nextName,
      createdAt: serverTimestamp(),
      tcMmr: 1000,
      credits: 800,
      pendingMatchId: null,
      points: 0,
      xp: 0,
      level: 1,
      gunSkin: 'stock',
      playerSkin: 'default',
      ownedGuns: ['stock'],
      ownedSuits: ['default'],
      stats: { matchesPlayed: 0, wins: 0, losses: 0, kills: 0, deaths: 0, skinSynergyAssists: 0 },
    };
    await setDoc(ref0, player);
    return { ...player, displayName: nextName };
  }
  if (displayName && snap.data().displayName !== nextName) {
    await updateDoc(ref0, { displayName: nextName });
  }
  return { uid: id, ...snap.data(), displayName: nextName };
}

export function queueKey(mode, ranked) {
  const info = modeOf(mode);
  return `${info.id}_${ranked && info.players > 1 && !info.ffa ? 'R' : 'C'}`;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function splitTeams(group, teamSize, ffa) {
  // FFA: nobody has a team; everyone sits in the ATLAS bucket.
  if (ffa) return { ATLAS: group.map((entry) => entry.uid), OUTLIERS: [] };
  if (teamSize <= 0 || group.length === 1) return { ATLAS: [group[0].uid], OUTLIERS: [] };
  const sorted = group.slice().sort((a, b) => (b.mmr || 1000) - (a.mmr || 1000) || a.uid.localeCompare(b.uid));
  const atlas = [];
  const outliers = [];
  sorted.forEach((entry, index) => {
    const lane = index % 4;
    (lane === 0 || lane === 3 ? atlas : outliers).push(entry.uid);
  });
  while (atlas.length > teamSize) outliers.push(atlas.pop());
  while (outliers.length > teamSize) atlas.push(outliers.pop());
  return { ATLAS: atlas, OUTLIERS: outliers };
}

let active = null;

async function createMatch(state, group) {
  const me = uid();
  const info = modeOf(state.mode);
  const ranked = state.ranked && info.players > 1 && !info.ffa;
  const id = `${state.key}_${group[0].at}_${hash(group.map((entry) => entry.uid).join('|'))}`;
  const teams = splitTeams(group, info.teamSize, info.ffa);
  const names = {};
  group.forEach((entry) => { names[entry.uid] = String(entry.name || 'Player').slice(0, 24); });
  const now = serverNow();
  const memberIds = {};
  const players = {};
  for (const entry of group) {
    memberIds[entry.uid] = true;
    players[entry.uid] = {
      name: names[entry.uid],
      faction: teams.ATLAS.includes(entry.uid) ? 'ATLAS' : 'OUTLIERS',
      alive: true,
      hp: 100,
      kills: 0,
      deaths: 0,
    };
  }
  const phase = ranked ? 'DRAFT' : 'BUY';
  const phaseEndsAtMs = ranked ? now + DRAFT_MS : now + phaseMs(info.id, 'BUY');
  await openLiveMatch(id, {
    hostId: me,
    memberIds,
    players,
    mode: info.id,
    phase,
    phaseEndsAtMs,
    currentRound: 1,
    score: { ATLAS: 0, OUTLIERS: 0 },
    lastRound: null,
    mapId: mapIdOf(info.id),
  });
  if (ranked) {
    await set(ref(rtdb, `drafts/${id}`), {
      hostId: me,
      memberIds,
      picks: {},
      draftEndsAtMs: phaseEndsAtMs,
    });
  }
  return runTransaction(firestore, async (tx) => {
    const matchRef = doc(firestore, 'matches', id);
    const existing = await tx.get(matchRef);
    if (existing.exists()) return null;
    const snaps = [];
    for (const entry of group) snaps.push(await tx.get(playerRef(entry.uid)));
    if (snaps.some((snap) => !snap.exists() || snap.data().pendingMatchId)) return null;
    tx.set(matchRef, {
      createdAt: serverTimestamp(),
      mapId: mapIdOf(info.id),
      mode: info.id,
      ranked,
      teamSize: info.teamSize,
      playerIds: group.map((entry) => entry.uid),
      hostId: me,
      teams: { ATLAS: { playerIds: teams.ATLAS }, OUTLIERS: { playerIds: teams.OUTLIERS } },
      names,
      bannedMaterials: { ATLAS: null, OUTLIERS: null },
      picks: {},
      finalScore: { ATLAS: 0, OUTLIERS: 0 },
      winner: null,
      pendingWinner: null,
      status: ranked ? 'DRAFTING' : 'IN_PROGRESS',
      phase: ranked ? null : 'BUY',
      phaseEndsAtMs: ranked ? null : phaseEndsAtMs,
      draftEndsAtMs: ranked ? phaseEndsAtMs : null,
      currentRound: 1,
    });
    for (const entry of group) tx.update(playerRef(entry.uid), { pendingMatchId: id });
    return id;
  });
}

const STALE_MS = 20000;
const BEAT_MS = 6000;

function handleQueue(state, value) {
  const me = auth.currentUser?.uid;
  state.last = value;
  const now = serverNow();
  const entries = Object.entries(value || {})
    .map(([id, entry]) => ({ uid: id, ...entry }))
    .filter((entry) => typeof entry.at === 'number')
    .filter((entry) => entry.uid === me || now - (entry.seen || entry.at) < STALE_MS)
    .sort((a, b) => a.at - b.at || a.uid.localeCompare(b.uid));
  const info = modeOf(state.mode);
  const need = info.players;
  state.onState?.({
    count: entries.length, need, min: info.minPlayers || need, names: entries.map((entry) => entry.name),
  });
  if (state.busy) return;
  // FFA can start before the lobby is full: 2+ players and the oldest waited long enough.
  let size = need;
  if (entries.length < need) {
    const waited = entries.length ? now - entries[0].at : 0;
    if (!info.minPlayers || entries.length < info.minPlayers || waited < (info.fillWaitMs || 0)) return;
    size = entries.length;
  }
  const group = entries.slice(0, size);
  if (group[0].uid !== me) return;
  const tag = group.map((entry) => entry.uid).join('|') + group[0].at;
  if (state.tried === tag) return;
  state.tried = tag;
  state.busy = true;
  createMatch(state, group)
    .then((id) => {
      if (!id) state.tried = '';
    })
    .catch((error) => {
      state.tried = '';
      state.onState?.({ count: entries.length, need, error: error.message || String(error) });
    })
    .finally(() => {
      state.busy = false;
    });
}

export async function joinQueue(mode, ranked, onState) {
  const id = uid();
  const player = await getDoc(playerRef(id));
  if (!player.exists()) throw new Error('Create a player first.');
  if (player.data().pendingMatchId) return { status: 'ALREADY', matchId: player.data().pendingMatchId };
  await leaveQueue();
  const key = queueKey(mode, ranked);
  const entryRef = ref(rtdb, `queue/${key}/${id}`);
  await onDisconnect(entryRef).remove();
  await set(entryRef, {
    name: String(player.data().displayName || 'Player').slice(0, 24),
    mmr: player.data().tcMmr || 1000,
    at: rtdbStamp(),
    seen: rtdbStamp(),
  });
  const state = { key, mode, ranked: !!ranked, entryRef, onState, busy: false, tried: '' };
  state.unsubscribe = onValue(ref(rtdb, `queue/${key}`), (snap) => handleQueue(state, snap.val()), (error) => {
    onState?.({ count: 0, need: modeOf(mode).players, error: error.message });
  });
  state.beat = setInterval(() => {
    update(entryRef, { seen: rtdbStamp() }).catch(() => {});
    handleQueue(state, state.last);
  }, BEAT_MS);
  active = state;
  return { status: 'QUEUED', key };
}

export async function leaveQueue() {
  const state = active;
  active = null;
  if (!state) return { ok: true };
  clearInterval(state.beat);
  state.unsubscribe?.();
  await onDisconnect(state.entryRef).cancel().catch(() => {});
  await remove(state.entryRef).catch(() => {});
  return { ok: true };
}

export function isQueued() {
  return !!active;
}
