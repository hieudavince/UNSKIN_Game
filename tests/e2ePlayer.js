import { signInAnonymously } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, firestore, serverNow } from '../src/firebase/config';
import { ensurePlayer, joinQueue } from '../src/firebase/matchmakingService';
import {
  advancePhase,
  leaveMatch,
  lockDraftIfDue,
  markPresence,
  pushMatchEvent,
  reportRound,
  sendPlayerState,
  submitDraft,
  subscribeDraft,
  subscribeToLiveMatch,
  watchMatchEvents,
} from '../src/firebase/matchService';

const [, , name, mode, rankedFlag] = process.argv;
const ranked = rankedFlag === 'ranked';
const log = (step, data = {}) => console.log(JSON.stringify({ who: name, step, ...data }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, ms, label) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await sleep(400);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;
  await ensurePlayer(name);
  log('signed-in', { uid });

  await joinQueue(mode, ranked, (state) => log('queue', { count: state.count, need: state.need, error: state.error }));
  const matchId = await waitFor(async () => (await getDoc(doc(firestore, 'players', uid))).data()?.pendingMatchId, 60000, 'match');
  const match = (await getDoc(doc(firestore, 'matches', matchId))).data();
  const host = match.hostId === uid;
  const faction = match.teams.ATLAS.playerIds.includes(uid) ? 'ATLAS' : 'OUTLIERS';
  log('matched', { matchId, host, faction, status: match.status, players: match.playerIds.length });

  let live = null;
  subscribeToLiveMatch(matchId, (data) => { live = data; }, (error) => log('live-error', { error: error.message }));
  const events = [];
  watchMatchEvents(matchId, (event) => events.push(event));
  await waitFor(() => live, 15000, 'live match');
  log('live', { phase: live.phase, round: live.currentRound });

  if (ranked) {
    let draft = null;
    subscribeDraft(matchId, (data) => { draft = data; });
    await waitFor(() => draft, 15000, 'draft');
    await submitDraft({ matchId, ban: faction === 'ATLAS' ? 'glass' : 'rubber' });
    log('drafted');
    await waitFor(async () => {
      if (host) await lockDraftIfDue(matchId).catch(() => {});
      return (await getDoc(doc(firestore, 'matches', matchId))).data().status === 'IN_PROGRESS';
    }, 40000, 'draft lock');
    const locked = (await getDoc(doc(firestore, 'matches', matchId))).data();
    log('draft-locked', { banned: locked.bannedMaterials });
  }

  await markPresence(matchId);
  await sendPlayerState(matchId, { x: 1, y: 0, z: 2, yaw: 0, pitch: 0, alive: true, hp: 100 });
  log('state-sent');
  const others = match.playerIds.filter((id) => id !== uid);
  if (others.length) {
    await pushMatchEvent(matchId, { type: 'ping', round: 1 });
    await waitFor(() => live?.players && others.every((id) => live.players[id]?.x === 1), 15000, 'other player state');
    log('saw-other-state');
    await waitFor(() => events.some((event) => event.type === 'ping' && event.from !== uid), 15000, 'other event');
    log('saw-other-event');
  }

  if (host) {
    await waitFor(async () => {
      await advancePhase(matchId).catch((error) => log('advance-error', { error: error.message }));
      return live.phase === 'PREP';
    }, 40000, 'PREP');
    log('phase', { phase: live.phase });
    await waitFor(async () => {
      await advancePhase(matchId).catch((error) => log('advance-error', { error: error.message }));
      return live.phase === 'ACTION';
    }, 20000, 'ACTION');
    log('phase', { phase: live.phase });
    await reportRound({ matchId, winner: 'ATLAS', reason: 'Test elimination' });
    await waitFor(() => live.phase === 'POST_ROUND', 10000, 'POST_ROUND');
    log('phase', { phase: live.phase, score: live.score, lastRound: live.lastRound });
    await waitFor(async () => {
      await advancePhase(matchId).catch((error) => log('advance-error', { error: error.message }));
      return live.phase === 'BUY' && live.currentRound === 2;
    }, 25000, 'round 2');
    log('phase', { phase: live.phase, round: live.currentRound });
    await sleep(3000);
    await leaveMatch();
    log('left');
    const end = (await getDoc(doc(firestore, 'matches', matchId))).data();
    log('final', { status: end.status, winner: end.winner, serverSkewMs: Date.now() - serverNow() });
  } else {
    await waitFor(() => live.phase === 'ACTION', 60000, 'ACTION');
    log('phase', { phase: live.phase });
    await waitFor(() => live.phase === 'POST_ROUND', 20000, 'POST_ROUND');
    log('phase', { phase: live.phase, score: live.score });
    await waitFor(() => live.phase === 'BUY' && live.currentRound === 2, 30000, 'round 2');
    log('phase', { phase: live.phase, round: live.currentRound });
    await waitFor(() => live.phase === 'COMPLETE', 20000, 'complete');
    log('saw-complete', { winner: live.winner });
    await leaveMatch().catch(() => {});
  }
  log('done');
  process.exit(0);
}

main().catch((error) => {
  log('error', { error: error.message || String(error) });
  process.exit(1);
});
