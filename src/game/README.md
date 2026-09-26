# game/

This folder is intentionally engine-agnostic data/logic (skinGunSystem.js).

To actually render and play a match you need a real-time 3D layer. Options,
roughly in order of how much of "the vision" they can deliver:

1. **Three.js / React Three Fiber canvas mounted inside a React route** —
   feasible for a stylized low-poly prototype, browser-native, but you'd be
   writing your own netcode (WebSockets or WebRTC + a game server) for
   position sync, hit registration, and lag compensation — Firebase RTDB is
   too high-latency and not designed for 60Hz positional sync.
2. **Babylon.js / PlayCanvas** — same tradeoffs as Three.js, slightly more
   game-engine tooling out of the box (physics, colliders).
3. **Unity or Unreal** as the actual game client, with React reserved for the
   meta-game (this scaffold: lobby, buy phase, stats site, Steam store page
   overlay). This is the realistic path for the "5v5 competitive tactical
   FPS on Steam" scope described in the design doc — that's the standard
   stack for shipped competitive shooters, not a browser canvas.

This scaffold assumes option 3: React owns everything *around* the match
(menus, economy, drafting, post-match analysis, Steam integration), and the
actual match client is a separate Unity/Unreal build that talks to the same
Firebase project (or a dedicated game server) for match state.
