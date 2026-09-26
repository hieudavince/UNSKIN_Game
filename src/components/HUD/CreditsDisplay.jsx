import { useEconomyStore } from '../../store/economyStore';

export default function CreditsDisplay() {
  const credits = useEconomyStore((s) => s.credits);
  return <div className="credits-display">{credits} cr</div>;
}
