import { useState } from 'react';
import MatchmakingQueue from './components/Lobby/MatchmakingQueue';
import MatchLayout from './components/Match/MatchLayout';

// TODO: replace with real auth state once Steam login is wired up (see
// firebase/config.js note on Steam OpenID -> Firebase custom token flow)
const STUB_PLAYER_ID = 'stub-player-1';

export default function App() {
  const [activeMatchId, setActiveMatchId] = useState(null);

  if (activeMatchId) {
    return <MatchLayout matchId={activeMatchId} />;
  }

  return (
    <div className="app-shell">
      <h1>Skin Gun FPS</h1>
      <MatchmakingQueue playerId={STUB_PLAYER_ID} tcMmr={1000} />
      {/* TODO: once matchmaking finds a match, setActiveMatchId(foundMatchId) */}
    </div>
  );
}
