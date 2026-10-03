import MatchHeader from "./MatchHeader";
import RoundTimer from "./RoundTimer";
import PlayerVitals from "./PlayerVitals";
import AmmoCounter from "./AmmoCounter";
import CreditDisplay from "./CreditDisplay";
import SkinInventory from "./SkinInventory";
import KillFeed from "./KillFeed";
import SkinStatus from "./SkinStatus";

export default function HUD() {
  return (
    <div className="hud">
      <MatchHeader />
      <RoundTimer />

      <PlayerVitals />

      <AmmoCounter />
      <CreditDisplay />

      <SkinInventory />
      <SkinStatus />

      <KillFeed />
    </div>
  );
}