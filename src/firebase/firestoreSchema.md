# Firestore Schema (persistent data)

Use Firestore for anything that outlives a single match: profiles, inventory,
match history, leaderboards. Use Realtime Database (see rtdbSchema.md) for
anything that changes many times per second during a live match.

## `players/{steamId}`
```
{
  displayName: string,
  steamId: string,
  createdAt: timestamp,
  tcMmr: number,              // Tactical Contribution MMR
  credits: number,            // persistent economy balance (if carried across matches)
  ownedSkins: string[],       // MATERIAL_TYPES unlocked/owned, if you gate cosmetics
  stats: {
    matchesPlayed: number,
    wins: number,
    losses: number,
    kills: number,
    deaths: number,
    skinSynergyAssists: number,  // core TC-MMR stat: wall-hacks that led to a kill/defuse-delay
  }
}
```

## `matches/{matchId}`
```
{
  createdAt: timestamp,
  mapId: string,
  mode: 'RANKED' | 'CASUAL',
  teams: {
    ATLAS: { playerIds: string[] },
    OUTLIERS: { playerIds: string[] }
  },
  bannedMaterials: { ATLAS: string, OUTLIERS: string },  // Skin Ban/Pick draft result
  finalScore: { ATLAS: number, OUTLIERS: number },
  winner: 'ATLAS' | 'OUTLIERS',
  status: 'DRAFTING' | 'IN_PROGRESS' | 'COMPLETED',
  rtdbPath: string,  // pointer to live match state in Realtime DB while IN_PROGRESS
}
```

## `matches/{matchId}/rounds/{roundNumber}` (subcollection, written post-round)
```
{
  winner: 'ATLAS' | 'OUTLIERS',
  winCondition: 'ELIMINATION' | 'EXTRACTOR_DETONATED' | 'EXTRACTOR_DEFUSED' | 'TIME_EXPIRED',
  skinEvents: [
    {
      playerId: string,
      action: 'UNSKIN' | 'RESKIN',
      targetObjectId: string,
      materialBefore: string,
      materialAfter: string,
      timestampMs: number,       // ms into the Action Phase, for replay scrubbing
      ledToKill: boolean,        // drives Skin Synergy Assist scoring
      ledToObjectiveDelay: boolean,
    }
  ],
  killFeed: [
    { killerId: string, victimId: string, weapon: string, throughMaterial: string|null, timestampMs: number }
  ]
}
```

## `matchmakingQueue/{queueEntryId}`
```
{
  playerId: string,
  mode: 'RANKED' | 'CASUAL',
  tcMmr: number,
  queuedAt: timestamp,
}
```
Matched by a Cloud Function watching this collection — never match client-side.
