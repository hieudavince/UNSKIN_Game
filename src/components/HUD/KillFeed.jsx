export default function KillFeed() {
  const kills = [
    {
      killer: "Player1",
      victim: "Player2",
    },
    {
      killer: "Player3",
      victim: "Player4",
    },
  ];

  return (
    <div className="kill-feed">
      {kills.map((kill, index) => (
        <div key={index}>
          {kill.killer} → {kill.victim}
        </div>
      ))}
    </div>
  );
}