import { useMatchStore } from '../../store/matchStore';
import { useEconomyStore } from '../../store/economyStore';
import { usePhaseTimer } from '../../hooks/usePhaseTimer';
import { MATERIAL_TYPES, MATERIAL_PROPERTIES } from '../../constants/materials';

export default function BuyPhase() {
  const phaseEndsAtMs = useMatchStore((s) => s.phaseEndsAtMs);
  const remainingSec = usePhaseTimer(phaseEndsAtMs);
  const { credits, cart, addToCart, removeFromCart } = useEconomyStore();

  return (
    <div className="buy-phase">
      <header>
        <h2>Buy Phase</h2>
        <span className="timer">{remainingSec}s</span>
        <span className="credits">{credits} cr</span>
      </header>

      <section className="skin-shop">
        {Object.values(MATERIAL_TYPES).map((type) => {
          const props = MATERIAL_PROPERTIES[type];
          if (props.creditCost === 0) return null; // skip CONCRETE (default, not purchasable)
          return (
            <button
              key={type}
              disabled={credits < props.creditCost}
              onClick={() => addToCart(type, props.creditCost)}
            >
              {props.label} — {props.creditCost} cr
            </button>
          );
        })}
      </section>

      <section className="cart">
        <h3>Cart</h3>
        <ul>
          {cart.map((item, i) => (
            <li key={i}>
              {item.materialType} ({item.cost} cr)
              <button onClick={() => removeFromCart(i)}>Remove</button>
            </li>
          ))}
        </ul>
      </section>

      {/* TODO: traditional weapons/armor shop panel alongside skin cartridges */}
      {/* TODO: on phase end, commit cart to server via a Cloud Function call
          rather than trusting the client-held credits balance */}
    </div>
  );
}
