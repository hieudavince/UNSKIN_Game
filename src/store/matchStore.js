import { create } from 'zustand';
import { subscribeToLiveMatch } from '../firebase/matchService';

// Mirrors the live RTDB match state into client state so components don't
// each open their own Firebase listener. Call connect(matchId) once, e.g.
// from a top-level Match layout component's useEffect.
export const useMatchStore = create((set, get) => ({
  matchId: null,
  phase: null,
  phaseEndsAtMs: null,
  score: { ATLAS: 0, OUTLIERS: 0 },
  players: {},
  surfaces: {},
  extractor: { state: 'NOT_PLANTED' },
  killFeedLive: [],
  _unsubscribe: null,

  connect(matchId) {
    get()._unsubscribe?.();
    const unsubscribe = subscribeToLiveMatch(matchId, (data) => {
      if (!data) return;
      set({
        matchId,
        phase: data.phase,
        phaseEndsAtMs: data.phaseEndsAtMs,
        score: data.score ?? { ATLAS: 0, OUTLIERS: 0 },
        players: data.players ?? {},
        surfaces: data.surfaces ?? {},
        extractor: data.extractor ?? { state: 'NOT_PLANTED' },
        killFeedLive: data.killFeedLive ?? [],
      });
    });
    set({ _unsubscribe: unsubscribe });
  },

  disconnect() {
    get()._unsubscribe?.();
    set({ _unsubscribe: null, matchId: null });
  },
}));
