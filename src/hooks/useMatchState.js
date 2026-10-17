import { useEffect } from 'react';
import { useMatchStore } from '../store/matchStore';

/** Connect a component tree to a live match. Call once at the top of your
 * Match layout: useMatchState(matchId). Children read state via useMatchStore. */
export function useMatchState(matchId) {
  const connect = useMatchStore((s) => s.connect);
  const disconnect = useMatchStore((s) => s.disconnect);

  useEffect(() => {
    if (!matchId) return;
    connect(matchId);
    return () => disconnect();
  }, [matchId]);
}
