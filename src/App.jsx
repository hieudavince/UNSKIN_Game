import { useEffect, useState } from 'react';
import MatchLayout from './components/Match/MatchLayout';
import Lobby from './components/Lobby/Lobby';
import SkinBanPick from './components/Lobby/SkinBanPick';
import { serverNow } from './firebase/config';
import { leaveMatch, lockDraftIfDue, submitDraft } from './firebase/matchService';
import { useSession } from './hooks/useSession';

function seat(session) {
  const match = session.match;
  const uid = session.user.uid;
  const atlas = match.teams?.ATLAS?.playerIds || [];
  const outliers = match.teams?.OUTLIERS?.playerIds || [];
  const faction = atlas.includes(uid) ? 'atlas' : 'outliers';
  const team = faction === 'atlas' ? atlas : outliers;
  const enemy = faction === 'atlas' ? 'OUTLIERS' : 'ATLAS';
  const index = Math.max(0, team.indexOf(uid));
  const ffa = match.mode === 'FFA';
  return {
    matchId: match.id,
    uid,
    mode: match.mode,
    mapId: match.mapId || (ffa ? 'complex' : 'foundry'),
    spawnIndex: Math.max(0, (match.playerIds || []).indexOf(uid)),
    hostId: match.hostId,
    host: match.hostId === uid,
    playerName: match.names?.[uid] || session.player?.displayName || 'Player',
    faction,
    bannedMaterial: match.bannedMaterials?.[enemy] || null,
    pickedLoadout: ['glass'],
    spawnOffset: ffa ? 0 : (index - (team.length - 1) / 2) * 1.6,
    playerSkin: session.player?.playerSkin || 'default',
    gunSkin: session.player?.gunSkin || 'stock',
    onLeave: () => leaveMatch(),
  };
}

function Draft({ session }) {
  const match = session.match;
  const uid = session.user.uid;
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (match.hostId !== uid) return;
    if (now < (match.draftEndsAtMs || 0)) return;
    lockDraftIfDue(match.id).catch(() => {});
  }, [now, match.hostId, match.draftEndsAtMs, match.id, uid]);
  const faction = match.teams?.ATLAS?.playerIds?.includes(uid) ? 'ATLAS' : 'OUTLIERS';
  return (
    <main className="screen">
      <SkinBanPick
        faction={faction}
        picked={!!match.picks?.[uid]}
        secondsLeft={Math.max(0, Math.ceil(((match.draftEndsAtMs || 0) - now) / 1000))}
        onBanConfirmed={(material) => {
          submitDraft({ matchId: match.id, ban: String(material).toLowerCase() }).catch(() => {});
        }}
      />
    </main>
  );
}

export default function App() {
  const session = useSession();

  if (!session.ready) {
    return <main className="screen"><p className="loading">Connecting…</p></main>;
  }
  if (session.error && !session.user) {
    return <main className="screen"><p className="error">{session.error}</p></main>;
  }
  if (session.match?.status === 'DRAFTING') {
    return <Draft session={session} />;
  }
  if (session.match?.status === 'IN_PROGRESS') {
    return <MatchLayout key={session.match.id} online={seat(session)} />;
  }
  return <Lobby session={session} />;
}
