import { useEffect, useState } from 'react';
import { useMatchStore } from '../../store/matchStore';

// Hold Tab: kills / deaths for everyone. FFA sorts by kills; team modes group
// by team. Your own row comes from the local game (always up to date).
export default function Scoreboard({ gameRef, online, ffa }) {
  const [show, setShow] = useState(false);
  const [, setTick] = useState(0);
  const players = useMatchStore((s) => s.players);
  useEffect(() => {
    const down = (event) => {
      if (event.code !== 'Tab') return;
      event.preventDefault();
      setShow(true);
    };
    const up = (event) => {
      if (event.code === 'Tab') setShow(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);
  useEffect(() => {
    if (!show) return undefined;
    const timer = setInterval(() => setTick((n) => n + 1), 300);
    return () => clearInterval(timer);
  }, [show]);
  if (!show) return null;
  const game = gameRef.current;
  const me = online?.uid || 'me';
  const rows = [];
  rows.push({
    uid: me,
    name: game?.playerName || 'You',
    team: game?.faction === 'outliers' ? 'OUTLIERS' : 'ATLAS',
    kills: game?.kills || 0,
    deaths: game?.deaths || 0,
    alive: (game?.player?.hp || 0) > 0,
    self: true,
  });
  for (const [uid, info] of Object.entries(players || {})) {
    if (uid === me || !info?.faction || info.left) continue;
    rows.push({
      uid,
      name: info.name || 'Player',
      team: info.faction,
      kills: Number(info.kills) || 0,
      deaths: Number(info.deaths) || 0,
      alive: !!info.alive && info.online !== false,
    });
  }
  rows.sort((a, b) => (ffa ? 0 : a.team.localeCompare(b.team)) || b.kills - a.kills || a.deaths - b.deaths);
  const target = game?.modeInfo?.killTarget;
  return (
    <div className="scoreboard panel">
      <header className="brand">
        <span className="logo small">{ffa ? 'Free for all' : 'Scoreboard'}</span>
        {ffa && target ? <span className="tag">First to {target} kills</span> : null}
      </header>
      <table>
        <thead>
          <tr><th>#</th><th>Player</th>{ffa ? null : <th>Team</th>}<th>K</th><th>D</th></tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.uid} className={`${row.self ? 'self' : ''} ${row.alive ? '' : 'dead'}`}>
              <td>{i + 1}</td>
              <td>{row.name}</td>
              {ffa ? null : <td className={row.team === 'ATLAS' ? 'atlas' : 'outliers'}>{row.team === 'ATLAS' ? 'Atlas' : 'Outliers'}</td>}
              <td>{row.kills}</td>
              <td>{row.deaths}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
