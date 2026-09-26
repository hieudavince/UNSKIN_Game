import { useMatchStore } from '../../store/matchStore';
import { usePhaseTimer } from '../../hooks/usePhaseTimer';

// Defenders fortify sites (Titanium doors, Rubber bounce traps) while
// attackers scan with recon drones. The actual 3D fortification/scanning
// happens in the game engine layer (see game/README.md) — this component is
// the HUD overlay: timer, objective reminders, drone-scan results feed.
export default function PrepPhase() {
  const phaseEndsAtMs = useMatchStore((s) => s.phaseEndsAtMs);
  const remainingSec = usePhaseTimer(phaseEndsAtMs);
  const surfaces = useMatchStore((s) => s.surfaces);

  return (
    <div className="prep-phase">
      <header>
        <h2>Prep Phase</h2>
        <span className="timer">{remainingSec}s</span>
      </header>

      {/* TODO: attacker-only recon drone panel — surfaces the defenders have
          already reskinned this round, pulled from `surfaces` */}
      <section className="scanned-defenses">
        {Object.entries(surfaces)
          .filter(([, s]) => s.lastModifiedAtMs)
          .map(([id, s]) => (
            <div key={id}>{id}: {s.currentMaterial}</div>
          ))}
      </section>
    </div>
  );
}
