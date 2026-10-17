const MATERIALS = [
  ['glass', 'Glass'],
  ['wood', 'Wood'],
  ['iron', 'Iron'],
  ['rubber', 'Rubber'],
];

export default function SkinStatus({ material = 'glass', stock = {}, banned = null, active = false, hold = null }) {
  return (
    <div className={`skin-status ${active ? 'active' : ''}`}>
      {MATERIALS.map(([id, label]) => (
        <div key={id} className={`chip ${id} ${material === id ? 'on' : ''} ${banned === id ? 'banned' : ''}`}>
          <span>{label}</span>
          <strong>{banned === id ? 'Ban' : Math.floor(stock[id] ?? 0)}</strong>
        </div>
      ))}
      {active ? <div className="hold">Right click cycles material</div> : null}
      {hold != null ? <div className="hold">Uplink {hold}s</div> : null}
    </div>
  );
}
