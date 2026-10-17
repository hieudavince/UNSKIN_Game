export default function KillFeed({ items = [] }) {
  return (
    <div className="kill-feed">
      {items.map((item) => (
        <div key={item.id}>{item.text}</div>
      ))}
    </div>
  );
}
