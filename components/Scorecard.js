const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

export function Scorecard({ match }) {
  return match.innings
    .filter((inn) => inn.balls || inn.overs[0].length || inn.done)
    .map((inn, i) => {
      const extras = inn.extras.wd + inn.extras.nb + inn.extras.b + inn.extras.lb;
      return (
        <details key={i} className="card" open={i === match.innings.length - 1 || Boolean(match.result)}>
          <summary>
            <b>
              {match.setup.teams[inn.batting].name} {inn.runs}/{inn.wickets}
            </b>{" "}
            ({inn.oversText} overs)
          </summary>
          <table className="card-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Batter</th>
                <th>R</th>
                <th>B</th>
                <th>4s</th>
                <th>6s</th>
              </tr>
            </thead>
            <tbody>
              {inn.batters.map((b, j) => (
                <tr key={j}>
                  <td>
                    {b.name}
                    <span className="how">{b.out || "not out"}</span>
                  </td>
                  <td>{b.runs}</td>
                  <td>{b.balls}</td>
                  <td>{b.fours}</td>
                  <td>{b.sixes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="notice" style={{ marginTop: 8 }}>
            Extras {extras} (wd {inn.extras.wd}, nb {inn.extras.nb}, b {inn.extras.b}, lb {inn.extras.lb})
            {inn.fow.length > 0 && ` · Fall of wickets: ${inn.fow.map((f) => `${f.runs}-${f.wicket} (${f.batter})`).join(", ")}`}
          </p>
          {inn.bowlers.length > 0 && (
            <table className="card-table">
              <thead>
                <tr>
                  <th>Bowler</th>
                  <th>O</th>
                  <th>R</th>
                  <th>W</th>
                </tr>
              </thead>
              <tbody>
                {inn.bowlers.map((b, j) => (
                  <tr key={j}>
                    <td>{b.name}</td>
                    <td>{overs(b.balls)}</td>
                    <td>{b.runs}</td>
                    <td>{b.wickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      );
    });
}

export function Report({ report }) {
  return (
    <article className="card report">
      <p className="eyebrow">Match report</p>
      <h2>{report.headline}</h2>
      <p>{report.summary}</p>
      {report.playerOfMatch && (
        <p className="pom">
          🏅 Player of the match: {report.playerOfMatch.name}. {report.playerOfMatch.why}
        </p>
      )}
      {report.moments.length > 0 && (
        <ul>
          {report.moments.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {report.banter && (
        <p>
          <i>{report.banter}</i>
        </p>
      )}
    </article>
  );
}
