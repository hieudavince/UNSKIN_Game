export default function AmmoCounter() {
  const ammo = 24;
  const reserveAmmo = 90;

  return (
    <div className="ammo-counter">
      {ammo} / {reserveAmmo}
    </div>
  );
}