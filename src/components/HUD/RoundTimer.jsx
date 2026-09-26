export default function RoundTimer({ remainingSec }) {
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');
  return <div className="round-timer">{mm}:{ss}</div>;
}
