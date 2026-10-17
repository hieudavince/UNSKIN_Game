import { useEffect, useState } from 'react';
import { ensurePlayer, joinQueue, leaveQueue } from '../../firebase/matchmakingService';
import { MODE_LIST } from '../../constants/modes';

export default function MatchmakingQueue({ playerId, tcMmr, displayName, lastMatch, preview = false }) {
  const [mode, setMode] = useState('DUEL');
  const [ranked, setRanked] = useState(false);
  const [name, setName] = useState(displayName || 'Player');
  const [queueEntryId, setQueueEntryId] = useState(null);
  const [queue, setQueue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inQueue = !!queueEntryId;
  const selected = MODE_LIST.find((item) => item.id === mode) || MODE_LIST[0];
  const canRank = selected.players > 1 && !selected.ffa;

  useEffect(() => {
    if (displayName) setName(displayName);
  }, [displayName]);

  useEffect(() => () => {
    leaveQueue().catch(() => {});
  }, []);

  const handleToggleQueue = async () => {
    if (preview) return;
    setBusy(true);
    setError('');
    try {
      if (inQueue) {
        await leaveQueue();
        setQueueEntryId(null);
        setQueue(null);
      } else {
        await ensurePlayer(name.trim().slice(0, 24) || 'Player');
        const ref = await joinQueue(mode, ranked && canRank, (state) => {
          setQueue(state);
          if (state.error) setError(state.error);
        });
        setQueueEntryId(ref.key || ref.matchId || 'queued');
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const mine = lastMatch?.teams?.ATLAS?.playerIds?.includes(playerId) ? 'ATLAS' : 'OUTLIERS';
  const lastFfa = lastMatch?.mode === 'FFA';
  const result = lastMatch
    ? (lastFfa
      ? (lastMatch.ffaWinner ? (lastMatch.ffaWinner === playerId ? 'Win' : 'Loss') : 'Ended')
      : (lastMatch.winner ? (lastMatch.winner === mine ? 'Win' : 'Loss') : 'Ended'))
    : null;
  const queueText = () => {
    if (selected.players === 1) return 'Starting match…';
    const count = queue?.count ?? 1;
    if (selected.ffa) {
      return count >= (selected.minPlayers || 2)
        ? `In queue ${count} / ${selected.players} · starts in a few seconds`
        : `In queue ${count} / ${selected.players} · need ${selected.minPlayers || 2}+`;
    }
    return `In queue ${count} / ${queue?.need ?? selected.players}`;
  };

  return (
    <div className="matchmaking-queue panel">
      <header className="brand">
        <span className="logo">UNSKIN</span>
        <span className="tag">MMR {tcMmr}</span>
      </header>

      {result ? (
        <div className={`last-result ${result === 'Win' ? 'win' : result === 'Loss' ? 'lose' : ''}`}>
          Last match · {result}
          {lastFfa ? <span>FFA</span> : <span>{lastMatch.finalScore?.ATLAS ?? 0} : {lastMatch.finalScore?.OUTLIERS ?? 0}</span>}
        </div>
      ) : null}

      <label className="field">
        <span>Name</span>
        <input value={name} maxLength={24} disabled={inQueue} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="mode-grid">
        {MODE_LIST.map((item) => (
          <button
            key={item.id}
            className={`mode ${mode === item.id ? 'selected' : ''} ${item.ffa ? 'ffa' : ''}`}
            disabled={inQueue}
            onClick={() => setMode(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </div>

      <div className="segmented">
        <button className={!ranked || !canRank ? 'on' : ''} disabled={inQueue} onClick={() => setRanked(false)}>Casual</button>
        <button className={ranked && canRank ? 'on' : ''} disabled={inQueue || !canRank} onClick={() => setRanked(true)}>Ranked</button>
      </div>

      <button className="primary find" disabled={busy} onClick={handleToggleQueue}>
        {inQueue ? 'Leave Queue' : 'Find Match'}
      </button>

      {inQueue ? (
        <div className="queue-status">
          <span className="pulse" />
          {queueText()}
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <p className="hint">
        WASD move · click fire · 1 pistol · 2 primary · 3 knife · 4 bomb · 5 skin gun · 6 chip
        · E install chip at the uplink · right click zoom or cycle material · R reload · B shop · Tab scoreboard
      </p>
    </div>
  );
}
