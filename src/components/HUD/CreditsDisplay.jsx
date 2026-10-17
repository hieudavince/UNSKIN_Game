export default function CreditsDisplay({ credits = 0 }) {
  return (
    <div className="credit-display">
      <span>¢</span>
      <strong>{credits}</strong>
    </div>
  );
}
