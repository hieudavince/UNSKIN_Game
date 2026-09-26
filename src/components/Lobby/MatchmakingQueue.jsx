import { useState } from 'react';
import { joinQueue, leaveQueue } from '../../firebase/matchmakingService';

export default function MatchmakingQueue({ playerId, tcMmr }) {
  const [mode, setMode] = useState('CASUAL');
  const [queueEntryId, setQueueEntryId] = useState(null);
  const inQueue = !!queueEntryId;

  const handleToggleQueue = async () => {
    if (inQueue) {
      await leaveQueue(queueEntryId);
      setQueueEntryId(null);
    } else {
      const ref = await joinQueue(playerId, mode, tcMmr);
      setQueueEntryId(ref.id);
    }
  };

  return (
    <div className="matchmaking-queue">
      <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={inQueue}>
        <option value="CASUAL">Casual</option>
        <option value="RANKED">Ranked</option>
      </select>
      <button onClick={handleToggleQueue}>
        {inQueue ? 'Leave Queue' : 'Find Match'}
      </button>
      {/* TODO: subscribe to a "matchFound" signal (Cloud Function writes the
          resulting matchId back to this player, e.g. players/{id}/pendingMatchId)
          and route to SkinBanPick when it appears */}
    </div>
  );
}
