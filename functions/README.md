# Cloud Functions (server-authoritative logic)

Anything that affects scoring, credits, or match outcome must be decided
here, not trusted from the client. Suggested functions to build:

- `onQueueEntryCreated` — watches `matchmakingQueue`, groups 10 players by
  TC-MMR, creates a `matches/{id}` doc + `liveMatches/{id}` RTDB node, clears
  the matched queue entries.
- `onPhaseTimerExpired` (scheduled/pub-sub or triggered) — advances
  `liveMatches/{id}/phase` (BUY → PREP → ACTION → POST_ROUND → next round's
  BUY), recalculates `phaseEndsAtMs`.
- `onRoundEnd` — computes round winner from server-tracked state, awards
  credits per the round's performance, applies Skin Synergy Assist bonuses
  to TC-MMR, archives the round into `matches/{id}/rounds/{n}` in Firestore,
  clears `liveMatches/{id}/surfaces` back to defaults for the next round.
- `onSkinEventReported` — validates a claimed unskin/reskin (does the player
  own the cartridge, are they in range, is the target a valid skin-able
  surface) before it's allowed to update `liveMatches/{id}/surfaces/{id}`.

None of these are implemented yet — this is a placeholder describing what
belongs server-side vs. what the React client in src/ should only ever read.
