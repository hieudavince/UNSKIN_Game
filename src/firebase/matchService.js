// Read/write functions for match data. Components call these, never touch
// Firestore/RTDB directly — keeps the data layer swappable and testable.

import { doc, getDoc, setDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, onValue, update, off } from 'firebase/database';
import { firestore, rtdb } from './config';

/** Subscribe to a live match's RTDB state. Returns an unsubscribe function. */
export function subscribeToLiveMatch(matchId, onData) {
  const matchRef = ref(rtdb, `liveMatches/${matchId}`);
  const listener = onValue(matchRef, (snapshot) => onData(snapshot.val()));
  return () => off(matchRef, 'value', listener);
}

/** Client-side action: unskin/reskin a surface. In production this should be
 * validated by a Cloud Function (range check, cartridge ownership, cooldown)
 * before being trusted — this direct write is a starting point only. */
export function reportSkinEvent(matchId, objectId, { playerId, newMaterial }) {
  return update(ref(rtdb, `liveMatches/${matchId}/surfaces/${objectId}`), {
    currentMaterial: newMaterial,
    lastModifiedBy: playerId,
    lastModifiedAtMs: Date.now(),
  });
}

/** Fetch a completed match summary from Firestore for the Post-Round / replay screen. */
export async function getMatchSummary(matchId) {
  const snap = await getDoc(doc(firestore, 'matches', matchId));
  return snap.exists() ? snap.data() : null;
}

/** Create a new match doc after the draft phase completes. */
export async function createMatch({ mapId, mode, teams, bannedMaterials }) {
  const ref = await addDoc(collection(firestore, 'matches'), {
    createdAt: serverTimestamp(),
    mapId, mode, teams, bannedMaterials,
    status: 'IN_PROGRESS',
    finalScore: { ATLAS: 0, OUTLIERS: 0 },
  });
  return ref.id;
}
