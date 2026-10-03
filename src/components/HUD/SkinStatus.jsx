export default function SkinStatus() {
  const currentSkin = "METAL";
  const durability = 85;

  return (
    <div className="skin-status">
      <h3>{currentSkin}</h3>

      <progress
        max="100"
        value={durability}
      />

      <span>{durability}%</span>
    </div>
  );
}