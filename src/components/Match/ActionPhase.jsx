import { useMatchStore } from '../../store/matchStore';
import { usePhaseTimer } from '../../hooks/usePhaseTimer';
import SkinInventory from '../HUD/SkinInventory';
import RoundTimer from '../HUD/RoundTimer';

// This is the HUD overlay shown during live combat — NOT the 3D game view
// itself. The 3D scene (whatever engine renders it, see game/README.md)
// mounts separately underneath/behind this overlay.
export default function ActionPhase() {
  const phaseEndsAtMs = useMatchStore((s) => s.phaseEndsAtMs);
  const remainingSec = usePhaseTimer(phaseEndsAtMs);
  const score = useMatchStore((s) => s.score);
  const extractor = useMatchStore((s) => s.extractor);
  const killFeedLive = useMatchStore((s) => s.killFeedLive);

  return (
    <div className="action-phase-hud">
      <RoundTimer remainingSec={remainingSec} />
      <div className="scoreboard">{score.ATLAS} — {score.OUTLIERS}</div>
      <div className="extractor-status">Data-Extractor: {extractor.state}</div>
      <SkinInventory />
      <div className="kill-feed">
        {killFeedLive.slice(-5).map((k, i) => (
          <div key={i}>{k.killerId} ➜ {k.victimId} ({k.weapon})</div>
        ))}
      </div>
    </div>
  );
}
