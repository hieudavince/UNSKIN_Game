export default function SkinInventory({ slots = [] }) {
  return (
    <div className="skin-inventory">
      {slots.length ? slots.map((skin, index) => (
        <span key={`${skin}-${index}`}>{skin}</span>
      )) : <span>empty</span>}
    </div>
  );
}
