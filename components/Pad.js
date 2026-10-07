"use client";

import { useState } from "react";

// Buttons for when it's too loud to talk, plus the few calls that need a choice.
export default function Pad({ match, send, busy }) {
  const [sheet, setSheet] = useState(null);
  const [how, setHow] = useState("bowled");
  const [who, setWho] = useState("striker");
  const [fielder, setFielder] = useState("");
  const [typed, setTyped] = useState("");

  const inn = match.innings.at(-1);
  const fielders = match.setup.teams[inn.bowling].players;
  const r = match.rules;
  const outs = ["bowled", "caught", "run out", "stumped", "lbw", "hit wicket"]
    .filter((h) => !(h === "lbw" && r.noLbw))
    .concat(r.oneTipOneHand ? ["one tip one hand"] : [], r.sixIsOut ? ["over the wall"] : []);

  const ball = (fields) => send("ball", { event: { kind: "ball", ...fields } }).then(() => setSheet(null));

  function out() {
    ball({ wicket: { how, batter: how === "run out" ? who : "striker", fielder: fielder || null } });
    setFielder("");
  }

  return (
    <>
      {inn.bowler === null && fielders.length > 0 && (
        <div className="sheet">
          <h3>Who&apos;s bowling this over?</h3>
          <div className="chips">
            {fielders.map((f) => (
              <button key={f} type="button" className="small" disabled={busy} onClick={() => send("ball", { event: { kind: "bowler", name: f } })}>
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pad">
        {[0, 1, 2, 3].map((n) => (
          <button key={n} type="button" disabled={busy} onClick={() => ball({ runs: n })}>
            {n === 0 ? "•" : n}
          </button>
        ))}
        <button type="button" className="b4" disabled={busy} onClick={() => ball({ runs: 4, boundary: true })}>
          4
        </button>
        <button type="button" className="b6" disabled={busy} onClick={() => ball({ runs: 6, boundary: true })}>
          6
        </button>
        <button type="button" disabled={busy} onClick={() => ball({ extra: "wd" })}>
          Wd
        </button>
        <button type="button" disabled={busy} onClick={() => setSheet(sheet === "nb" ? null : "nb")}>
          Nb
        </button>
        <button type="button" className="w" disabled={busy} onClick={() => setSheet(sheet === "w" ? null : "w")}>
          Out
        </button>
        <button type="button" disabled={busy} onClick={() => setSheet(sheet === "bye" ? null : "bye")}>
          Bye
        </button>
        <button type="button" disabled={busy} onClick={() => send("ball", { event: { kind: "swap" } })}>
          ⇄
        </button>
        <button type="button" disabled={busy || !match.events} onClick={() => send("undo", {})}>
          Undo
        </button>
      </div>

      {sheet === "nb" && (
        <div className="sheet">
          <h3>No ball, and off the bat:</h3>
          <div className="chips">
            {[0, 1, 2, 3, 4, 6].map((n) => (
              <button key={n} type="button" disabled={busy} onClick={() => ball({ extra: "nb", runs: n, boundary: n === 4 || n === 6 })}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {sheet === "bye" && (
        <div className="sheet">
          <h3>Byes or leg byes</h3>
          <div className="chips">
            {[1, 2, 3, 4].map((n) => (
              <button key={`b${n}`} type="button" disabled={busy} onClick={() => ball({ extra: "b", extraRuns: n })}>
                {n} bye{n > 1 ? "s" : ""}
              </button>
            ))}
            {[1, 2].map((n) => (
              <button key={`lb${n}`} type="button" disabled={busy} onClick={() => ball({ extra: "lb", extraRuns: n })}>
                {n} leg bye{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {sheet === "w" && (
        <div className="sheet">
          <h3>How&apos;s that?</h3>
          <div className="choices" style={{ marginBottom: 10 }}>
            {outs.map((h) => (
              <label key={h}>
                <input type="radio" name="how" checked={how === h} onChange={() => setHow(h)} />
                <span>{h}</span>
              </label>
            ))}
          </div>
          {how === "run out" && (
            <div className="choices" style={{ marginBottom: 10 }}>
              {[
                ["striker", "Striker"],
                ["nonStriker", "Non-striker"],
              ].map(([id, text]) => (
                <label key={id}>
                  <input type="radio" name="who" checked={who === id} onChange={() => setWho(id)} />
                  <span>{text}</span>
                </label>
              ))}
            </div>
          )}
          {["caught", "run out", "stumped", "one tip one hand"].includes(how) && fielders.length > 0 && (
            <div className="chips" style={{ marginBottom: 10 }}>
              {fielders.map((f) => (
                <button key={f} type="button" className={`small${fielder === f ? " primary" : ""}`} onClick={() => setFielder(fielder === f ? "" : f)}>
                  {f}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="primary" disabled={busy} onClick={out}>
            Give it out
          </button>
        </div>
      )}

      <form
        className="actions"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) send("call", { text: typed }).then(() => setTyped(""));
        }}
      >
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Or type the call: “no ball and four”"
          aria-label="Type the call"
          style={{ flex: 1, marginTop: 0 }}
        />
        <button type="submit" disabled={busy || !typed.trim()}>
          Score
        </button>
      </form>
    </>
  );
}
