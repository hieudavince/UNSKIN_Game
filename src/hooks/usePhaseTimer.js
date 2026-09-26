import { useEffect, useState } from 'react';

/** Ticks down to a server-provided `phaseEndsAtMs` timestamp. Always derive
 * remaining time from the server timestamp, never a local setInterval count —
 * clients drift and a client-only timer can be trivially cheated. */
export function usePhaseTimer(phaseEndsAtMs) {
  const [remainingSec, setRemainingSec] = useState(0);

  useEffect(() => {
    if (!phaseEndsAtMs) return;
    const tick = () => {
      const remaining = Math.max(0, Math.round((phaseEndsAtMs - Date.now()) / 1000));
      setRemainingSec(remaining);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [phaseEndsAtMs]);

  return remainingSec;
}
