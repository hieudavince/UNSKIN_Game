export function roundOutcome(game, cause) {
  const playerSide = game.faction === 'outliers' ? 'Outliers' : 'Atlas';
  const enemySide = game.faction === 'outliers' ? 'Atlas' : 'Outliers';

  if (cause === 'uplink') {
    return {
      playerWon: game.faction !== 'outliers',
      reason: 'Uplink held',
      killText: 'Atlas held the uplink',
    };
  }
  if (cause === 'wipe') {
    return {
      playerWon: true,
      reason: 'All enemies down',
      killText: `${playerSide} won the round`,
    };
  }
  if (cause === 'death') {
    return {
      playerWon: false,
      reason: 'You were eliminated',
      killText: `${enemySide} won the round`,
    };
  }
  const playerWon = game.faction === 'outliers';
  return {
    playerWon,
    reason: playerWon ? 'Defense held' : 'Attack failed',
    killText: 'Outliers won the round',
  };
}

export default function PostRoundAnalysis({ playerWon, reason }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <div style={{ textAlign: 'center', textShadow: '0 2px 18px rgba(0,0,0,0.85)' }}>
        <div
          style={{
            margin: 0,
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: '0.14em',
            color: playerWon ? '#e7ff8a' : '#ff8d7a',
          }}
        >
          {playerWon ? 'VICTORY' : 'DEFEAT'}
        </div>
        <div style={{ marginTop: 8, fontSize: 18, letterSpacing: '0.04em', color: '#f4f4f4' }}>
          {reason}
        </div>
      </div>
    </div>
  );
}
