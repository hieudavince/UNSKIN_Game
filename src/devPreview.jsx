// DEV-only preview routes used for screenshots and quick manual testing
// without signing in or touching Firebase:
//   ?preview=lobby            main menu (fake profile, queue buttons inert)
//   ?preview=locker           main menu with the locker scrolled into view
//   ?preview=lab              offline match on Foundry Labs
//   ?preview=ffa              offline match on Helix Complex (FFA rules)
//   add &overview=1 to the map routes for a top-down camera with the roof hidden
import Lobby from './components/Lobby/Lobby';
import MatchLayout from './components/Match/MatchLayout';

const FAKE_SESSION = {
  user: { uid: 'preview-user' },
  player: {
    displayName: 'Preview',
    tcMmr: 1000,
    points: 1200,
    xp: 950,
    level: 3,
    gunSkin: 'stock',
    playerSkin: 'default',
    ownedGuns: ['stock', 'night'],
    ownedSuits: ['default'],
  },
  lastMatch: null,
};

export default function DevPreview({ route }) {
  if (route === 'lobby' || route === 'locker') return <Lobby session={FAKE_SESSION} preview />;
  return <MatchLayout key={route} />;
}
