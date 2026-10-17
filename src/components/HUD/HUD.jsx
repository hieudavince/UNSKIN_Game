import { useEffect, useState } from 'react';
import { useMatchStore } from '../../store/matchStore';
import { usePhaseTimer } from '../../hooks/usePhaseTimer';
import MatchHeader from './MatchHeader';
import RoundTimer from './RoundTimer';
import PlayerVitals from './PlayerVitals';
import AmmoCounter from './AmmoCounter';
import CreditsDisplay from './CreditsDisplay';
import KillFeed from './KillFeed';
import SkinStatus from './SkinStatus';

function clock(seconds) {
  const safe = Math.max(0, seconds || 0);
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function teamPips(players, me, myFaction, myAlive) {
  const teams = { ATLAS: [], OUTLIERS: [] };
  if (myFaction) teams[myFaction].push(myAlive);
  for (const [uid, info] of Object.entries(players || {})) {
    if (uid === me || !info.faction || info.left) continue;
    teams[info.faction].push(!!info.alive && info.online !== false);
  }
  return teams;
}

export default function HUD({ phase, loadout, online, shopOpen, onOpenShop, onCloseShop, ffa = false }) {
  const [hp, setHp] = useState(100);
  const [credits, setCredits] = useState(800);
  const [feed, setFeed] = useState([]);
  const [localLeft, setLocalLeft] = useState(0);
  const [hurt, setHurt] = useState(0);
  const [locked, setLocked] = useState(false);
  const score = useMatchStore((s) => s.score);
  const round = useMatchStore((s) => s.currentRound);
  const ends = useMatchStore((s) => s.phaseEndsAtMs);
  const players = useMatchStore((s) => s.players);
  const hostId = useMatchStore((s) => s.hostId);
  const serverLeft = usePhaseTimer(ends);
  const left = ends ? serverLeft : localLeft;

  useEffect(() => {
    const onHealth = (event) => setHp(event.detail?.hp ?? 0);
    const onCredits = (event) => setCredits(event.detail?.credits ?? 0);
    const onPhase = (event) => setLocalLeft(event.detail?.timeLeft ?? 0);
    const onHurt = () => setHurt((n) => n + 1);
    const onFeed = (event) => {
      if (!event.detail?.text) return;
      const id = `${Date.now()}-${Math.random()}`;
      setFeed((items) => [{ id, text: event.detail.text }, ...items].slice(0, 5));
      setTimeout(() => setFeed((items) => items.filter((item) => item.id !== id)), 7000);
    };
    const onLock = () => setLocked(!!document.pointerLockElement);
    window.addEventListener('game:health', onHealth);
    window.addEventListener('game:credits', onCredits);
    window.addEventListener('game:phase', onPhase);
    window.addEventListener('game:killfeed', onFeed);
    window.addEventListener('game:hurt', onHurt);
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      window.removeEventListener('game:health', onHealth);
      window.removeEventListener('game:credits', onCredits);
      window.removeEventListener('game:phase', onPhase);
      window.removeEventListener('game:killfeed', onFeed);
      window.removeEventListener('game:hurt', onHurt);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.code !== 'KeyB' || event.repeat) return;
      if (shopOpen) onCloseShop?.();
      else if (phase === 'buy' && !ffa) onOpenShop?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, shopOpen, onOpenShop, onCloseShop, ffa]);

  const weapon = loadout?.weapon || 'pistol';
  const material = loadout?.material || 'glass';
  const ammo = weapon === 'portal'
    ? `${loadout?.stock?.[material] ?? 0} m²`
    : weapon === 'hack'
      ? `×${loadout?.chips ?? 0}`
      : weapon === 'utility'
        ? `${loadout?.bombs ?? 0}`
        : weapon === 'melee'
          ? '—'
          : `${loadout?.mag ?? 0} / ${loadout?.reserve ?? 0}`;
  const myFaction = online?.faction === 'outliers' ? 'OUTLIERS' : 'ATLAS';
  const pips = teamPips(players, online?.uid, online ? myFaction : null, hp > 0);
  const hostGone = online && !online.host && hostId && players?.[hostId]?.online === false;

  return (
    <div className="hud">
      {hurt ? <div key={hurt} className="hurt-flash" /> : null}
      <div className="hud-top">
        {ffa ? (
          <div className="ffa-header">
            <strong>FREE FOR ALL</strong>
            <span>Kills {loadout?.kills ?? 0} / {loadout?.killTarget ?? 20} · <kbd>Tab</kbd> scoreboard</span>
          </div>
        ) : (
          <MatchHeader
            atlas={score?.ATLAS ?? 0}
            outliers={score?.OUTLIERS ?? 0}
            round={round || online?.round || 1}
            mine={online ? myFaction : null}
            pips={pips}
          />
        )}
        <RoundTimer label={clock(left)} phase={phase} urgent={phase === 'action' && left <= 10} />
      </div>
      <div className="hud-bottom-left">
        <PlayerVitals hp={hp} />
        <CreditsDisplay credits={credits} />
      </div>
      <div className="hud-bottom-right">
        <AmmoCounter ammo={ammo} weapon={weapon} />
        <SkinStatus
          material={material}
          stock={loadout?.stock || {}}
          banned={online?.bannedMaterial}
          active={weapon === 'portal'}
          hold={loadout?.hold}
        />
      </div>
      <KillFeed items={feed} />
      {phase === 'buy' && !shopOpen && !ffa ? (
        <button className="shop-btn" onClick={onOpenShop}>Shop <kbd>B</kbd></button>
      ) : null}
      {online?.onLeave ? (
        <button className="leave" onClick={() => online.onLeave()}>Leave match</button>
      ) : null}
      {phase === 'action' && hp <= 0 ? (
        <div className="banner dead">{ffa ? 'Eliminated · respawning in 3 s' : 'Eliminated · spectating until the round ends'}</div>
      ) : null}
      {hostGone ? <div className="banner warn">Host disconnected · leave the match to return to the lobby</div> : null}
      {!locked && !shopOpen && phase !== 'result' ? <div className="click-hint">Click to play</div> : null}
    </div>
  );
}
