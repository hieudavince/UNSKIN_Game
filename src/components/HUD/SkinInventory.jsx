export default function SkinInventory() {
  const skins = [
    "METAL",
    "GLASS",
    "CERAMIC",
    "VOID",
  ];

  return (
    <div className="skin-inventory">
      {skins.map((skin) => (
        <button key={skin}>
          {skin}
        </button>
      ))}
    </div>
  );
}