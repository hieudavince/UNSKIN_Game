import { useState } from 'react';
import { MATERIAL_TYPES, MATERIAL_PROPERTIES } from '../../constants/materials';
import { DRAFT } from '../../constants/gameConfig';

// Ranked-only pre-match draft: each team bans DRAFT.BANS_PER_TEAM material(s),
// then picks loadouts. This is a simplified single-player-view stub —
// real-time sync between both teams' picks should go through RTDB, similar
// to liveMatches, e.g. draftSessions/{matchId}.
export default function SkinBanPick({ onBanConfirmed }) {
  const [banned, setBanned] = useState(null);

  const handleBan = (materialType) => {
    setBanned(materialType);
    onBanConfirmed?.(materialType);
  };

  return (
    <div className="skin-ban-pick">
      <h2>Ban a Material ({DRAFT.BANS_PER_TEAM} per team)</h2>
      <div className="material-grid">
        {Object.values(MATERIAL_TYPES)
          .filter((t) => t !== MATERIAL_TYPES.CONCRETE)
          .map((type) => (
            <button
              key={type}
              disabled={!!banned}
              className={banned === type ? 'selected' : ''}
              onClick={() => handleBan(type)}
            >
              {MATERIAL_PROPERTIES[type].label}
            </button>
          ))}
      </div>
      {/* TODO: loadout pick phase after both teams' bans are locked in */}
    </div>
  );
}
