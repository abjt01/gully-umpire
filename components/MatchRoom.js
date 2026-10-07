"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, copy, speak, whatsapp } from "./api";
import Pad from "./Pad";
import Recorder from "./Recorder";
import Scoreboard from "./Scoreboard";
import { Report, Scorecard } from "./Scorecard";

function useWakeLock(on) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock = null;
    const grab = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock.request("screen");
      } catch {}
    };
    grab();
    document.addEventListener("visibilitychange", grab);
    return () => {
      document.removeEventListener("visibilitychange", grab);
      lock?.release().catch(() => {});
    };
  }, [on]);
}

export default function MatchRoom({ id, k }) {
  const [match, setMatch] = useState(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [heard, setHeard] = useState(null);
  const [voice, setVoice] = useState(true);
  const [copied, setCopied] = useState(false);
  const [writing, setWriting] = useState(false);

  const qs = useMemo(() => (k ? `?k=${encodeURIComponent(k)}` : ""), [k]);
  const scorer = Boolean(match?.scorer);
  useWakeLock(scorer && !match?.result);

  const load = useCallback(async () => {
    try {
      const m = await api(`/api/matches/${id}${qs}`);
      setMatch(m);
      return m;
    } catch (err) {
      if (err.status === 404) setMissing(true);
      return null;
    }
  }, [id, qs]);

  // spectators follow along live; the scorer's own actions already return the new state
  useEffect(() => {
    let timer;
    let alive = true;
    async function tick(first = false) {
      const m = !first && document.hidden ? null : await load();
      if (!alive) return;
      timer = setTimeout(tick, m?.scorer ? 15000 : m?.result ? 20000 : 3000);
    }
    tick(true);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [load]);

  async function commentate(index) {
    try {
      const { line } = await api(`/api/matches/${id}/commentary${qs}`, { index });
      if (voice) speak(line, { queue: true });
      setMatch((m) => (m ? { ...m, log: m.log.map((l) => (l.index === index ? { ...l, commentary: line } : l)) } : m));
    } catch {}
  }

  async function handle(promise) {
    setBusy(true);
    setError("");
    try {
      const res = await promise;
      if (res.match) setMatch(res.match);
      setHeard({ text: res.heard ?? null, said: res.said, unclear: Boolean(res.unclear) });
      if (voice && res.said) speak(res.said);
      if (res.notable !== null && res.notable !== undefined) commentate(res.notable);
      return res;
    } catch (err) {
      setError(err.message);
      if (voice) speak(err.message);
    } finally {
      setBusy(false);
    }
  }

  const send = (action, body) => handle(api(`/api/matches/${id}/${action}${qs}`, body));

  function sendAudio(blob, name) {
    const form = new FormData();
    form.append("audio", blob, name);
    return handle(api(`/api/matches/${id}/voice${qs}`, form));
  }

  async function writeReport() {
    setWriting(true);
    setError("");
    try {
      const { report } = await api(`/api/matches/${id}/report${qs}`, {});
      setMatch((m) => ({ ...m, report }));
      if (voice) speak(`${report.headline}. Player of the match, ${report.playerOfMatch?.name}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setWriting(false);
    }
  }

  if (missing) {
    return (
      <section className="hero">
        <h1>No such match.</h1>
        <p className="lede">
          The link might be cut off. <Link href="/new">Start a new one</Link>.
        </p>
      </section>
    );
  }
  if (!match) return <p className="notice">Walking out to the pitch…</p>;

  const teams = match.setup.teams.map((t) => t.name);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const liveLink = `${origin}/m/${id}`;
  const shareText = match.result
    ? `🏏 ${teams[0]} vs ${teams[1]}: ${match.result.text}${match.report ? `\n\n${match.report.headline}` : ""}\n\nFull scorecard: ${liveLink}`
    : `🏏 ${teams[0]} vs ${teams[1]} is on. Follow the score live: ${liveLink}`;
  const feed = [...match.log].reverse().filter((l) => l.said);

  return (
    <>
      <Scoreboard match={match} />

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {scorer && !match.result && (
        <>
          <Recorder onAudio={sendAudio} busy={busy} onError={setError} />
          {heard && (
            <div className="heard" aria-live="polite">
              {heard.text && (
                <>
                  Heard <q>{heard.text}</q> ·{" "}
                </>
              )}
              <b>{heard.said}</b>
            </div>
          )}
          <Pad match={match} send={send} busy={busy} />
        </>
      )}

      <div className="toolbar" style={{ margin: "14px 0" }}>
        {scorer && (
          <button type="button" className="small" onClick={() => setVoice((v) => !v)} aria-pressed={voice}>
            {voice ? "🔊 Speaking scores" : "🔇 Silent"}
          </button>
        )}
        <a className="btn small" href={whatsapp(shareText)} target="_blank" rel="noreferrer">
          {match.result ? "Send result on WhatsApp" : "Share live score"}
        </a>
        <button
          type="button"
          className="small"
          onClick={async () => {
            await copy(liveLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy live link"}
        </button>
      </div>

      {match.result && scorer && !match.report && (
        <button type="button" className="primary wide" disabled={writing} onClick={writeReport}>
          {writing ? "The commentator is writing it up…" : "Write the match report"}
        </button>
      )}
      {match.report && <Report report={match.report} />}

      {feed.length > 0 && (
        <section className="card">
          <h2>Ball by ball</h2>
          <ul className="feed">
            {feed.slice(0, 30).map((l) => (
              <li key={l.index}>
                <span className="what">{l.said}</span>
                {l.note && <span className="meta"> · {l.note}</span>}
                {l.commentary && <span className="line">“{l.commentary}”</span>}
                {l.after && (
                  <span className="meta">
                    {" "}
                    {l.after.runs}/{l.after.wickets} · {Math.floor(l.after.balls / 6)}.{l.after.balls % 6}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Scorecard match={match} />

      {!scorer && !match.result && <p className="notice">Following live. The score updates on its own.</p>}
    </>
  );
}
