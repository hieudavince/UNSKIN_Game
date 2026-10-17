import { signInAnonymously } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, firestore } from '../src/firebase/config';
import { ensurePlayer, joinQueue, leaveQueue } from '../src/firebase/matchmakingService';
import {
  leaveMatch,
  markPresence,
  pushMatchEvent,
  sendPlayerState,
  subscribeToLiveMatch,
} from '../src/firebase/matchService';

const [, , mode = 'DUEL'] = process.argv;
const log = (step, data = {}) => console.log(JSON.stringify({ who: 'bot', step, ...data }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function square(u0, v0, u1, v1, step = 0.05) {
  const corners = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const points = [];
  for (let i = 0; i < 4; i += 1) {
    const [au, av] = corners[i];
    const [bu, bv] = corners[(i + 1) % 4];
    const n = Math.ceil(Math.hypot(bu - au, bv - av) / step);
    for (let s = 0; s < n; s += 1) points.push([+(au + ((bu - au) * s) / n).toFixed(3), +(av + ((bv - av) * s) / n).toFixed(3)]);
  }
  return points;
}

async function main() {
  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;
  await ensurePlayer('Bot');
  await joinQueue(mode, false, (state) => log('queue', state));
  let matchId = null;
  while (!matchId) {
    matchId = (await getDoc(doc(firestore, 'players', uid))).data()?.pendingMatchId;
    await sleep(500);
  }
  await leaveQueue();
  const match = (await getDoc(doc(firestore, 'matches', matchId))).data();
  const target = match.playerIds.find((id) => id !== uid);
  log('matched', { matchId, host: match.hostId === uid, target });
  let live = null;
  subscribeToLiveMatch(matchId, (data) => { live = data; });
  await markPresence(matchId);
  const faction = match.teams.ATLAS.playerIds.includes(uid) ? 'ATLAS' : 'OUTLIERS';
  let alive = true;
  const beat = setInterval(() => {
    sendPlayerState(matchId, {
      name: 'Bot', faction, x: -3.2, y: 0, z: 24.5, yaw: Math.PI, crouch: 0, hp: alive ? 100 : 0, alive, online: true, left: false,
    }).catch(() => {});
  }, 200);

  if (match.hostId === uid) throw new Error('bot became host; queue the browser first');
  while (!live || live.phase !== 'ACTION') await sleep(300);
  const round = live.currentRound;
  log('action', { round });
  await sleep(2500);
  await pushMatchEvent(matchId, {
    type: 'paint', round, seed: 'botpaint', material: 'glass', axis: 'z', anchor: 10.6, sign: 1, hostMaterial: 'wood',
    points: square(-6.3, 0.1, -3.9, 2.9),
  });
  log('painted');
  await sleep(4000);
  await pushMatchEvent(matchId, { type: 'hit', round, to: target, dmg: 30, part: 'body' });
  log('hit-sent');
  await sleep(4000);
  await pushMatchEvent(matchId, { type: 'shatter', round, ids: ['botpaint_s0', 'botpaint_s1'] });
  log('shattered');
  await sleep(6000);
  alive = false;
  await pushMatchEvent(matchId, { type: 'kill', round, killer: target, killerName: 'You', victimName: 'Bot' });
  log('died');
  while (live.phase !== 'POST_ROUND') await sleep(300);
  log('round-over', { score: live.score, lastRound: live.lastRound });
  while (!(live.phase === 'BUY' && live.currentRound === round + 1)) await sleep(300);
  alive = true;
  log('next-round', { round: live.currentRound });
  await sleep(4000);
  clearInterval(beat);
  await leaveMatch().catch(() => {});
  log('left');
  process.exit(0);
}

main().catch((error) => {
  log('error', { error: error.message });
  process.exit(1);
});
