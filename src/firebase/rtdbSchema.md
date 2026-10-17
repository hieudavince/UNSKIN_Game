# Realtime Database Schema (live match state)

High-frequency writes during a live match — phase timer, skin-swap events as
they happen, live scoreboard. Mirrors relevant slices into `store/matchStore.js`
via a live subscription (see hooks/useMatchState.js). On match end, a Cloud
Function reads this out and archives the final summary into Firestore
(`matches/{matchId}/rounds/{n}`), then this node can be cleared.

```
liveMatches/{matchId}
  phase: "BUY" | "PREP" | "ACTION" | "POST_ROUND"
  phaseEndsAtMs: number          // client computes remaining time from this, not a local countdown
  currentRound: number
  score: { ATLAS: number, OUTLIERS: number }

  players/{playerId}
    faction: "ATLAS" | "OUTLIERS"
    alive: boolean
    credits: number
    skinInventory: { TITANIUM: number, GLASS: number, ... }  // owned cartridges this round

  surfaces/{objectId}             // every skin-able object in the map
    currentMaterial: string       // one of MATERIAL_TYPES, or WIREFRAME_VOID
    lastModifiedBy: string        // playerId
    lastModifiedAtMs: number

  extractor:
    state: "NOT_PLANTED" | "PLANTED" | "DEFUSING" | "DETONATED" | "DEFUSED"
    plantedBy: string | null
    plantedAtMs: number | null

  killFeedLive: [ { killerId, victimId, weapon, timestampMs } ]  // append-only during round, archived after
```

Security-rules note: writes to `phase`, `score`, `extractor.state` and anything
scoring-related should be restricted to a Cloud Function / server context —
clients should only be able to write their own `surfaces/{id}` changes and
`players/{myId}` movement/inventory-use, everything authoritative goes through
functions so a modified client can't grant itself rounds or credits.
