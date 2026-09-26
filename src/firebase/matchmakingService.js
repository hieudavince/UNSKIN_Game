import { collection, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { firestore } from './config';

/** Add player to matchmaking queue. Actual matching (grouping 10 players,
 * balancing TC-MMR, creating the match doc, kicking off the draft) should
 * run server-side in a Cloud Function watching this collection — do not
 * implement pairing logic on the client. */
export async function joinQueue(playerId, mode, tcMmr) {
  return addDoc(collection(firestore, 'matchmakingQueue'), {
    playerId, mode, tcMmr, queuedAt: serverTimestamp(),
  });
}

export async function leaveQueue(queueEntryId) {
  return deleteDoc(doc(firestore, 'matchmakingQueue', queueEntryId));
}
