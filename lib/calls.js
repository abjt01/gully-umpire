// Turning what someone shouted into events. Simple calls ("four", "wide", "chauka") are matched
// here instantly; anything messier goes to the model in umpire.js, and either way the result is
// checked by normaliseEvent before the engine sees it.
import { HOW_OUT } from "./engine.js";

const int = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const name = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 30) : null);

const HOW_ALIASES = [
  [/one.?tip|ek tip/, "one tip one hand"],
  [/wall|deewar|diwar/, "over the wall"],
  [/run.?out/, "run out"],
  [/stump/, "stumped"],
  [/lbw|leg before/, "lbw"],
  [/hit.?wicket/, "hit wicket"],
  [/caught|catch|kaych|lapka/, "caught"],
  [/bowled|bold|clean/, "bowled"],
  [/retire/, "retired"],
];

export function normaliseHow(how) {
  const s = String(how || "").toLowerCase();
  if (HOW_OUT.includes(s)) return s;
  return HOW_ALIASES.find(([re]) => re.test(s))?.[1] ?? "out";
}

export function normaliseEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind || raw.type;

  if (kind === "ball") {
    const extra = ["wd", "nb", "b", "lb"].includes(raw.extra) ? raw.extra : null;
    const offBat = extra === null || extra === "nb";
    const runs = offBat ? (int(raw.runs, 0, 7) ?? 0) : 0;
    let extraRuns = offBat ? 0 : (int(raw.extraRuns ?? raw.runs, 0, 6) ?? 0);
    if ((extra === "b" || extra === "lb") && extraRuns === 0) extraRuns = 1;
    const boundary = (runs === 4 || runs === 6) && raw.boundary !== false;
    let wicket = null;
    if (raw.wicket && typeof raw.wicket === "object") {
      wicket = {
        how: normaliseHow(raw.wicket.how),
        batter: raw.wicket.batter === "nonStriker" ? "nonStriker" : "striker",
        fielder: name(raw.wicket.fielder),
      };
    } else if (raw.wicket === true) {
      wicket = { how: "out", batter: "striker", fielder: null };
    }
    return { kind, runs, extra, extraRuns, boundary, wicket };
  }
  if (kind === "bowler" || kind === "batter") {
    const n = name(raw.name);
    if (!n) return null;
    return kind === "batter" ? { kind, name: n, end: raw.end === "nonStriker" ? "nonStriker" : "striker" } : { kind, name: n };
  }
  if (kind === "swap" || kind === "endInnings") return { kind };
  return null;
}

// Devanagari words Whisper likes to produce for Hinglish calls, mapped to the Latin ones below.
const DEVANAGARI = [
  [/चौका|चोका/g, "four"],
  [/छक्का|छका/g, "six"],
  [/आउट/g, "out"],
  [/वाइड|वाईड/g, "wide"],
  [/नो\s*बॉल|नोबॉल/g, "no ball"],
  [/डॉट|डोट/g, "dot"],
  [/सिंगल/g, "single"],
  [/एक/g, "ek"],
  [/दो/g, "do"],
  [/तीन/g, "teen"],
  [/रन/g, "run"],
  [/बोल्ड/g, "bowled"],
  [/कैच/g, "caught"],
];

// Whisper sometimes writes Hinglish in Cyrillic ("чauka" for chauka), so read those letters as Latin.
const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const NUMBER_WORDS = {
  zero: 0, dot: 0, khali: 0, "no run": 0,
  one: 1, single: 1, ek: 1, won: 1,
  two: 2, do: 2, double: 2, to: 2, too: 2,
  three: 3, teen: 3, tin: 3,
  four: 4, char: 4, chaar: 4, chauka: 4, chouka: 4, chowka: 4, choka: 4, boundary: 4, for: 4,
  five: 5, paanch: 5, panch: 5,
  six: 6, chhakka: 6, chakka: 6, chhaka: 6, chkhakka: 6, chhakkaa: 6, sixer: 6, chhe: 6,
};

export function cleanCall(text) {
  let s = String(text || "").toLowerCase();
  for (const [re, word] of DEVANAGARI) s = s.replace(re, word);
  s = s.replace(/[\u0400-\u04ff]/g, (c) => CYRILLIC[c] ?? "");
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(hai|ho gaya|hogaya|gaya|bhai|yaar|okay|ok|and|aur|the|a|that s|that is|it s)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const runsOf = (word) => (word in NUMBER_WORDS ? NUMBER_WORDS[word] : int(word, 0, 7));

// Returns events for calls we're sure about, "undo" for take-backs, or null to ask the model.
export function quickParse(text) {
  const s = cleanCall(text);
  if (!s) return null;
  if (/^(undo|galat|cancel|wapas|take back|go back|wrong)$/.test(s)) return "undo";

  let m;
  if (/^(dot|dot ball|no run|khali|zero|0)$/.test(s)) return [ball({ runs: 0 })];
  if ((m = s.match(/^(\w+)( runs?)?$/))) {
    const runs = runsOf(m[1]);
    if (runs !== null && runs !== undefined) return [ball({ runs, boundary: runs === 4 || runs === 6 ? !m[2] : false })];
  }
  if ((m = s.match(/^wide( ball)?( (\w+)( runs?)?)?$/))) {
    const more = m[3] ? runsOf(m[3]) : 0;
    if (more !== null && more !== undefined) return [ball({ extra: "wd", extraRuns: more })];
  }
  if ((m = s.match(/^no ?ball( (\w+)( runs?)?)?$/))) {
    const runs = m[2] ? runsOf(m[2]) : 0;
    if (runs !== null && runs !== undefined) return [ball({ extra: "nb", runs, boundary: runs === 4 || runs === 6 })];
  }
  if ((m = s.match(/^(\w+) (bye|byes|bies|buys|leg bye|leg byes|leg bies|leg buys)$/))) {
    const runs = runsOf(m[1]);
    if (runs) return [ball({ extra: m[2].startsWith("leg") ? "lb" : "b", extraRuns: runs })];
  }
  if (/^(out|bowled|clean bowled|bold)( out)?$/.test(s)) return [ball({ wicket: { how: s.includes("bow") || s.includes("bold") ? "bowled" : "out" } })];
  if ((m = s.match(/^(out )?(caught|catch)( out)?( by (\p{L}+))?$/u))) return [ball({ wicket: { how: "caught", fielder: m[5] } })];
  if (/^(run ?out)$/.test(s)) return [ball({ wicket: { how: "run out" } })];
  if (/^(stumped|lbw|hit wicket)( out)?$/.test(s)) return [ball({ wicket: { how: s.replace(/ out$/, "") } })];
  if (/^(swap|change strike|strike change)$/.test(s)) return [{ kind: "swap" }];

  // speech-to-text glues words together ("no ball pichauka"), so for a no ball look for the runs anywhere
  if (/\bno ?ball\b/.test(s) && !/\b(out|caught|bowled|run ?out|stumped|wide)\b/.test(s)) {
    const hit = s.match(/(chhakka|chakka|chauka|chouka|six|four|\b[0-6]\b)/);
    if (hit) {
      const runs = /chhakka|chakka|six|6/.test(hit[1]) ? 6 : /chauka|chouka|four|4/.test(hit[1]) ? 4 : Number(hit[1]);
      return [ball({ extra: "nb", runs, boundary: runs === 4 || runs === 6 })];
    }
  }
  return null;
}

// Match a heard name back to how it was typed at setup ("neel" -> "Neel").
export function fixNames(events, players) {
  const find = (n) => players.find((p) => p.toLowerCase() === n.toLowerCase()) || n.charAt(0).toUpperCase() + n.slice(1);
  return events.map((e) => {
    if (e.wicket?.fielder) return { ...e, wicket: { ...e.wicket, fielder: find(e.wicket.fielder) } };
    if ((e.kind === "bowler" || e.kind === "batter") && e.name) return { ...e, name: find(e.name) };
    return e;
  });
}

function ball(fields) {
  return normaliseEvent({ kind: "ball", ...fields });
}
