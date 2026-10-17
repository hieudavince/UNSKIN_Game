import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  get,
  onChildAdded,
  onDisconnect,
  onValue,
  push,
  ref,
  set,
  update,
} from 'firebase/database';
import { auth, firestore, rtdb, serverNow } from './config';
import { MATERIALS, MAX_ROUNDS, modeOf, phaseMs } from '../constants/modes';

function userId() {
  const id = auth.currentUser?.uid;
  if (!id) throw new Error('Sign in required.');
  return id;
}

function matchRef(matchId) {
  return doc(firestore, 'matches', matchId);
}

function cleanMaterial(value) {
  const name = String(value || '').toLowerCase();
  return MATERIALS.includes(name) ? name : null;
}

function watch(path, onData, onError) {
  if (!rtdb) return () => {};
  let stop = () => {};
  let dead = false;
  let timer = 0;
  const start = () => {
    stop = onValue(ref(rtdb, path), (snapshot) => onData(snapshot.val()), (error) => {
      onError?.(error);
      if (!dead) timer = setTimeout(start, 1200);
    });
  };
  start();
  return () => {
    dead = true;
    clearTimeout(timer);
    stop();
  };
}

export function subscribeToLiveMatch(matchId, onData, onError) {
  return watch(`liveMatches/${matchId}`, onData, onError);
}

export function subscribeDraft(matchId, onData) {
  return watch(`drafts/${matchId}`, onData);
}

export function watchMatchEvents(matchId, onEvent) {
  if (!rtdb) return () => {};
  let stop = () => {};
  let dead = false;
  let timer = 0;
  const seen = new Set();
  const start = () => {
    stop = onChildAdded(ref(rtdb, `liveMatches/${matchId}/events`), (snapshot) => {
      if (seen.has(snapshot.key)) return;
      seen.add(snapshot.key);
      onEvent({ key: snapshot.key, ...snapshot.val() });
    }, () => {
      if (!dead) timer = setTimeout(start, 1200);
    });
  };
  start();
  return () => {
    dead = true;
    clearTimeout(timer);
    stop();
  };
}

export function pushMatchEvent(matchId, event) {
  const from = userId();
  return push(ref(rtdb, `liveMatches/${matchId}/events`), { ...event, from, t: serverNow() });
}

export function sendPlayerState(matchId, state) {
  const id = userId();
  return update(ref(rtdb, `liveMatches/${matchId}/players/${id}`), state);
}

export async function markPresence(matchId) {
  const id = userId();
  const online = ref(rtdb, `liveMatches/${matchId}/players/${id}/online`);
  await onDisconnect(online).set(false);
  await set(online, true);
}

export async function openLiveMatch(matchId, data) {
  await set(ref(rtdb, `liveMatches/${matchId}`), data);
}

async function mirrorPhase(matchId, data, lastRound) {
  const patch = {
    phase: data.status === 'COMPLETED' ? 'COMPLETE' : data.phase,
    phaseEndsAtMs: data.phaseEndsAtMs || 0,
    currentRound: data.currentRound || 1,
    score: data.finalScore || { ATLAS: 0, OUTLIERS: 0 },
  };
  if (lastRound !== undefined) patch.lastRound = lastRound;
  if (data.status === 'COMPLETED') patch.winner = data.winner || null;
  await update(ref(rtdb, `liveMatches/${matchId}`), patch);
}

// FFA winner: most kills in the live player state, ties broken by fewer deaths.
export function ffaLeader(players) {
  let best = null;
  for (const [uid, info] of Object.entries(players || {})) {
    if (!info || !info.name) continue;
    const kills = Number(info.kills) || 0;
    const deaths = Number(info.deaths) || 0;
    if (!best || kills > best.kills || (kills === best.kills && deaths < best.deaths)) {
      best = { uid, name: info.name, kills, deaths };
    }
  }
  return best;
}

async function writeRound(matchId, data, rawWinner, reason) {
  const ffa = !!modeOf(data.mode).ffa;
  // FFA is a single round; the team bucket is always ATLAS and the real winner
  // (a player) is stored as ffaWinner.
  const winner = ffa ? 'ATLAS' : rawWinner;
  let leader = null;
  if (ffa) {
    const snap = await get(ref(rtdb, `liveMatches/${matchId}/players`)).catch(() => null);
    leader = ffaLeader(snap?.val());
  }
  const score = {
    ATLAS: data.finalScore?.ATLAS || 0,
    OUTLIERS: data.finalScore?.OUTLIERS || 0,
  };
  score[winner] += 1;
  const target = modeOf(data.mode).roundsToWin;
  const done = ffa || score.ATLAS >= target || score.OUTLIERS >= target || (data.currentRound || 1) >= MAX_ROUNDS;
  const cleanReason = String(reason || 'Round over').slice(0, 80);
  await setDoc(doc(firestore, 'matches', matchId, 'rounds', String(data.currentRound || 1)), {
    winner,
    reason: cleanReason,
    score,
    at: serverTimestamp(),
  });
  const patch = {
    finalScore: score,
    phase: 'POST_ROUND',
    phaseEndsAtMs: serverNow() + phaseMs(data.mode, 'POST_ROUND'),
    pendingWinner: done ? (score.ATLAS >= score.OUTLIERS ? 'ATLAS' : 'OUTLIERS') : null,
    currentRound: data.currentRound || 1,
  };
  const lastRound = { winner, reason: cleanReason, round: data.currentRound || 1 };
  if (ffa) {
    patch.ffaWinner = leader?.uid || null;
    lastRound.ffaWinner = leader?.uid || null;
    lastRound.ffaWinnerName = leader?.name || null;
    lastRound.ffaKills = leader?.kills || 0;
  }
  return { patch, lastRound };
}

export async function advancePhase(matchId) {
  const id = userId();
  const snap = await getDoc(matchRef(matchId));
  if (!snap.exists()) throw new Error('Match not found.');
  const data = snap.data();
  if (data.hostId !== id || data.status !== 'IN_PROGRESS') return { phase: data.phase };
  if (serverNow() + 1500 < (data.phaseEndsAtMs || 0)) return { phase: data.phase };
  let patch = null;
  let lastRound;
  if (data.phase === 'BUY') patch = { phase: 'PREP', phaseEndsAtMs: serverNow() + phaseMs(data.mode, 'PREP') };
  else if (data.phase === 'PREP') patch = { phase: 'ACTION', phaseEndsAtMs: serverNow() + phaseMs(data.mode, 'ACTION') };
  else if (data.phase === 'ACTION') {
    const result = await writeRound(matchId, data, 'OUTLIERS', 'Time ran out');
    patch = result.patch;
    lastRound = result.lastRound;
  } else if (data.phase === 'POST_ROUND') {
    patch = data.pendingWinner
      ? { status: 'COMPLETED', phase: null, phaseEndsAtMs: null, winner: data.pendingWinner }
      : { phase: 'BUY', phaseEndsAtMs: serverNow() + phaseMs(data.mode, 'BUY'), currentRound: (data.currentRound || 1) + 1 };
  }
  if (!patch) return { phase: data.phase };
  await updateDoc(snap.ref, patch);
  await mirrorPhase(matchId, { ...data, ...patch }, lastRound);
  return patch;
}

export async function reportRound({ matchId, winner, reason }) {
  const id = userId();
  if (winner !== 'ATLAS' && winner !== 'OUTLIERS') throw new Error('Bad winner.');
  const snap = await getDoc(matchRef(matchId));
  if (!snap.exists()) throw new Error('Match not found.');
  const data = snap.data();
  if (data.hostId !== id || data.phase !== 'ACTION') return { phase: data.phase };
  const result = await writeRound(matchId, data, winner, reason);
  await updateDoc(snap.ref, result.patch);
  await mirrorPhase(matchId, { ...data, ...result.patch }, result.lastRound);
  return result.patch;
}

function lockPatch(data, picks) {
  const banOf = (team) => data.teams[team].playerIds.map((id) => picks[id]?.ban).find(Boolean) || null;
  return {
    picks,
    bannedMaterials: { ATLAS: banOf('ATLAS'), OUTLIERS: banOf('OUTLIERS') },
    status: 'IN_PROGRESS',
    phase: 'BUY',
    phaseEndsAtMs: serverNow() + phaseMs(data.mode, 'BUY'),
    currentRound: data.currentRound || 1,
  };
}

export async function submitDraft({ matchId, ban }) {
  const id = userId();
  const cleanBan = cleanMaterial(ban);
  const locked = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(matchRef(matchId));
    if (!snap.exists()) throw new Error('Match not found.');
    const data = snap.data();
    if (!data.playerIds.includes(id)) throw new Error('Not in this match.');
    if (data.status !== 'DRAFTING') return null;
    const faction = data.teams.ATLAS.playerIds.includes(id) ? 'ATLAS' : 'OUTLIERS';
    const picks = { ...(data.picks || {}), [id]: { ban: cleanBan, faction } };
    if (data.playerIds.every((playerId) => picks[playerId])) {
      const patch = lockPatch(data, picks);
      tx.update(snap.ref, patch);
      return { data, patch };
    }
    tx.update(snap.ref, { picks });
    return null;
  });
  await update(ref(rtdb, `drafts/${matchId}/picks`), { [id]: { ban: cleanBan || null } }).catch(() => {});
  if (locked) await mirrorPhase(matchId, { ...locked.data, ...locked.patch }, null);
  return { locked: !!locked };
}

export async function lockDraftIfDue(matchId) {
  const id = userId();
  const locked = await runTransaction(firestore, async (tx) => {
    const snap = await tx.get(matchRef(matchId));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data.status !== 'DRAFTING' || data.hostId !== id) return null;
    if (serverNow() < (data.draftEndsAtMs || 0)) return null;
    const picks = { ...(data.picks || {}) };
    for (const playerId of data.playerIds) {
      if (!picks[playerId]) {
        picks[playerId] = { ban: null, faction: data.teams.ATLAS.playerIds.includes(playerId) ? 'ATLAS' : 'OUTLIERS' };
      }
    }
    const patch = lockPatch(data, picks);
    tx.update(snap.ref, patch);
    return { data, patch };
  });
  if (locked) await mirrorPhase(matchId, { ...locked.data, ...locked.patch }, null);
  return { locked: !!locked };
}

export async function leaveMatch() {
  const id = userId();
  const player = await getDoc(doc(firestore, 'players', id));
  const matchId = player.data()?.pendingMatchId;
  if (!matchId) return { ok: true };
  const snap = await getDoc(matchRef(matchId));
  if (snap.exists()) {
    const data = snap.data();
    await update(ref(rtdb, `liveMatches/${matchId}/players/${id}`), { left: true, alive: false, online: false }).catch(() => {});
    const solo = data.playerIds.length <= 1;
    if (data.status !== 'COMPLETED' && (solo || data.hostId === id)) {
      const others = data.teams.ATLAS.playerIds.includes(id) ? 'OUTLIERS' : 'ATLAS';
      const winner = solo || modeOf(data.mode).ffa ? data.winner || null : others;
      await updateDoc(snap.ref, { status: 'COMPLETED', phase: null, winner }).catch(() => {});
      await mirrorPhase(matchId, { ...data, status: 'COMPLETED', phase: null, winner }).catch(() => {});
    }
  }
  await updateDoc(doc(firestore, 'players', id), { pendingMatchId: null });
  return { ok: true };
}
