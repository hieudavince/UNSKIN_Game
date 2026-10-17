# Skin Gun FPS — Project Scaffold

Working title for the M-Skin tactical FPS (Atlas Industry vs Outliers).

## Stack
- **React 18 + Vite** — UI shell, HUD, menus, lobby, match-flow screens
- **Zustand** — client-side state (lighter than Redux for fast-changing game state)
- **Firebase**
  - **Firestore** — persistent data: player profiles, inventories, match history, MMR
  - **Realtime Database** — live match state: round timer, phase, skin-swap events, scores (RTDB is lower-latency for high-frequency writes than Firestore)
  - **Cloud Functions** — server-authoritative logic: round transitions, economy payouts, MMR calculation (never trust client for these)
  - **Auth** — Steam OpenID via a custom token exchange (Firebase Auth doesn't support Steam natively — see note in firebase/config.js)

## Important reality check
Actual gunplay, 3D rendering, hit detection, and real-time positional netcode for a
competitive 5v5 FPS **cannot run through React DOM**. That layer needs a real-time
engine (Three.js + WebGL at minimum, more realistically Unreal/Unity with a dedicated
game server, or a WebGL engine like Babylon.js/PlayCanvas with authoritative
server-side hit-reg). This scaffold treats React as the **meta-game shell**:
lobby, buy phase, HUD, post-round analysis, matchmaking, drafting. The `src/game/`
folder is where a WebGL canvas would mount, with the Skin Gun *data model*
(material types, wireframe void state) defined so it can be shared between the
meta-game and whatever renders the 3D scene.

## Folder structure
```
src/
  firebase/     Firebase init + service functions (reads/writes)
  store/        Zustand stores (client state, mirrors RTDB where needed)
  components/
    Lobby/      Matchmaking queue, Skin Ban/Pick draft
    Match/      Buy Phase, Prep Phase, Action Phase HUD wrapper, Post-Round Analysis
    HUD/        Reusable in-match widgets (inventory, credits, timer)
  game/         Skin Gun system data model (material types, wireframe void logic)
  hooks/        Shared React hooks (match state subscription, phase timer)
  constants/    Enums, config values
  types/        JSDoc typedefs (or swap to .ts if you want real TypeScript)
```

## Next steps
1. `npm create vite@latest . -- --template react` (if not already scaffolded)
2. `npm install firebase zustand`
3. Fill in `src/firebase/config.js` with your Firebase project keys
4. Stand up Cloud Functions for round-transition logic (client should never
   decide "round over" — trust nothing the client reports for scoring/economy)
