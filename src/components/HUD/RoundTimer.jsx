const PHASE_LABEL = {
  buy: 'Buy',
  prep: 'Prep',
  action: 'Action',
  result: 'Round over',
};

export default function RoundTimer({ label = '0:00', phase = '', urgent = false }) {
  return (
    <div className={`round-timer ${urgent ? 'urgent' : ''}`}>
      <strong>{label}</strong>
      <span>{PHASE_LABEL[phase] || String(phase || '').toUpperCase()}</span>
    </div>
  );
}
