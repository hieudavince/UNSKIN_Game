import { useEffect } from 'react';
import { emitInventory } from './ActionPhase';

const PRICE = {
  titanium: 400,
  glass: 250,
  rubber: 200,
};

const SELLABLE = new Set(['titanium', 'glass', 'rubber']);

export function tryBuy(game, material) {
  if (!game || game.dead || game.phase !== 'buy') return;
  const name = String(material || '').toLowerCase();
  if (!SELLABLE.has(name) || name === game.bannedMaterial) return;
  const cost = PRICE[name];
  if (!cost || game.credits < cost) return;
  game.credits -= cost;
  game.inventory.push(name);
  game.slotIndex = game.inventory.length - 1;
  game.emit('game:credits', { credits: game.credits });
  emitInventory(game);
}

export default function BuyPhase({ gameRef }) {
  useEffect(() => {
    const onBuy = (event) => {
      const material = event.detail?.material ?? event.detail;
      tryBuy(gameRef.current, material);
    };
    window.addEventListener('hud:buy', onBuy);
    return () => window.removeEventListener('hud:buy', onBuy);
  }, [gameRef]);

  return null;
}
