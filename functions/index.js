const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');

setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });
initializeApp();

const PHASE_SEC = { BUY: 45, PREP: 30, ACTION: 180, POST_ROUND: 20 };
// Free-for-all: one long action phase on the Helix Complex map, everyone in
// the ATLAS bucket (no teams), the top fragger wins.
const FFA = { MIN: 2, MAX: 8, MAP: 'complex', KILL_TARGET: 20 };
const FFA_PHASE_SEC = { BUY: 8, PREP: 3, ACTION: 480, POST_ROUND: 10 };
const QUEUE_MODES = new Set(['CASUAL', 'RANKED', 'FFA']);
const phaseSec = (data, phase) => (data?.mode === 'FFA' ? FFA_PHASE_SEC : PHASE_SEC)[phase];
const MATERIALS = new Set(['titanium', 'glass', 'rubber', 'wood', 'iron']);
const ROUNDS_TO_WIN = 6;
const MAX_ROUNDS = 11;

const db = () => getFirestore();
const live = () => getDatabase();

function requireUid(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  return request.auth.uid;
}

function cleanName(value) {
  const name = String(value || 'Player').replace(/\s+/g, ' ').trim().slice(0, 24);
  return name || 'Player';
}

function cleanMaterial(value) {
  const name = String(value || '').toLowerCase();
  return MATERIALS.has(name) ? name : null;
}

function playerRef(uid) {
  return db().collection('players').doc(uid);
}

function matchRef(matchId) {
  return db().collection('matches').doc(matchId);
}

async function loadMemberMatch(matchId, uid) {
  const snap = await matchRef(matchId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Match not found.');
  const data = snap.data();
  if (!Array.isArray(data.playerIds) || !data.playerIds.includes(uid)) {
    throw new HttpsError('permission-denied', 'Not in this match.');
  }
  return { ref: snap.ref, data };
}

function stock() {
  return { glass: 32, wood: 32, iron: 24 };
}

function buyPatch(round, mode) {
  const now = Date.now();
  return {
    status: 'IN_PROGRESS',
    phase: 'BUY',
    phaseEndsAtMs: now + (mode === 'FFA' ? FFA_PHASE_SEC : PHASE_SEC).BUY * 1000,
    draftEndsAtMs: null,
    currentRound: round || 1,
  };
}

async function writeLive(matchId, patch) {
  await live().ref(`liveMatches/${matchId}`).update(patch);
}

async function clearPending(playerIds) {
  const batch = db().batch();
  playerIds.forEach((id) => batch.update(playerRef(id), { pendingMatchId: null }));
  await batch.commit();
}

function selectQueue(docs, mode) {
  const sorted = docs.slice().sort((a, b) => {
    const am = a.data().queuedAt?.toMillis?.() || 0;
    const bm = b.data().queuedAt?.toMillis?.() || 0;
    return am - bm;
  });
  if (mode === 'FFA') {
    if (sorted.length >= FFA.MAX) return sorted.slice(0, FFA.MAX);
    if (sorted.length < FFA.MIN) return [];
    const waited = Date.now() - (sorted[0].data().queuedAt?.toMillis?.() || Date.now());
    return waited > 15000 ? sorted : [];
  }
  if (mode !== 'RANKED') return sorted.slice(0, 10);
  if (sorted.length < 2) return [];
  const oldest = sorted[0].data();
  const age = Date.now() - (oldest.queuedAt?.toMillis?.() || Date.now());
  const window = age > 20000 ? 5000 : 400;
  const anchor = oldest.tcMmr || 1000;
  const band = sorted.filter((doc) => Math.abs((doc.data().tcMmr || 1000) - anchor) <= window);
  return band.length >= 2 ? band.slice(0, 10) : [];
}

async function tryMatch(mode) {
  const queue = await db().collection('matchmakingQueue').where('mode', '==', mode).limit(20).get();
  const chosen = selectQueue(queue.docs, mode);
  const ffa = mode === 'FFA';
  if (chosen.length < (mode === 'RANKED' || ffa ? 2 : 1)) return null;

  const ids = chosen.map((doc) => doc.data().playerId);
  const atlas = [];
  const outliers = [];
  ids.forEach((id, index) => (ffa || index % 2 === 0 ? atlas : outliers).push(id));
  const hostId = ids[0];
  const drafting = mode === 'RANKED';
  const now = Date.now();
  const ref = db().collection('matches').doc();
  const phasePatch = drafting ? {
    status: 'DRAFTING',
    phase: null,
    phaseEndsAtMs: null,
    draftEndsAtMs: now + 30000,
    currentRound: 1,
  } : buyPatch(1, mode);

  const created = await db().runTransaction(async (tx) => {
    const entries = [];
    for (const doc of chosen) entries.push(await tx.get(doc.ref));
    if (entries.some((snap) => !snap.exists)) return false;
    const players = [];
    for (const id of ids) players.push(await tx.get(playerRef(id)));
    if (players.some((snap) => snap.data()?.pendingMatchId)) return false;
    tx.set(ref, {
      createdAt: FieldValue.serverTimestamp(),
      mapId: ffa ? FFA.MAP : 'foundry',
      mode,
      ranked: drafting,
      ffaWinner: null,
      teams: {
        ATLAS: { playerIds: atlas },
        OUTLIERS: { playerIds: outliers },
      },
      playerIds: ids,
      hostId,
      bannedMaterials: { ATLAS: null, OUTLIERS: null },
      picks: {},
      finalScore: { ATLAS: 0, OUTLIERS: 0 },
      winner: null,
      pendingWinner: null,
      rtdbPath: `liveMatches/${ref.id}`,
      ...phasePatch,
    });
    entries.forEach((snap) => tx.delete(snap.ref));
    ids.forEach((id) => tx.update(playerRef(id), { pendingMatchId: ref.id }));
    return true;
  });
  if (!created) return null;

  const memberIds = {};
  const players = {};
  ids.forEach((id, index) => {
    memberIds[id] = true;
    const entry = chosen.find((doc) => doc.data().playerId === id);
    players[id] = {
      faction: ffa || index % 2 === 0 ? 'ATLAS' : 'OUTLIERS',
      kills: 0,
      deaths: 0,
      displayName: entry?.data().displayName || 'Player',
      alive: true,
      credits: 800,
      skinInventory: stock(),
    };
  });
  await live().ref(`liveMatches/${ref.id}`).set({
    phase: phasePatch.phase || 'DRAFT',
    phaseEndsAtMs: phasePatch.phaseEndsAtMs || 0,
    currentRound: 1,
    score: { ATLAS: 0, OUTLIERS: 0 },
    hostId,
    memberIds,
    players,
    surfaces: {},
    extractor: { state: 'NOT_PLANTED', plantedBy: null, plantedAtMs: null },
    killFeedLive: {},
  });
  if (drafting) {
    await live().ref(`drafts/${ref.id}`).set({
      memberIds,
      locked: false,
      bans: { ATLAS: null, OUTLIERS: null },
      picks: {},
      draftEndsAtMs: phasePatch.draftEndsAtMs,
    });
  }
  return ref.id;
}

// FFA winner = most kills in the live player state (ties: fewer deaths).
async function ffaLeader(matchId) {
  const snap = await live().ref(`liveMatches/${matchId}/players`).get();
  let best = null;
  Object.entries(snap.val() || {}).forEach(([uid, info]) => {
    const kills = Number(info?.kills) || 0;
    const deaths = Number(info?.deaths) || 0;
    if (!best || kills > best.kills || (kills === best.kills && deaths < best.deaths)) best = { uid, kills, deaths };
  });
  return best;
}

async function finishMatch(ref, data, winner) {
  const ffa = data.mode === 'FFA';
  await ref.update({
    status: 'COMPLETED',
    winner: winner || null,
    pendingWinner: winner || null,
    phase: null,
    phaseEndsAtMs: null,
  });
  await clearPending(data.playerIds);
  const batch = db().batch();
  data.playerIds.forEach((id) => {
    const faction = data.teams.ATLAS.playerIds.includes(id) ? 'ATLAS' : 'OUTLIERS';
    const won = ffa ? data.ffaWinner === id : winner && faction === winner;
    batch.update(playerRef(id), {
      tcMmr: FieldValue.increment(won ? 18 : winner ? -12 : 0),
      'stats.matchesPlayed': FieldValue.increment(1),
      'stats.wins': FieldValue.increment(won ? 1 : 0),
      'stats.losses': FieldValue.increment(winner && !won ? 1 : 0),
    });
  });
  await batch.commit();
  await live().ref(`liveMatches/${ref.id}`).update({ phase: 'COMPLETE', phaseEndsAtMs: 0 });
  await live().ref(`drafts/${ref.id}`).remove();
}

async function closeAction(ref, data, winner, reason) {
  const leader = data.mode === 'FFA' ? await ffaLeader(ref.id) : null;
  const applied = await db().runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const cur = fresh.data();
    if (!cur || cur.phase !== 'ACTION' || cur.status !== 'IN_PROGRESS') return null;
    const score = {
      ATLAS: cur.finalScore?.ATLAS || 0,
      OUTLIERS: cur.finalScore?.OUTLIERS || 0,
    };
    const ffa = cur.mode === 'FFA';
    if (ffa) winner = 'ATLAS';
    if (winner === 'ATLAS' || winner === 'OUTLIERS') score[winner] += 1;
    const done = ffa || score.ATLAS >= ROUNDS_TO_WIN || score.OUTLIERS >= ROUNDS_TO_WIN || cur.currentRound >= MAX_ROUNDS;
    const now = Date.now();
    const patch = {
      finalScore: score,
      phase: 'POST_ROUND',
      phaseEndsAtMs: now + phaseSec(cur, 'POST_ROUND') * 1000,
      pendingWinner: done ? winner : null,
    };
    if (ffa) patch.ffaWinner = leader?.uid || null;
    tx.update(ref, patch);
    tx.set(ref.collection('rounds').doc(String(cur.currentRound || 1)), {
      winner: winner || null,
      reason: String(reason || 'round').slice(0, 80),
      score,
      at: FieldValue.serverTimestamp(),
    });
    return { ...cur, ...patch };
  });
  if (!applied) return { status: data.status, phase: data.phase };
  await writeLive(ref.id, {
    phase: 'POST_ROUND',
    phaseEndsAtMs: applied.phaseEndsAtMs,
    currentRound: applied.currentRound || 1,
    score: applied.finalScore,
  });
  return { status: 'IN_PROGRESS', phase: 'POST_ROUND', score: applied.finalScore };
}

async function movePhase(ref, data, phase) {
  const now = Date.now();
  const phaseEndsAtMs = now + phaseSec(data, phase) * 1000;
  await ref.update({ phase, phaseEndsAtMs });
  await writeLive(ref.id, {
    phase,
    phaseEndsAtMs,
    currentRound: data.currentRound || 1,
    score: data.finalScore || { ATLAS: 0, OUTLIERS: 0 },
  });
  return { phase, phaseEndsAtMs };
}

async function openNext(ref, data) {
  if (data.pendingWinner) {
    await finishMatch(ref, data, data.pendingWinner);
    return { status: 'COMPLETED', winner: data.pendingWinner };
  }
  const patch = buyPatch((data.currentRound || 1) + 1, data.mode);
  await ref.update(patch);
  await writeLive(ref.id, {
    phase: 'BUY',
    phaseEndsAtMs: patch.phaseEndsAtMs,
    currentRound: patch.currentRound,
    score: data.finalScore || { ATLAS: 0, OUTLIERS: 0 },
  });
  return patch;
}

function winnerFromHost(data, playerWon) {
  const hostIsAtlas = data.teams.ATLAS.playerIds.includes(data.hostId);
  const hostFaction = hostIsAtlas ? 'ATLAS' : 'OUTLIERS';
  if (playerWon) return hostFaction;
  return hostFaction === 'ATLAS' ? 'OUTLIERS' : 'ATLAS';
}

async function stepMatch(matchId, uid, report) {
  const { ref, data } = await loadMemberMatch(matchId, uid);
  if (uid !== data.hostId) throw new HttpsError('permission-denied', 'Only the host advances the match.');
  if (data.status === 'COMPLETED') return { status: 'COMPLETED' };
  if (data.status === 'DRAFTING') {
    await forceLock(ref, data);
    return { status: 'IN_PROGRESS', phase: 'BUY' };
  }
  if (data.status !== 'IN_PROGRESS') throw new HttpsError('failed-precondition', 'Match is not live.');

  if (report && data.phase === 'ACTION') {
    const winner = report.winner || winnerFromHost(data, report.playerWon);
    return closeAction(ref, data, winner, report.reason);
  }
  if (Date.now() + 1500 < (data.phaseEndsAtMs || 0)) return { phase: data.phase, status: data.status };
  if (data.phase === 'ACTION') return closeAction(ref, data, 'OUTLIERS', report?.reason || 'Time expired');
  if (data.phase === 'BUY') return movePhase(ref, data, 'PREP');
  if (data.phase === 'PREP') return movePhase(ref, data, 'ACTION');
  if (data.phase === 'POST_ROUND') return openNext(ref, data);
  return { phase: data.phase };
}

function teamBan(data, picks, faction) {
  const bans = data.teams[faction].playerIds.map((id) => picks[id]?.ban).filter(Boolean);
  return bans[0] || null;
}

async function forceLock(ref, data) {
  const picks = { ...(data.picks || {}) };
  data.playerIds.forEach((id) => {
    if (picks[id]) return;
    const faction = data.teams.ATLAS.playerIds.includes(id) ? 'ATLAS' : 'OUTLIERS';
    picks[id] = { ban: null, loadout: ['titanium'], faction };
  });
  const bannedMaterials = {
    ATLAS: teamBan(data, picks, 'ATLAS'),
    OUTLIERS: teamBan(data, picks, 'OUTLIERS'),
  };
  const patch = { picks, bannedMaterials, ...buyPatch(data.currentRound || 1) };
  await ref.update(patch);
  await live().ref(`drafts/${ref.id}`).update({ picks, bans: bannedMaterials, locked: true });
  await writeLive(ref.id, {
    phase: 'BUY',
    phaseEndsAtMs: patch.phaseEndsAtMs,
    currentRound: patch.currentRound,
    score: data.finalScore || { ATLAS: 0, OUTLIERS: 0 },
  });
}

exports.ensurePlayer = onCall(async (request) => {
  const uid = requireUid(request);
  const ref = playerRef(uid);
  const snap = await ref.get();
  const displayName = cleanName(request.data?.displayName || request.auth.token.name || request.auth.token.email || 'Player');
  if (!snap.exists) {
    await ref.set({
      uid,
      displayName,
      createdAt: FieldValue.serverTimestamp(),
      tcMmr: 1000,
      credits: 800,
      pendingMatchId: null,
      stats: {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        skinSynergyAssists: 0,
      },
    });
    return { uid, displayName, tcMmr: 1000, credits: 800, pendingMatchId: null };
  }
  if (request.data?.displayName) await ref.update({ displayName });
  return { uid, ...snap.data(), displayName };
});

exports.joinQueue = onCall(async (request) => {
  const uid = requireUid(request);
  const asked = String(request.data?.mode || '').toUpperCase();
  const mode = QUEUE_MODES.has(asked) ? asked : 'CASUAL';
  const player = await playerRef(uid).get();
  if (!player.exists) throw new HttpsError('failed-precondition', 'Create a player first.');
  if (player.data().pendingMatchId) return { matchId: player.data().pendingMatchId, status: 'ALREADY' };
  const existing = await db().collection('matchmakingQueue').where('playerId', '==', uid).get();
  const batch = db().batch();
  existing.docs.forEach((doc) => batch.delete(doc.ref));
  const entry = db().collection('matchmakingQueue').doc();
  batch.set(entry, {
    playerId: uid,
    mode,
    tcMmr: player.data().tcMmr || 1000,
    displayName: player.data().displayName || 'Player',
    queuedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  let matchId = null;
  try {
    matchId = await tryMatch(mode);
  } catch (error) {
    console.error('tryMatch', error);
  }
  return { queueEntryId: entry.id, matchId: matchId || null, status: matchId ? 'MATCHED' : 'QUEUED' };
});

exports.leaveQueue = onCall(async (request) => {
  const uid = requireUid(request);
  const player = await playerRef(uid).get();
  if (player.data()?.pendingMatchId) return { ok: false, matchId: player.data().pendingMatchId };
  const existing = await db().collection('matchmakingQueue').where('playerId', '==', uid).get();
  const batch = db().batch();
  existing.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return { ok: true };
});

exports.submitDraft = onCall(async (request) => {
  const uid = requireUid(request);
  const matchId = String(request.data?.matchId || '');
  const { ref, data } = await loadMemberMatch(matchId, uid);
  if (data.status !== 'DRAFTING') return { status: data.status, locked: data.status === 'IN_PROGRESS' };
  const ban = cleanMaterial(request.data?.ban);
  let loadout = Array.isArray(request.data?.loadout)
    ? request.data.loadout.map(cleanMaterial).filter((name) => name && name !== ban)
    : [];
  loadout = [...new Set(loadout)].slice(0, 3);
  if (!loadout.length) loadout = [ban === 'titanium' ? 'glass' : 'titanium'];
  const faction = data.teams.ATLAS.playerIds.includes(uid) ? 'ATLAS' : 'OUTLIERS';
  const picks = { ...(data.picks || {}), [uid]: { ban, loadout, faction } };
  const bannedMaterials = {
    ATLAS: teamBan(data, picks, 'ATLAS'),
    OUTLIERS: teamBan(data, picks, 'OUTLIERS'),
  };
  const everyone = data.playerIds.every((id) => picks[id]);
  const patch = { picks, bannedMaterials };
  if (everyone) Object.assign(patch, buyPatch(data.currentRound || 1));
  await ref.update(patch);
  await live().ref(`drafts/${matchId}`).update({ picks, bans: bannedMaterials, locked: everyone });
  if (everyone) {
    await writeLive(matchId, {
      phase: 'BUY',
      phaseEndsAtMs: patch.phaseEndsAtMs,
      currentRound: patch.currentRound,
      score: data.finalScore || { ATLAS: 0, OUTLIERS: 0 },
    });
  }
  return { locked: everyone };
});

exports.advancePhase = onCall(async (request) => {
  const uid = requireUid(request);
  return stepMatch(String(request.data?.matchId || ''), uid, null);
});

exports.reportRound = onCall(async (request) => {
  const uid = requireUid(request);
  return stepMatch(String(request.data?.matchId || ''), uid, {
    playerWon: !!request.data?.playerWon,
    reason: request.data?.reason,
  });
});

exports.reportSkin = onCall(async (request) => {
  const uid = requireUid(request);
  const matchId = String(request.data?.matchId || '');
  const objectId = String(request.data?.objectId || '').replace(/[.#$/[\]]/g, '').slice(0, 64);
  const material = cleanMaterial(request.data?.material);
  const area = Math.max(0, Math.min(40, Number(request.data?.area) || 0));
  if (!objectId || !material) throw new HttpsError('invalid-argument', 'Bad skin event.');
  const { data } = await loadMemberMatch(matchId, uid);
  if (data.phase !== 'ACTION') throw new HttpsError('failed-precondition', 'Not in the action phase.');
  const banned = Object.values(data.bannedMaterials || {});
  if (banned.includes(material)) throw new HttpsError('failed-precondition', 'That material is banned.');
  const invRef = live().ref(`liveMatches/${matchId}/players/${uid}/skinInventory/${material}`);
  const result = await invRef.transaction((current) => {
    const have = Number(current);
    if (!Number.isFinite(have) || have + 0.001 < area) return;
    return Math.round((have - area) * 100) / 100;
  });
  if (!result.committed) throw new HttpsError('failed-precondition', 'Not enough of that material.');
  await live().ref(`liveMatches/${matchId}/surfaces/${objectId}`).update({
    currentMaterial: material,
    lastModifiedBy: uid,
    lastModifiedAtMs: Date.now(),
    area,
  });
  return { ok: true };
});

exports.leaveMatch = onCall(async (request) => {
  const uid = requireUid(request);
  const player = await playerRef(uid).get();
  const matchId = player.data()?.pendingMatchId;
  if (!matchId) return { ok: true };
  const snap = await matchRef(matchId).get();
  if (!snap.exists) {
    await playerRef(uid).update({ pendingMatchId: null });
    return { ok: true };
  }
  const data = snap.data();
  const others = (data.playerIds || []).filter((id) => id !== uid);
  if (data.status !== 'IN_PROGRESS' || others.length === 0) {
    await finishMatch(snap.ref, data, null);
    return { ok: true };
  }
  await playerRef(uid).update({ pendingMatchId: null });
  await live().ref(`liveMatches/${matchId}/players/${uid}/alive`).set(false);
  await live().ref(`liveMatches/${matchId}/memberIds/${uid}`).set(false);
  return { ok: true };
});

exports.tickMatches = onSchedule('every 1 minutes', async () => {
  const now = Date.now();
  const drafting = await db().collection('matches').where('status', '==', 'DRAFTING').where('draftEndsAtMs', '<=', now).limit(10).get();
  for (const doc of drafting.docs) {
    try {
      await forceLock(doc.ref, doc.data());
    } catch (error) {
      console.error('draft tick', doc.id, error);
    }
  }
  const running = await db().collection('matches').where('status', '==', 'IN_PROGRESS').where('phaseEndsAtMs', '<=', now).limit(10).get();
  for (const doc of running.docs) {
    try {
      await stepMatch(doc.id, doc.data().hostId, null);
    } catch (error) {
      console.error('phase tick', doc.id, error);
    }
  }
});
