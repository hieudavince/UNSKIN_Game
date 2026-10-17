export default function PlayerVitals({ hp = 100 }) {
  const value = Math.max(0, Math.min(100, hp));
  const tone = value <= 25 ? 'low' : value <= 60 ? 'mid' : '';
  return (
    <div className={`player-vitals ${tone}`}>
      <strong>{value}</strong>
      <div className="bar"><i style={{ width: `${value}%` }} /></div>
      <span>HP</span>
    </div>
  );
}
