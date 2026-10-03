export default function CreditDisplay() {
  const credits = 4200;

  return (
    <div className="credit-display">
      <span>Credits</span>
      <strong>{credits}</strong>
    </div>
  );
}