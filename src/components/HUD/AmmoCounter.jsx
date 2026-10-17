const WEAPON_LABEL = {
  pistol: 'Pistol',
  rifle: 'Rifle',
  shotgun: 'Shotgun',
  sniper: 'Sniper',
  portal: 'Skin Gun',
  melee: 'Knife',
  utility: 'Bomb',
  hack: 'Hack Chip',
};

export default function AmmoCounter({ ammo = '—', weapon = 'pistol' }) {
  return (
    <div className="ammo-counter">
      <strong>{ammo}</strong>
      <span>{WEAPON_LABEL[weapon] || weapon}</span>
    </div>
  );
}
