export default function PlayerVitals() {
  const hp = 85;
  const armor = 60;

  return (
    <div className="player-vitals">
      <div>
        <span>HP</span>
        <progress max="100" value={hp} />
        <span>{hp}</span>
      </div>

      <div>
        <span>Armor</span>
        <progress max="100" value={armor} />
        <span>{armor}</span>
      </div>
    </div>
  );
}
``