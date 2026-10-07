import crypto from "node:crypto";
import { normaliseEvent, quickParse } from "./calls.js";
import { normaliseRules, oversText, replay, scoreLine } from "./engine.js";
import { HttpError, text } from "./http.js";
import { createStore } from "./store.js";
import { commentate, hear, reportCard, understandCall, understandRules, writeReport } from "./umpire.js";

// Kept on globalThis so dev reloads don't open a second store or lose the locks.
const g = globalThis;
function getStore() {
  g.__guStore ||= createStore().catch((err) => {
    g.__guStore = null;
    throw err;
  });
  return g.__guStore;
}
const queues = (g.__guQueues ||= new Map());

// One change at a time per match, so two quick calls can't trip over each other.
function withMatch(id, fn) {
  const run = (queues.get(id) || Promise.resolve()).then(async () => {
    const store = await getStore();
    const m = await store.get(id);
    if (!m) throw new HttpError(404, "No such match.");
    const out = await fn(m);
    await store.put(m);
    return out;
  });
  const tail = run.catch(() => {});
  queues.set(id, tail);
  tail.then(() => queues.get(id) === tail && queues.delete(id));
  return run;
}

async function load(id) {
  const m = await (await getStore()).get(id);
  if (!m) throw new HttpError(404, "No such match.");
  return m;
}

const token = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const MAX_EVENTS = 600;

function cleanTeam(raw, fallback) {
  const t = raw && typeof raw === "object" ? raw : {};
  const name = text(t.name, { label: "A team name", max: 20 }) || fallback;
  const players = (Array.isArray(t.players) ? t.players : [])
    .map((p) => (typeof p === "string" ? p.trim().slice(0, 20) : ""))
    .filter(Boolean)
    .slice(0, 11);
  return { name, players };
}

export async function createMatch(b) {
  const teams = [cleanTeam(b.teams?.[0], "Team A"), cleanTeam(b.teams?.[1], "Team B")];
  if (teams[0].name.toLowerCase() === teams[1].name.toLowerCase()) throw new HttpError(400, "The two teams need different names.");
  const overs = Number(b.overs);
  if (!Number.isInteger(overs) || overs < 1 || overs > 20) throw new HttpError(400, "Overs must be between 1 and 20.");
  const playersPerSide = Number(b.playersPerSide);
  if (!Number.isInteger(playersPerSide) || playersPerSide < 2 || playersPerSide > 11)
    throw new HttpError(400, "Each side needs between 2 and 11 players.");
  const rulesText = text(b.rulesText, { label: "The lane rules", max: 600 });
  const rules = b.rules && typeof b.rules === "object" ? normaliseRules(b.rules) : await understandRules(rulesText);

  const m = {
    id: token(6),
    k: token(12),
    createdAt: new Date().toISOString(),
    language: b.language === "hinglish" ? "hinglish" : "en",
    setup: { teams, overs, playersPerSide, battingFirst: b.battingFirst === 1 ? 1 : 0, rules, rulesText },
    events: [],
    calls: [],
    commentary: {},
    report: null,
  };
  await (await getStore()).put(m);
  return { id: m.id, k: m.k };
}

export const previewRules = (b) => understandRules(text(b.text, { label: "The lane rules", max: 600 }));

function view(m, k) {
  const state = replay(m.setup, m.events);
  return {
    id: m.id,
    createdAt: m.createdAt,
    language: m.language,
    scorer: Boolean(k) && k === m.k,
    setup: { teams: m.setup.teams, overs: m.setup.overs, playersPerSide: m.setup.playersPerSide, battingFirst: m.setup.battingFirst },
    rules: state.rules,
    innings: state.innings.map((inn) => ({ ...inn, oversText: oversText(inn.balls) })),
    result: state.result,
    scoreLine: scoreLine(state),
    log: state.log.map((entry, index) => ({ ...entry, index, commentary: m.commentary[index] || null })).slice(-40),
    lastCall: m.calls.at(-1) || null,
    events: m.events.length,
    report: m.report,
  };
}

export async function getMatch(id, k) {
  return view(await load(id), k);
}

function scorerOnly(m, k) {
  if (!k || k !== m.k) throw new HttpError(403, "Only the scorer's link can change the score.");
}

function context(m) {
  const state = replay(m.setup, m.events);
  const inn = state.innings.at(-1);
  const teams = m.setup.teams;
  return {
    rules: state.rules,
    battingTeam: teams[inn.batting].name,
    bowlingTeam: teams[inn.bowling].name,
    batters: teams[inn.batting].players.length ? teams[inn.batting].players : inn.batters.map((b) => b.name),
    fielders: teams[inn.bowling].players.length ? teams[inn.bowling].players : [`${teams[inn.bowling].name} bowler`],
    striker: inn.batters[inn.striker]?.name,
    nonStriker: inn.nonStriker === null ? null : inn.batters[inn.nonStriker]?.name,
    bowler: inn.bowler === null ? null : inn.bowlers[inn.bowler]?.name,
  };
}

// The biggest moment in what just happened, for the commentator.
function notable(state, from) {
  const fresh = state.log.map((l, i) => ({ ...l, i })).slice(from).filter((l) => l.kind === "ball");
  const pick =
    fresh.find((l) => l.wicket) || fresh.find((l) => l.boundary === 6) || fresh.find((l) => l.boundary === 4) || fresh.find((l) => l.overDone || l.inningsDone);
  return pick ? pick.i : null;
}

// Applies events (or an undo) and returns what the scorer should hear back.
async function apply(id, k, events, call) {
  return withMatch(id, (m) => {
    scorerOnly(m, k);
    const before = m.events.length;
    if (events === "undo") {
      if (!m.events.length) throw new HttpError(409, "Nothing to undo.");
      m.events.pop();
      for (const key of Object.keys(m.commentary)) if (Number(key) >= m.events.length) delete m.commentary[key];
      m.report = null;
    } else {
      if (m.events.length + events.length > MAX_EVENTS) throw new HttpError(409, "This match is long enough.");
      m.events.push(...events);
    }
    if (call) m.calls = [...m.calls, { ...call, at: new Date().toISOString() }].slice(-10);

    const state = replay(m.setup, m.events);
    const fresh = events === "undo" ? [] : state.log.slice(before);
    const said = events === "undo" ? ["Last ball taken back"] : fresh.map((l) => l.note || l.said || l.ignored).filter(Boolean);
    return {
      match: view(m, k),
      said: [...said, scoreLine(state)].join(". "),
      notable: events === "undo" ? null : notable(state, before),
    };
  });
}

export async function addBall(id, k, b) {
  const ev = normaliseEvent(b.event);
  if (!ev) throw new HttpError(400, "That isn't a ball the scorer understands.");
  return apply(id, k, [ev], { source: "button" });
}

export async function undo(id, k) {
  return apply(id, k, "undo", { source: "undo" });
}

export async function callBall(id, k, b, source = "typed") {
  const heard = text(b.text, { label: "The call", min: 1, max: 300 });
  const m = await load(id);
  scorerOnly(m, k);

  const quick = quickParse(heard);
  if (quick === "undo") return { heard, ...(await undo(id, k)) };
  if (quick) return { heard, how: "instant", ...(await apply(id, k, quick, { source, heard, how: "instant" })) };

  const understood = await understandCall(heard, context(m));
  if (understood.undo) return { heard, ...(await undo(id, k)) };
  if (understood.unclear) {
    return { heard, unclear: true, said: understood.question || "Didn't catch that. Say it again?", match: view(m, k) };
  }
  return { heard, how: "model", ...(await apply(id, k, understood.events, { source, heard, how: "model" })) };
}

export async function voiceBall(id, k, file) {
  const m = await load(id);
  scorerOnly(m, k);
  if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "No audio came through.");
  if (file.size > 5 * 1024 * 1024) throw new HttpError(413, "That recording is too long. Keep calls short.");
  if (file.size < 200) throw new HttpError(400, "That recording was empty. Hold the button while you speak.");
  const players = m.setup.teams.flatMap((t) => t.players);
  let heard;
  try {
    heard = await hear(file, players);
  } catch (err) {
    if (err.status === 503) throw new HttpError(503, err.message);
    throw new HttpError(502, "Couldn't hear that one. Try again, or use the buttons.");
  }
  if (!heard) return { heard: "", unclear: true, said: "Didn't hear anything. Try again?", match: view(m, k) };
  return callBall(id, k, { text: heard }, "voice");
}

export async function commentary(id, k, b) {
  const index = Number(b.index);
  const m = await load(id);
  scorerOnly(m, k);
  if (m.commentary[index]) return { index, line: m.commentary[index] };
  const state = replay(m.setup, m.events);
  const entry = state.log[index];
  if (!entry || entry.kind !== "ball") throw new HttpError(404, "No such ball.");
  const inn = state.innings[entry.innings];
  const teams = m.setup.teams;
  const moment = {
    what: entry.said,
    batter: entry.batter,
    bowler: entry.bowler,
    battingTeam: teams[inn.batting].name,
    score: `${teams[inn.batting].name} ${entry.after.runs} for ${entry.after.wickets} after ${oversText(entry.after.balls)} overs`,
    chase: inn.target !== null ? `chasing ${inn.target}, need ${Math.max(inn.target - entry.after.runs, 0)}` : null,
    endOfOver: entry.overDone,
    endOfInnings: entry.inningsDone ? inn.endReason : null,
    result: state.result && entry.inningsDone ? state.result.text : null,
  };
  let line;
  try {
    line = await commentate(moment, m.language);
  } catch {
    throw new HttpError(502, "The commentator lost the mic for a second.");
  }
  await withMatch(id, (fresh) => {
    if (fresh.events.length > index) fresh.commentary[index] = line;
  });
  return { index, line };
}

export async function report(id, k) {
  const m = await load(id);
  scorerOnly(m, k);
  if (m.report) return { report: m.report };
  const state = replay(m.setup, m.events);
  if (!state.result) throw new HttpError(409, "The match isn't over yet.");
  let written;
  try {
    written = await writeReport(reportCard(state), m.language);
  } catch {
    throw new HttpError(502, "Couldn't write the report just now. Try again in a minute.");
  }
  await withMatch(id, (fresh) => {
    fresh.report = written;
  });
  return { report: written };
}
