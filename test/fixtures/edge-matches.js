// Matches with the longest, strangest data the app accepts, for the layout tests.
const now = new Date().toISOString();
const long = (ch, n) => ch.repeat(n);

const LONG_TEAMS = [
  { name: long("A", 20), players: [long("R", 20), "प्रियंका शर्मा", "Raj 🏏🏏 the GOAT", "<b>x</b> & \"q\"", "Zed", "Om"] },
  { name: "बिल्डिंग सी वाले", players: ["Ishaan", long("N", 20), "Raj", "Om", "Dev", "Kabir"] },
];
const ball = (f) => ({ kind: "ball", runs: 0, extra: null, extraRuns: 0, boundary: false, wicket: null, ...f });

const busyOver = [
  { kind: "bowler", name: long("N", 20) },
  ball({ runs: 4, boundary: true }),
  ball({ extra: "wd", extraRuns: 4 }),
  ball({ extra: "nb", runs: 6, boundary: true }),
  ball({ wicket: { how: "caught", batter: "striker", fielder: long("N", 20) } }),
  ball({ extra: "lb", extraRuns: 2 }),
  ball({ runs: 6, boundary: true }),
  ball({ runs: 1 }),
];

const setup = (over = {}) => ({
  teams: LONG_TEAMS,
  overs: 2,
  playersPerSide: 6,
  battingFirst: 0,
  rules: { sixIsOut: false, oneTipOneHand: true, lastManStands: true, notes: [long("n", 140)] },
  rulesText: "",
  ...over,
});

const match = (id, events, extra = {}) => ({
  id,
  k: "scorer",
  createdAt: now,
  language: "hinglish",
  setup: setup(extra.setup),
  events,
  calls: [{ source: "voice", heard: long("x", 300), how: "model", at: now }],
  commentary: Object.fromEntries(events.map((_, i) => [i, `Commentary ${long("c", 200)}`])),
  report: extra.report ?? null,
  ...(extra.k && { k: extra.k }),
});

const twelve = Array.from({ length: 12 }, () => ball({ runs: 1 }));

export const EDGE_MATCHES = {
  fresh: match("fresh", []),
  busy: match("busy", busyOver),
  done: match("done", [...busyOver, ...twelve, ...twelve], {
    report: {
      headline: `Headline ${long("H", 90)}`,
      summary: long("Summary sentence. ", 40),
      playerOfMatch: { name: long("R", 20), why: long("w", 200) },
      moments: [long("m", 160), long("m", 160), long("m", 160)],
      banter: long("b", 200),
    },
  }),
  tiny: match("tiny", [], { setup: { teams: [{ name: "A", players: [] }, { name: "B", players: [] }], playersPerSide: 2, overs: 1, rules: {} } }),
};
