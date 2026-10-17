export const MATCH_FORMAT = {
  ROUNDS_TO_WIN: 6,        // Best-of-11
  MAX_ROUNDS: 11,
  TEAM_SIZE: 5,
};

export const PHASE = {
  BUY: 'BUY',
  PREP: 'PREP',
  ACTION: 'ACTION',
  POST_ROUND: 'POST_ROUND',
};

export const PHASE_DURATIONS_SEC = {
  [PHASE.BUY]: 45,
  [PHASE.PREP]: 30,
  [PHASE.ACTION]: 180,
  [PHASE.POST_ROUND]: 20, // replay/analysis screen before next Buy Phase
};

export const FACTIONS = {
  ATLAS: 'ATLAS',       // attackers — plant Data-Extractor
  OUTLIERS: 'OUTLIERS',  // defenders — prevent/defuse
};

export const STARTING_CREDITS = 800;
export const MAX_CREDITS = 9000;

// Ranked draft phase
export const DRAFT = {
  BANS_PER_TEAM: 1,
};
