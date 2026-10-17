import { useState } from 'react';
import { MATERIAL_TYPES, MATERIAL_PROPERTIES } from '../../constants/materials';
import { DRAFT } from '../../constants/gameConfig';

// Ranked-only pre-match draft: each team bans DRAFT.BANS_PER_TEAM material
// the other team can't use this match. Picks sync through Firestore; the
// host locks the draft when everyone has picked or the timer runs out.
export default function SkinBanPick({ onBanConfirmed, secondsLeft, faction, picked }) {
  const [banned, setBanned] = useState(null);
  const locked = !!banned || picked;

  const handleBan = (materialType) => {
    setBanned(materialType);
    onBanConfirmed?.(materialType);
  };

  return (
    <div className="skin-ban-pick panel">
      <p className="eyebrow">RANKED DRAFT · {faction}</p>
      <h2>Ban a Material ({DRAFT.BANS_PER_TEAM} per team)</h2>
      <p className="meta">Choose a material the other team cannot use this match.</p>
      <div className="material-grid">
        {Object.values(MATERIAL_TYPES)
          .filter((t) => t !== MATERIAL_TYPES.CONCRETE)
          .map((type) => (
            <button
              key={type}
              disabled={locked}
              className={`material ${type.toLowerCase()} ${banned === type ? 'selected' : ''}`}
              onClick={() => handleBan(type)}
            >
              <i />
              {MATERIAL_PROPERTIES[type].label}
            </button>
          ))}
      </div>
      <p className="meta">
        {locked ? 'Locked in · waiting for the other team' : 'Waiting for your ban'}
        {typeof secondsLeft === 'number' ? ` · ${secondsLeft}s` : ''}
      </p>
    </div>
  );
}
