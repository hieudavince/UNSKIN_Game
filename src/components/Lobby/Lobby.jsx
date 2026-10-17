import MatchmakingQueue from './MatchmakingQueue';
import Locker from './Locker';
import SettingsPanel from '../SettingsPanel';

// Main menu: wide two-column layout that grows with the window
// (queue + modes on the left, locker with previews + settings on the right).
export default function Lobby({ session, preview = false }) {
  return (
    <main className="screen lobby-screen">
      <div className="lobby">
        <div className="lobby-main">
          <MatchmakingQueue
            playerId={session.user?.uid}
            tcMmr={session.player?.tcMmr || 1000}
            displayName={session.player?.displayName}
            lastMatch={session.lastMatch}
            preview={preview}
          />
        </div>
        <div className="lobby-side">
          <Locker player={session.player} preview={preview} />
          <SettingsPanel />
        </div>
      </div>
      {session.error ? <p className="error">{session.error}</p> : null}
    </main>
  );
}
