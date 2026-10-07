const rate = (runs, balls) => (balls ? ((runs * 6) / balls).toFixed(1) : "0.0");

function chipClass(sym) {
  if (sym.includes("W") && !sym.startsWith("Wd")) return "ballchip out";
  if (sym === "6" || sym.endsWith("+6")) return "ballchip six";
  if (sym === "4" || sym.endsWith("+4")) return "ballchip four";
  if (sym.startsWith("Wd") || sym.startsWith("Nb") || sym.endsWith("b")) return "ballchip extra";
  return "ballchip";
}

export function OverStrip({ balls }) {
  return (
    <div className="over-strip" aria-label="This over">
      {balls.map((s, i) => (
        <span key={i} className={chipClass(s)}>
          {s}
        </span>
      ))}
    </div>
  );
}

export default function Scoreboard({ match }) {
  const inn = match.innings.at(-1);
  const team = match.setup.teams[inn.batting].name;
  const striker = inn.batters[inn.striker];
  const nonStriker = inn.nonStriker === null ? null : inn.batters[inn.nonStriker];
  const bowler = inn.bowler === null ? null : inn.bowlers[inn.bowler];
  const ballsLeft = match.setup.overs * 6 - inn.balls;
  const thisOver = inn.overs.at(-1);
  const lastOver = inn.overs.length > 1 ? inn.overs.at(-2) : [];
  const fresh = !inn.balls && !thisOver.length;

  return (
    <section className="board" aria-live="polite">
      <div className="team">
        {team} {match.innings.length === 2 ? "· chasing" : "· batting"}
      </div>
      <div>
        <span className="score">
          {inn.runs}/{inn.wickets}
        </span>
        <span className="overs">
          ({inn.oversText}/{match.setup.overs})
        </span>
      </div>
      {match.result ? (
        <div className="result">{match.result.text}</div>
      ) : inn.target !== null ? (
        <div className="chase">
          {fresh ? `Target ${inn.target}` : `Need ${Math.max(inn.target - inn.runs, 0)} off ${ballsLeft}`}
          {!fresh && ballsLeft > 0 && ` · RRR ${rate(inn.target - inn.runs, ballsLeft)}`}
        </div>
      ) : (
        <div className="bowler-line">Run rate {rate(inn.runs, inn.balls)}</div>
      )}

      {!match.result && (
        <>
          <div className="batters">
            {[striker, nonStriker].map((b, i) =>
              b ? (
                <div key={i} className={i === 0 ? "on-strike" : ""}>
                  <b>{b.name}</b>
                  {b.runs} ({b.balls})
                </div>
              ) : (
                <div key={i}>
                  <b>—</b>batting alone
                </div>
              ),
            )}
          </div>
          <div className="bowler-line">
            {bowler ? `${bowler.name}: ${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}-${bowler.runs}-${bowler.wickets}` : "New over: who's bowling?"}
          </div>
          <OverStrip balls={thisOver.length ? thisOver : lastOver} />
        </>
      )}
    </section>
  );
}
