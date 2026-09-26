import { useMatchStore } from '../../store/matchStore';
import { MATERIAL_PROPERTIES } from '../../constants/materials';

// TODO: wire `me` up to the authenticated player's id (from firebase/config auth state)
export default function SkinInventory({ playerId: me }) {
  const inventory = useMatchStore((s) => s.players[me]?.skinInventory ?? {});

  return (
    <div className="skin-inventory">
      {Object.entries(inventory).map(([material, count]) => (
        <div key={material} className="skin-slot">
          <span>{MATERIAL_PROPERTIES[material]?.label ?? material}</span>
          <span className="count">×{count}</span>
        </div>
      ))}
    </div>
  );
}
