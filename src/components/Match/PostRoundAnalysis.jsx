import { useEffect, useState } from 'react';
import { getMatchSummary } from '../../firebase/matchService';

// The "3D Wireframe Replay Theater" from the design doc — showing the
// structural timeline of skin changes. This component fetches the archived
// round data; actually scrubbing through a 3D replay is a game-engine
// feature (see game/README.md), this renders the supporting timeline/stats UI.
export default function PostRoundAnalysis({ matchId, roundNumber }) {
  const [round, setRound] = useState(null);

  useEffect(() => {
    getMatchSummary(matchId).then((match) => {
      setRound(match?.rounds?.[roundNumber] ?? null);
    });
  }, [matchId, roundNumber]);

  if (!round) return <div>Loading replay data…</div>;

  return (
    <div className="post-round-analysis">
      <h2>Round {roundNumber} — {round.winner} won ({round.winCondition})</h2>
      <h3>Skin Synergy Timeline</h3>
      <ul>
        {round.skinEvents.map((e, i) => (
          <li key={i}>
            [{Math.round(e.timestampMs / 1000)}s] {e.playerId} {e.action} {e.targetObjectId}
            {' '}({e.materialBefore} → {e.materialAfter})
            {e.ledToKill && ' — led to a kill'}
            {e.ledToObjectiveDelay && ' — delayed objective'}
          </li>
        ))}
      </ul>
      {/* TODO: button to launch 3D Wireframe Replay Theater (engine layer) */}
    </div>
  );
}
