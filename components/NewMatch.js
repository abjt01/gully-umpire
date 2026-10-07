"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { api, rememberMatch } from "./api";

const EXAMPLES = [
  "Over the wall is out",
  "One tip one hand",
  "Last man stands",
  "Wide is one run and bowled again",
  "No LBW",
  "Hit the neighbour's window and you're out",
];

const SWITCHES = [
  ["sixIsOut", "Over the wall is out"],
  ["oneTipOneHand", "One tip one hand is out"],
  ["lastManStands", "Last man can bat alone"],
  ["noLbw", "No LBW"],
  ["wideRebowl", "Wide is bowled again"],
  ["noBallRebowl", "No ball is bowled again"],
];

// True once React has taken over the page, so taps on a slow phone aren't lost before hydration.
const noop = () => () => {};
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

const splitNames = (s) =>
  s
    .split(/[\n,]/)
    .map((n) => n.trim())
    .filter(Boolean);

export default function NewMatch() {
  const router = useRouter();
  const ready = useHydrated();
  const [teams, setTeams] = useState([
    { name: "", players: "" },
    { name: "", players: "" },
  ]);
  const [perSide, setPerSide] = useState("");
  const [overs, setOvers] = useState("5");
  const [battingFirst, setBattingFirst] = useState(0);
  const [rulesText, setRulesText] = useState("");
  const [rules, setRules] = useState(null);
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const counts = teams.map((t) => splitNames(t.players).length);
  const players = Number(perSide) || Math.max(...counts, 0) || 6;
  const label = (i) => teams[i].name.trim() || (i === 0 ? "Team A" : "Team B");
  const setTeam = (i, key, value) => setTeams((list) => list.map((t, j) => (j === i ? { ...t, [key]: value } : t)));

  function addExample(text) {
    setRules(null);
    setRulesText((s) => (s.trim() ? `${s.trim().replace(/[.]$/, "")}. ${text}.` : `${text}.`));
  }

  async function checkRules() {
    setBusy("rules");
    setError("");
    try {
      setRules((await api("/api/rules", { text: rulesText })).rules);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function start(e) {
    e.preventDefault();
    setBusy("start");
    setError("");
    try {
      const body = {
        teams: teams.map((t, i) => ({ name: label(i), players: splitNames(t.players) })),
        overs: Number(overs),
        playersPerSide: players,
        battingFirst,
        rulesText,
        rules: rules || undefined,
        language,
      };
      const { id, k } = await api("/api/matches", body);
      rememberMatch({ id, k, title: `${label(0)} vs ${label(1)}`, at: new Date().toISOString() });
      router.push(`/m/${id}?k=${k}`);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  return (
    <form className="card" onSubmit={start} noValidate data-ready={ready || undefined}>
      <div className="two">
        {[0, 1].map((i) => (
          <fieldset key={i}>
            <label>
              Team {i === 0 ? "A" : "B"}
              <input
                type="text"
                maxLength={20}
                value={teams[i].name}
                onChange={(e) => setTeam(i, "name", e.target.value)}
                placeholder={i === 0 ? "Gali No. 4" : "Building C"}
              />
            </label>
            <label>
              Players <span className="opt">optional, in batting order</span>
              <textarea
                rows={3}
                value={teams[i].players}
                onChange={(e) => setTeam(i, "players", e.target.value)}
                placeholder={i === 0 ? "Rohan, Aman, Kabir, Dev" : "Ishaan, Neel, Raj, Om"}
              />
            </label>
          </fieldset>
        ))}
      </div>

      <div className="two">
        <label>
          Overs per side
          <input type="number" inputMode="numeric" min={1} max={20} value={overs} onChange={(e) => setOvers(e.target.value)} />
        </label>
        <label>
          Players per side
          <input
            type="number"
            inputMode="numeric"
            min={2}
            max={11}
            value={perSide}
            onChange={(e) => setPerSide(e.target.value)}
            placeholder={String(players)}
          />
        </label>
      </div>

      <fieldset>
        <legend>Batting first</legend>
        <div className="choices">
          {[0, 1].map((i) => (
            <label key={i}>
              <input type="radio" name="bat" checked={battingFirst === i} onChange={() => setBattingFirst(i)} />
              <span>{label(i)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        Your lane&apos;s rules <span className="opt">in plain words</span>
        <textarea
          rows={3}
          value={rulesText}
          onChange={(e) => {
            setRulesText(e.target.value);
            setRules(null);
          }}
          placeholder="Over the wall is out. One tip one hand. Wide is a run and bowled again."
        />
      </label>
      <div className="chips" style={{ marginTop: -6, marginBottom: 12 }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => addExample(ex)}>
            + {ex}
          </button>
        ))}
      </div>
      <button type="button" className="small" disabled={!ready || !rulesText.trim() || busy === "rules"} onClick={checkRules}>
        {busy === "rules" ? "Reading your rules…" : "Check how the umpire reads them"}
      </button>

      {rules && (
        <div className="rules">
          {SWITCHES.map(([key, text]) => (
            <label key={key} className="rule">
              {text}
              <input type="checkbox" checked={rules[key]} onChange={(e) => setRules({ ...rules, [key]: e.target.checked })} />
            </label>
          ))}
          <label className="rule">
            Runs for a wide
            <select value={rules.wideRuns} onChange={(e) => setRules({ ...rules, wideRuns: Number(e.target.value) })}>
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          {rules.notes.map((n) => (
            <p key={n} className="chip">
              Also: {n}
            </p>
          ))}
        </div>
      )}

      <fieldset style={{ marginTop: 16 }}>
        <legend>Commentary</legend>
        <div className="choices">
          {[
            ["en", "English"],
            ["hinglish", "Hinglish"],
          ].map(([id, text]) => (
            <label key={id}>
              <input type="radio" name="lang" checked={language === id} onChange={() => setLanguage(id)} />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary wide" type="submit" disabled={!ready || busy === "start"}>
        {busy === "start" ? "Setting up the pitch…" : "Start the match"}
      </button>
    </form>
  );
}
