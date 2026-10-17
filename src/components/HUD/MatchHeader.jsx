function Pips({ list = [] }) {
  return (
    <span className="pips">
      {list.map((alive, index) => <i key={index} className={alive ? 'on' : ''} />)}
    </span>
  );
}

export default function MatchHeader({ atlas = 0, outliers = 0, round = 1, mine = null, pips }) {
  return (
    <div className="match-header">
      <div className={`side atlas ${mine === 'ATLAS' ? 'mine' : ''}`}>
        <span className="team">ATLAS</span>
        <strong>{atlas}</strong>
        <Pips list={pips?.ATLAS} />
      </div>
      <div className="round">ROUND {round}</div>
      <div className={`side outliers ${mine === 'OUTLIERS' ? 'mine' : ''}`}>
        <Pips list={pips?.OUTLIERS} />
        <strong>{outliers}</strong>
        <span className="team">OUTLIERS</span>
      </div>
    </div>
  );
}
