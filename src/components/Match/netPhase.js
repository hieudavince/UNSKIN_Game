import { serverNow } from '../../firebase/config';
import { cancelPaint } from './ActionPhase';

export function applyNetPhase(game) {
  const net = game.netRef?.current;
  if (!net?.matchId) return;
  game.matchId = net.matchId;
  game.netHost = !!net.host;
  if (!net.phase || net.phase === 'DRAFT' || net.phase === 'COMPLETE') return;
  const key = `${net.round || 1}:${net.phase}`;
  if (key === game.netApplied) return;
  game.netApplied = key;
  game.advanceLatch = '';
  const roundChanged = (net.round || 1) !== game.round;
  game.round = net.round || 1;
  if (roundChanged) game.net?.resetRound();
  if (net.phase === 'BUY') {
    game.startBuy?.();
  } else if (net.phase === 'PREP') {
    if (roundChanged || game.phase === 'result') game.startBuy?.();
    cancelPaint(game);
    game.phase = 'prep';
    game.input.firing = false;
    game.sentPhase = '';
    game.onPhase?.('prep', null);
  } else if (net.phase === 'ACTION') {
    if (roundChanged || game.phase === 'result') game.startBuy?.();
    game.startAction?.();
  } else if (net.phase === 'POST_ROUND' && game.phase !== 'result') {
    game.finishRound?.('timeout', true, net.lastRound);
  }
  if (net.phaseEndsAtMs) {
    game.phaseEndsAt = performance.now() + Math.max(0, net.phaseEndsAtMs - serverNow());
  }
}
