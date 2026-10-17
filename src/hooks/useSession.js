import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { auth, firebaseReady, firestore } from '../firebase/config';
import { ensurePlayer, isQueued, leaveQueue } from '../firebase/matchmakingService';
import { grantMatchResult } from '../firebase/progression';

export function useSession() {
  const [session, setSession] = useState({
    ready: false,
    user: null,
    player: null,
    match: null,
    lastMatch: null,
    error: '',
  });

  useEffect(() => {
    if (!firebaseReady || !auth || !firestore) {
      setSession((current) => ({ ...current, ready: true, error: 'Firebase is not configured yet.' }));
      return undefined;
    }

    let playerUnsub = () => {};
    let matchUnsub = () => {};
    let watching = null;

    const stopMatch = () => {
      matchUnsub();
      matchUnsub = () => {};
      watching = null;
    };

    const authUnsub = onAuthStateChanged(auth, async (user) => {
      playerUnsub();
      stopMatch();
      playerUnsub = () => {};
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch (error) {
          setSession((current) => ({ ...current, ready: true, user: null, error: error.message || 'Sign-in failed.' }));
        }
        return;
      }
      try {
        await ensurePlayer();
      } catch (error) {
        setSession((current) => ({
          ...current, ready: true, user, error: error.message || 'Could not create the player profile.',
        }));
        return;
      }
      playerUnsub = onSnapshot(doc(firestore, 'players', user.uid), (snap) => {
        const player = snap.exists() ? snap.data() : null;
        const pending = player?.pendingMatchId || null;
        if (!pending) {
          stopMatch();
          setSession((current) => ({ ...current, ready: true, user, player, match: null, error: '' }));
          return;
        }
        if (isQueued()) leaveQueue().catch(() => {});
        setSession((current) => ({ ...current, ready: true, user, player }));
        if (watching === pending) return;
        stopMatch();
        watching = pending;
        matchUnsub = onSnapshot(doc(firestore, 'matches', pending), (matchSnap) => {
          const data = matchSnap.exists() ? { id: matchSnap.id, ...matchSnap.data() } : null;
          if (!data || data.status === 'COMPLETED') {
            if (data?.status === 'COMPLETED') grantMatchResult(data, user.uid).catch(() => {});
            updateDoc(doc(firestore, 'players', user.uid), { pendingMatchId: null }).catch(() => {});
            setSession((current) => ({ ...current, match: null, lastMatch: data || current.lastMatch }));
            return;
          }
          setSession((current) => ({ ...current, ready: true, user, player, match: data, error: '' }));
        }, (error) => {
          setSession((current) => ({ ...current, ready: true, error: error.message }));
        });
      }, (error) => {
        setSession((current) => ({ ...current, ready: true, user, error: error.message }));
      });
    });

    return () => {
      authUnsub();
      playerUnsub();
      stopMatch();
    };
  }, []);

  return session;
}
