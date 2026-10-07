// The parts that need a model: hearing the call, understanding a lane's rules, commentary and
// the match report. The engine never depends on any of this; scoring works without a key.
import { normaliseEvent } from "./calls.js";
import { DEFAULT_RULES, normaliseRules, oversText } from "./engine.js";
import { chatJSON, transcribe } from "./llm.js";

export const isMock = () => process.env.MOCK_UMPIRE === "1" || (!process.env.GROQ_API_KEY && !process.env.LLM_BASE_URL);

const MODELS = {
  parse: () => process.env.PARSE_MODEL || "openai/gpt-oss-20b",
  rules: () => process.env.RULES_MODEL || "openai/gpt-oss-20b",
  // Qwen does the most natural Hinglish and one line fits easily in its 1,000 output tokens a minute
  commentary: () => process.env.COMMENTARY_MODEL || "qwen/qwen3.8-27b",
  commentaryBackup: () => process.env.COMMENTARY_BACKUP_MODEL || "openai/gpt-oss-20b",
  report: () => process.env.REPORT_MODEL || "openai/gpt-oss-120b",
};

export function modelInfo() {
  return {
    mock: isMock(),
    groq: !process.env.LLM_BASE_URL,
    ears: process.env.WHISPER_MODEL || "whisper-large-v3-turbo",
    umpire: MODELS.parse(),
    commentator: MODELS.commentary(),
    writer: MODELS.report(),
  };
}

// Words Whisper should expect, so "chauka" doesn't come back as "choker".
const VOCAB =
  "Gully cricket scoring. four, six, single, dot ball, wide, no ball, bye, leg bye, out, clean bowled, caught, run out, stumped, LBW, over the wall, one tip one hand, chauka, chhakka, no ball pe chauka, do run, ek run, teen run, uda diya";

// What Whisper says when it hears silence or wind. Treat these as "heard nothing".
const PHANTOMS = /^(thank you|thanks|thank you for watching|thanks for watching|you|bye|subscribe|okay|hmm|\.)+$/i;

export async function hear(file, players = []) {
  if (isMock()) throw Object.assign(new Error("Voice needs a Groq key. Use the buttons or type the call."), { status: 503 });
  const names = players.length ? ` Players: ${players.slice(0, 22).join(", ")}.` : "";
  const heard = await transcribe(file, { prompt: VOCAB + names });
  const bare = heard.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return !bare || PHANTOMS.test(bare) ? "" : heard;
}

const CALL_SYSTEM = `You are the scorer's ears at a gully cricket match in India: street cricket, tennis ball, a lane instead of a ground. Someone just shouted what happened on the last ball(s). Turn it into scoring events.

The call may be English, Hindi, Hinglish, or a mix, and may come from speech-to-text, so expect misspellings and words glued together: "for" for four, "chakka" for six, "pichauka" for "pe chauka", "clean ball" for "clean bowled". Read it as cricket.

Words you'll hear: chauka/chouka = four, chhakka/chakka/sixer = six, ek = one, do = two, teen = three, khali/dot = no run, lapka/pakda = caught, uda diya/bowled = bowled, wide, no ball, bhaage = ran. Don't mix up chauka (4) and chhakka (6).

Event shapes:
- {"kind":"ball","runs":0-6,"boundary":true|false,"extra":null|"wd"|"nb"|"b"|"lb","extraRuns":0-6,"wicket":null|{"how":"bowled|caught|run out|stumped|lbw|hit wicket|one tip one hand|over the wall|out","batter":"striker|nonStriker","fielder":"name or null"}}
  runs = runs off the bat. For a wide or byes, put the runs they ran in extraRuns. A no ball with a four is extra "nb", runs 4, boundary true.
- {"kind":"bowler","name":"..."} when someone new comes on to bowl
- {"kind":"batter","name":"...","end":"striker|nonStriker"} when a named batter comes in
- {"kind":"swap"} if they say the batters swapped ends without a run
- {"kind":"undo"} if they're taking back the last ball ("galat", "cancel", "undo")

Rules:
- One "ball" event per delivery. "wide wide" is two balls. Most calls are one ball.
- Use the lane rules you're given. If a call describes something the lane counts as out (for example over the wall), make it a wicket.
- Use player names exactly as listed when you recognise them.
- Prefer scoring the obvious reading over asking. Only if a call really could mean different things, return no events with "unclear": true and a short "question".
- If it doesn't sound like a cricket call at all (random words, chatter, a mishearing you can't place), return no events and "unclear": true. A wrong score is worse than asking again.
- Never invent a ball that wasn't described.

Examples:
- "wide hai aur do run bhaag liye" -> one ball, extra "wd", extraRuns 2
- "kuch nahi hua" / "nothing" / "khali gaya" -> one ball, runs 0
- "no ball pe chauka" -> one ball, extra "nb", runs 4, boundary true
- "Aman ne lapka" / "caught by Aman" -> one ball, wicket caught, fielder "Aman"
- "ek tip ek haath se pakda" / "one tip one hand" -> one ball, wicket "one tip one hand"
- "bowled ho gaya" / "uda diya" -> one ball, wicket bowled
- "teen bhaage" -> one ball, runs 3, boundary false
- "Raj bowling" / "ab Raj daalega" -> bowler event, name "Raj"
- "wall pe laga, do run" / "hit the wall, two" -> one ball, runs 2. Hitting the wall is just runs; only going OVER the wall or out of the lane counts as "over the wall".

Reply with only JSON: {"events":[...],"unclear":false,"question":null}`;

export async function understandCall(text, ctx) {
  if (isMock()) return { events: [], unclear: true, question: "I only understand simple calls without a key. Use the buttons." };
  const user = [
    `Lane rules: ${JSON.stringify(ruleSummary(ctx.rules))}`,
    `Batting: ${ctx.battingTeam} (${ctx.batters.join(", ")}). On strike: ${ctx.striker}. Non-striker: ${ctx.nonStriker || "nobody (last man)"}.`,
    `Bowling: ${ctx.bowlingTeam} (${ctx.fielders.join(", ")}). Bowler: ${ctx.bowler || "not named"}.`,
    `The call: "${String(text).slice(0, 300)}"`,
  ].join("\n");
  const raw = await chatJSON({ model: MODELS.parse(), system: CALL_SYSTEM, user, temperature: 0, maxTokens: 800, attempts: 2, maxWait: 3000 });
  const list = Array.isArray(raw.events) ? raw.events.slice(0, 4) : [];
  if (list.some((e) => e?.kind === "undo")) return { undo: true, events: [], unclear: false };
  const events = list.map(normaliseEvent).filter(Boolean);
  return {
    events,
    unclear: !events.length,
    question: typeof raw.question === "string" && raw.question.trim() ? raw.question.trim().slice(0, 140) : null,
  };
}

const RULES_SYSTEM = `Every street-cricket lane in India has its own rules. Turn the description you're given into settings.

Settings and their defaults:
- wideRuns: runs for a wide, 0, 1 or 2 (default 1)
- wideRebowl: true if a wide is bowled again (default true)
- noBallRuns: 0, 1 or 2 (default 1)
- noBallRebowl: default true
- sixIsOut: true if hitting it over the wall/out of the lane is out (default false)
- oneTipOneHand: true if a one-handed catch after one bounce is out (default false)
- lastManStands: true if the last batter can bat alone (default false)
- noLbw: true if there's no LBW (default false)
- notes: any other rules, each a short plain sentence (e.g. "Hitting the neighbour's window is out and the batter fetches the ball")

Only change what the description actually says. Reply with only JSON in exactly that shape.`;

export async function understandRules(text) {
  const t = String(text || "").trim().slice(0, 600);
  if (!t) return normaliseRules({});
  if (isMock()) return quickRules(t);
  try {
    const raw = await chatJSON({ model: MODELS.rules(), system: RULES_SYSTEM, user: t, temperature: 0, maxTokens: 700, attempts: 2, maxWait: 3000 });
    return normaliseRules(raw);
  } catch {
    return quickRules(t);
  }
}

// Keyword fallback so setup still works without a model.
export function quickRules(text) {
  const s = text.toLowerCase();
  const r = { ...DEFAULT_RULES, notes: [] };
  if (/(over the wall|wall ke upar|six is out|six out|chhakka out|out of the lane)/.test(s)) r.sixIsOut = true;
  if (/one.?tip.?one.?hand|ek tip ek haath/.test(s)) r.oneTipOneHand = true;
  if (/last man/.test(s)) r.lastManStands = true;
  if (/no lbw|lbw nahi/.test(s)) r.noLbw = true;
  if (/wide.{0,12}(no run|0 run|zero|koi run nahi)/.test(s)) r.wideRuns = 0;
  if (/wide.{0,20}(counts as a ball|no rebowl|not rebowled)/.test(s)) r.wideRebowl = false;
  return normaliseRules(r);
}

function ruleSummary(rules) {
  const r = rules || DEFAULT_RULES;
  return {
    wide: `${r.wideRuns} run${r.wideRuns === 1 ? "" : "s"}, ${r.wideRebowl ? "bowled again" : "counts as a ball"}`,
    noBall: `${r.noBallRuns} run${r.noBallRuns === 1 ? "" : "s"}, ${r.noBallRebowl ? "bowled again" : "counts as a ball"}`,
    overTheWall: r.sixIsOut ? "out" : "six",
    oneTipOneHand: r.oneTipOneHand ? "out" : "not out",
    lastManStands: r.lastManStands,
    lbw: r.noLbw ? "not allowed" : "allowed",
    other: r.notes,
  };
}

const LANG = {
  en: "Write in simple Indian English.",
  hinglish: "Write in Hinglish (Hindi in Roman script mixed with English), the way friends talk on the street.",
};

const COMMENTARY_SYSTEM = `You're the commentator for a gully cricket match in an Indian street. One short line after a big moment, spoken aloud through a phone speaker on the field.

- One or two short sentences, at most 25 words. It has to sound good out loud.
- Excited, funny, a bit dramatic, warm. Original lines only: don't quote or imitate real commentators.
- Use the players' names and the actual score you're given. Never invent stats.
- Describe exactly what happened. A four is a four (chauka), a six is a six (chhakka): never turn one into the other, and don't call a wicket a boundary.
Reply with only JSON: {"line":"..."}`;

export async function commentate(moment, language = "en") {
  if (isMock()) return mockLine(moment);
  const ask = (model) =>
    chatJSON({
      model,
      system: `${COMMENTARY_SYSTEM}\n${LANG[language] || LANG.en}`,
      user: JSON.stringify(moment),
      temperature: 0.9,
      maxTokens: 500,
      attempts: 1,
    });
  let raw;
  try {
    raw = await ask(MODELS.commentary());
  } catch {
    raw = await ask(MODELS.commentaryBackup());
  }
  const line = typeof raw.line === "string" ? raw.line.trim().slice(0, 220) : "";
  return line || mockLine(moment);
}

function mockLine(m) {
  if (m.what.startsWith("Out")) return `${m.what}. ${m.score}.`;
  if (m.what === "Six!") return `That's gone over everyone's head. ${m.score}.`;
  if (m.what === "Four!") return `Four! Racing down the lane. ${m.score}.`;
  return `End of the over. ${m.score}.`;
}

const REPORT_SYSTEM = `Write a short, fun match report for a gully cricket match that just finished: the kind friends forward on WhatsApp.

- Stick to the scorecard you're given. Don't invent runs, wickets or events. Get it right who batted first and who chased.
- For "top scorer" or "best bowler", use only the facts given. Don't call anyone else the top scorer.
- A catch is taken by a fielder off a bowler: don't mix up who caught it and who bowled it.
- playerOfMatch must be one of the listed players, picked on the numbers.
- Warm and funny. Tease, never mean.
Reply with only JSON:
{"headline":"max 10 words","summary":"3 or 4 sentences","playerOfMatch":{"name":"...","why":"one sentence"},"moments":["three short moments from the match"],"banter":"one funny closing line"}

"moments": pick three items from the moments list and retell each as one short, lively line in your own words. Keep who did what and in which innings exactly as given; add no new facts. If the list is short, use fewer.`

export async function writeReport(card, language = "en") {
  const players = card.innings.flatMap((i) => [...i.batters.map((b) => b.name), ...i.bowlers.map((b) => b.name)]);
  const fallback = mockReport(card);
  if (isMock()) return fallback;
  const raw = await chatJSON({
    model: MODELS.report(),
    system: `${REPORT_SYSTEM}\n${LANG[language] || LANG.en}`,
    user: JSON.stringify(card),
    temperature: 0.4,
    maxTokens: 2500,
    effort: "medium",
    attempts: 3,
    maxWait: 15_000,
  });
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const pom = raw.playerOfMatch && players.find((p) => p.toLowerCase() === String(raw.playerOfMatch.name || "").toLowerCase());
  return {
    headline: str(raw.headline, 100) || fallback.headline,
    summary: str(raw.summary, 900) || fallback.summary,
    playerOfMatch: pom ? { name: pom, why: str(raw.playerOfMatch.why, 200) } : fallback.playerOfMatch,
    moments: (Array.isArray(raw.moments) ? raw.moments : []).map((m) => str(m, 160)).filter(Boolean).slice(0, 4),
    banter: str(raw.banter, 200),
  };
}

function mockReport(card) {
  const batters = card.innings.flatMap((i) => i.batters);
  const top = batters.reduce((a, b) => (b.runs > a.runs ? b : a), batters[0]);
  return {
    headline: card.result,
    summary: `${card.result}. ${top.name} top-scored with ${top.runs}.`,
    playerOfMatch: { name: top.name, why: `Most runs in the match (${top.runs}).` },
    moments: [],
    banter: "",
  };
}

// A compact scorecard for the report writer.
export function reportCard(state) {
  const teams = state.setup.teams.map((t) => t.name);
  const [first, second] = state.innings;
  // superlatives are worked out here, so the writer can't hand out a top score nobody made
  const batters = state.innings.flatMap((inn) => inn.batters.map((b) => ({ ...b, team: teams[inn.batting] })));
  const top = batters.reduce((a, b) => (b.runs > a.runs ? b : a), batters[0]);
  const bowlers = state.innings
    .flatMap((inn) => inn.bowlers.map((b) => ({ ...b, team: teams[inn.bowling] })))
    .filter((b) => !b.name.endsWith(" bowler"));
  const best = bowlers.sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
  // the only moments the writer may use, straight from the ball-by-ball log
  const moments = state.log
    .filter((l) => l.kind === "ball" && (l.wicket || l.boundary))
    .map((l) => {
      const inn = state.innings[l.innings];
      const at = `${teams[inn.batting]} ${l.after.runs}/${l.after.wickets} after ${oversText(l.after.balls)}`;
      const by = l.bowler.endsWith(" bowler") ? "" : ` off ${l.bowler}`;
      const what = l.wicket ? l.said.replace(/^Out! /, "") + `, out${by}` : `${l.batter} hit a ${l.boundary === 6 ? "six" : "four"}${by}`;
      return `${l.innings === 0 ? "1st" : "2nd"} innings: ${what} (${at})`;
    })
    .slice(-12);
  return {
    moments,
    facts: {
      topScorer: `${top.name}: ${top.runs} off ${top.balls} balls, ${top.fours} four${top.fours === 1 ? "" : "s"}, ${top.sixes} six${top.sixes === 1 ? "" : "es"}, for ${top.team}`,
      bestBowler: best ? `${best.name} (${best.wickets} for ${best.runs}, ${best.team})` : "no named bowler",
      winner: state.result?.winner === null || state.result?.winner === undefined ? null : teams[state.result.winner],
    },
    result: state.result?.text || "Match unfinished",
    battedFirst: `${teams[first.batting]} batted first and set ${first.runs + 1} to win`,
    chased: second ? `${teams[second.batting]} chased, finishing on ${second.runs}/${second.wickets}` : null,
    oversPerSide: state.setup.overs,
    laneRules: ruleSummary(state.rules),
    innings: state.innings.map((inn) => ({
      batting: teams[inn.batting],
      total: `${inn.runs}/${inn.wickets} in ${oversText(inn.balls)} overs`,
      batters: inn.batters.map((b) => ({ name: b.name, runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, out: b.out || "not out" })),
      bowlers: inn.bowlers.map((b) => ({ name: b.name, overs: oversText(b.balls), runs: b.runs, wickets: b.wickets })),
      extras: inn.extras,
    })),
  };
}
