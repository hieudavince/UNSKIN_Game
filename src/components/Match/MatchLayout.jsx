import { useMatchState } from '../../hooks/useMatchState';
import { useMatchStore } from '../../store/matchStore';
import { PHASE } from '../../constants/gameConfig';
import BuyPhase from './BuyPhase';
import PrepPhase from './PrepPhase';
import ActionPhase from './ActionPhase';
import PostRoundAnalysis from './PostRoundAnalysis';

// Top-level router for an in-progress match: subscribes to live match state
// once, then renders whichever phase component matches the current phase.
export default function MatchLayout({ matchId }) {
  useMatchState(matchId);
  const phase = useMatchStore((s) => s.phase);
  const currentRound = useMatchStore((s) => s.currentRound);

  switch (phase) {
    case PHASE.BUY:
      return <BuyPhase />;
    case PHASE.PREP:
      return <PrepPhase />;
    case PHASE.ACTION:
      return <ActionPhase />;
    case PHASE.POST_ROUND:
      return <PostRoundAnalysis matchId={matchId} roundNumber={currentRound} />;
    default:
      return <div>Connecting to match…</div>;
  }
}
