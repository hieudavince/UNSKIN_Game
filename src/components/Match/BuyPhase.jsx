import { useEffect, useState } from 'react';
import { emitInventory } from './ActionPhase';
import { AMMO_PRICE, BOMB_PRICE, fillAmmo, GUN_LIST, GUNS } from '../../constants/weapons';

const PRICE = { glass: 200, wood: 100, iron: 250, rubber: 180 };
const AMOUNT = { glass: 8, wood: 8, iron: 8, rubber: 8 };
const MATERIALS = [
  ['glass', 'Glass', 200],
  ['wood', 'Wood', 100],
  ['iron', 'Iron', 250],
  ['rubber', 'Rubber', 180],
];

function sync(game) {
  game.sfx?.cash?.();
  game.emit('game:credits', { credits: game.credits });
  emitInventory(game);
  game.onHud?.();
}

export function tryBuy(game, material) {
  if (!game || game.dead || game.phase !== 'buy') return false;
  const name = String(material || '').toLowerCase();
  const cost = PRICE[name];
  if (!cost || name === game.bannedMaterial || game.credits < cost) return false;
  game.credits -= cost;
  game.stock[name] = Math.round(((game.stock[name] || 0) + AMOUNT[name]) * 100) / 100;
  sync(game);
  return true;
}

function tryGun(game, id) {
  const spec = GUNS[id];
  if (!game || game.phase !== 'buy' || !spec || game.owned?.[id]) return;
  if (game.credits < spec.price) return;
  game.credits -= spec.price;
  game.owned[id] = true;
  fillAmmo(game.ammo, id);
  sync(game);
}

function tryBomb(game) {
  if (!game || game.phase !== 'buy' || game.credits < BOMB_PRICE || (game.bombs || 0) >= 2) return;
  game.credits -= BOMB_PRICE;
  game.bombs = (game.bombs || 0) + 1;
  sync(game);
}

function tryAmmo(game) {
  if (!game || game.phase !== 'buy' || game.credits < AMMO_PRICE) return;
  const owned = ['pistol', 'rifle', 'shotgun', 'sniper'].filter((id) => id === 'pistol' || game.owned?.[id]);
  if (!owned.length) return;
  game.credits -= AMMO_PRICE;
  owned.forEach((id) => fillAmmo(game.ammo, id));
  sync(game);
}

export default function BuyPhase({ gameRef, onClose }) {
  const [credits, setCredits] = useState(800);
  const [stock, setStock] = useState({});
  const [owned, setOwned] = useState({});
  const [bombs, setBombs] = useState(0);
  const [banned, setBanned] = useState(null);

  const pull = () => {
    const game = gameRef.current;
    if (!game) return;
    setCredits(game.credits);
    setStock({ ...game.stock });
    setOwned({ ...game.owned });
    setBombs(game.bombs || 0);
    setBanned(game.bannedMaterial);
  };

  useEffect(() => {
    pull();
    const onBuy = (event) => {
      tryBuy(gameRef.current, event.detail?.material ?? event.detail);
      pull();
    };
    window.addEventListener('game:credits', pull);
    window.addEventListener('hud:buy', onBuy);
    return () => {
      window.removeEventListener('game:credits', pull);
      window.removeEventListener('hud:buy', onBuy);
    };
  }, [gameRef]);

  return (
    <section className="buy-panel">
      <p className="eyebrow">BUY PHASE</p>
      <h2>¢ {credits}</h2>
      <p className="meta">You start with a pistol and 8 m² of each material. Right click zooms guns. On the skin gun, right click cycles material.</p>
      <div className="buy-grid guns">
        {GUN_LIST.map((gun) => (
          <button key={gun.id} className="buy-item" disabled={owned[gun.id] || credits < gun.price} onClick={() => { tryGun(gameRef.current, gun.id); pull(); }}>
            <strong>{gun.label}</strong>
            <span>{owned[gun.id] ? 'Owned' : `¢${gun.price}`}</span>
          </button>
        ))}
        <button className="buy-item" disabled={bombs >= 2 || credits < BOMB_PRICE} onClick={() => { tryBomb(gameRef.current); pull(); }}>
          <strong>Bomb</strong>
          <span>{bombs >= 2 ? 'Full' : `¢${BOMB_PRICE} · ${bombs}/2`}</span>
        </button>
        <button className="buy-item" disabled={credits < AMMO_PRICE} onClick={() => { tryAmmo(gameRef.current); pull(); }}>
          <strong>Ammo</strong>
          <span>¢{AMMO_PRICE} refill</span>
        </button>
      </div>
      <div className="buy-grid">
        {MATERIALS.map(([id, label, cost]) => (
          <button
            key={id}
            className={`buy-item ${id}`}
            disabled={id === banned || credits < cost}
            onClick={() => { tryBuy(gameRef.current, id); pull(); }}
          >
            <i />
            <strong>{label}</strong>
            <span>{id === banned ? 'Banned' : `¢${cost} · +8 m²`}</span>
            <span>Have {Math.floor(stock[id] ?? 0)} m²</span>
          </button>
        ))}
      </div>
      <button className="close" onClick={onClose}>Close <kbd>B</kbd></button>
    </section>
  );
}
