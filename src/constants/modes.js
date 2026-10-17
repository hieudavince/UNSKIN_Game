export const MODES = {
  PRACTICE: { id: 'PRACTICE', label: 'Practice', detail: 'Learn the map', teamSize: 1, players: 1, roundsToWin: 3 },
  DUEL: { id: 'DUEL', label: '1 vs 1', detail: 'Duel', teamSize: 1, players: 2, roundsToWin: 4 },
  DUO: { id: 'DUO', label: '2 vs 2', detail: 'Duo', teamSize: 2, players: 4, roundsToWin: 4 },
  TRIO: { id: 'TRIO', label: '3 vs 3', detail: 'Trio', teamSize: 3, players: 6, roundsToWin: 5 },
  SQUAD: { id: 'SQUAD', label: '5 vs 5', detail: 'Full match', teamSize: 5, players: 10, roundsToWin: 6 },
  // Free-for-all on the big multi-level Helix Complex. Starts with a full lobby
  // of 8, or with everyone queued (2+) once the oldest player waited 15 s.
  FFA: {
    id: 'FFA',
    label: 'Free for all',
    detail: '2–8 players · Helix Complex',
    teamSize: 0,
    players: 8,
    minPlayers: 2,
    fillWaitMs: 15000,
    roundsToWin: 1,
    ffa: true,
    mapId: 'complex',
    killTarget: 20,
    respawnMs: 3000,
    protectMs: 2000,
  },
};

export const MODE_LIST = [MODES.PRACTICE, MODES.DUEL, MODES.DUO, MODES.TRIO, MODES.SQUAD, MODES.FFA];

export const PHASE_MS = {
  BUY: 20000,
  PREP: 5000,
  ACTION: 150000,
  POST_ROUND: 8000,
};

// FFA is a single long round: short warm-up, 8 minute action phase.
export const FFA_PHASE_MS = {
  BUY: 8000,
  PREP: 3000,
  ACTION: 480000,
  POST_ROUND: 10000,
};

export function phaseMs(mode, phase) {
  return (modeOf(mode).ffa ? FFA_PHASE_MS : PHASE_MS)[phase];
}

export function mapIdOf(mode) {
  return modeOf(mode).mapId || 'foundry';
}

export const DRAFT_MS = 25000;
export const MAX_ROUNDS = 11;
export const MATERIALS = ['glass', 'wood', 'iron', 'rubber'];

export function modeOf(id) {
  return MODES[id] || MODES.PRACTICE;
}
