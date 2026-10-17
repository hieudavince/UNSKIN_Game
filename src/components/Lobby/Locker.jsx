import { useEffect, useRef, useState } from 'react';
import { GUN_SKINS, SUITS, gunSkinOf, levelFromXp, suitOf } from '../../constants/weapons';
import { buyCosmetic } from '../../firebase/progression';
import { drawPreview } from './cosmeticPreview';

function Thumb({ kind, gun, suit }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) drawPreview(ref.current, { kind, gun, suit }).catch(() => {});
  }, [kind, gun, suit]);
  return <canvas ref={ref} className="thumb" width={220} height={130} />;
}

// Large slowly rotating preview of the focused item.
function Turntable({ kind, gun, suit }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf = 0;
    let dead = false;
    let busy = false;
    const start = performance.now();
    const tick = () => {
      if (dead) return;
      const canvas = ref.current;
      if (canvas && !busy) {
        busy = true;
        const t = (performance.now() - start) / 1000;
        // guns sway around the flattering side view; suits spin all the way round
        const angle = kind === 'gun' ? 0.25 + Math.sin(t * 0.8) * 0.45 : 0.6 + t * 0.6;
        drawPreview(canvas, { kind, gun, suit, angle }).finally(() => { busy = false; });
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [kind, gun, suit]);
  return <canvas ref={ref} className="turntable" width={640} height={360} />;
}

export default function Locker({ player, preview = false }) {
  const [error, setError] = useState('');
  const [tab, setTab] = useState('gun');
  const points = player?.points || 0;
  const level = player?.level || levelFromXp(player?.xp || 0);
  const xp = player?.xp || 0;
  const into = 400 - (xp % 400);
  const gunId = player?.gunSkin || 'stock';
  const suitId = player?.playerSkin || 'default';
  const ownedGuns = player?.ownedGuns || ['stock'];
  const ownedSuits = player?.ownedSuits || ['default'];
  const [focus, setFocus] = useState({ gun: gunId, suit: suitId });

  const list = tab === 'gun' ? GUN_SKINS : SUITS;
  const owned = tab === 'gun' ? ownedGuns : ownedSuits;
  const equipped = tab === 'gun' ? gunId : suitId;
  const focused = list.find((item) => item.id === focus[tab]) || list[0];
  const previewGun = tab === 'gun' ? gunSkinOf(focused.id) : gunSkinOf(gunId);
  const previewSuit = tab === 'suit' ? suitOf(focused.id) : suitOf(suitId);
  const isOwned = owned.includes(focused.id) || focused.price === 0;

  const buy = async (kind, id) => {
    setError('');
    if (preview) return;
    try {
      await buyCosmetic(kind, id);
    } catch (err) {
      setError(err.message || 'Could not update locker.');
    }
  };

  return (
    <section className="locker panel">
      <header className="brand">
        <span className="logo small">Locker</span>
        <span className="tag">Lv {level} · {points} pts</span>
      </header>
      <p className="meta">{into} XP to next level · wins pay 120 pts, losses 30</p>
      <div className="segmented">
        <button className={tab === 'gun' ? 'on' : ''} onClick={() => setTab('gun')}>Gun skins</button>
        <button className={tab === 'suit' ? 'on' : ''} onClick={() => setTab('suit')}>Suits</button>
      </div>
      <div className="locker-stage">
        <Turntable kind={tab} gun={previewGun} suit={previewSuit} />
        <div className="locker-stage-info">
          <strong>{focused.label}</strong>
          <span>
            {equipped === focused.id ? 'Equipped' : isOwned ? 'Owned' : `${focused.price} pts`}
          </span>
          <button
            className="primary"
            disabled={equipped === focused.id || (!isOwned && points < focused.price)}
            onClick={() => buy(tab, focused.id)}
          >
            {equipped === focused.id ? 'Equipped' : isOwned ? 'Equip' : `Buy · ${focused.price} pts`}
          </button>
        </div>
      </div>
      <div className="cosmetic-grid">
        {list.map((item) => {
          const have = owned.includes(item.id) || item.price === 0;
          return (
            <button
              key={item.id}
              className={`cosmetic ${focused.id === item.id ? 'selected' : ''}`}
              onClick={() => setFocus((f) => ({ ...f, [tab]: item.id }))}
            >
              <Thumb
                kind={tab}
                gun={tab === 'gun' ? item : gunSkinOf(gunId)}
                suit={tab === 'suit' ? item : suitOf(suitId)}
              />
              <strong>{item.label}</strong>
              <span>{equipped === item.id ? 'Equipped' : have ? 'Owned' : `${item.price} pts`}</span>
            </button>
          );
        })}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
