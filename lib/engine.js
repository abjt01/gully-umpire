// The scorer. A match is its setup plus a list of events; the scorecard is whatever you get
// by replaying them. Undo is just dropping the last event, and nothing here talks to a model.

export const DEFAULT_RULES = {
  wideRuns: 1, // runs given for a wide
  wideRebowl: true, // a wide doesn't count as one of the six balls
  noBallRuns: 1,
  noBallRebowl: true,
  sixIsOut: false, // "over the wall is out"
  oneTipOneHand: false, // caught one-handed after one bounce counts as out
  lastManStands: false, // the last batter can bat alone
  noLbw: false,
  notes: [], // anything else the lane plays by, passed to the umpire as context
};

const BOWLER_CREDIT = new Set(["bowled", "caught", "lbw", "stumped", "hit wicket", "one tip one hand"]);
export const HOW_OUT = ["bowled", "caught", "run out", "stumped", "lbw", "hit wicket", "one tip one hand", "over the wall", "retired"];

export const oversText = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

export function normaliseRules(raw = {}) {
  const r = { ...DEFAULT_RULES };
  for (const key of ["wideRebowl", "noBallRebowl", "sixIsOut", "oneTipOneHand", "lastManStands", "noLbw"]) {
    if (typeof raw[key] === "boolean") r[key] = raw[key];
  }
  for (const key of ["wideRuns", "noBallRuns"]) {
    const n = Number(raw[key]);
    if (Number.isInteger(n) && n >= 0 && n <= 2) r[key] = n;
  }
  r.notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter((n) => typeof n === "string" && n.trim())
    .map((n) => n.trim().slice(0, 140))
    .slice(0, 6);
  return r;
}

function playerName(team, i) {
  return team.players[i] || `${team.name} ${i + 1}`;
}

function startInnings(setup, battingIdx, target) {
  const team = setup.teams[battingIdx];
  const batters = [0, 1].slice(0, Math.min(2, setup.playersPerSide)).map((i) => blankBatter(playerName(team, i)));
  return {
    batting: battingIdx,
    bowling: 1 - battingIdx,
    runs: 0,
    wickets: 0,
    balls: 0,
    extras: { wd: 0, nb: 0, b: 0, lb: 0 },
    batters,
    striker: 0,
    nonStriker: batters.length > 1 ? 1 : null,
    nextIn: batters.length,
    bowlers: [],
    bowler: null,
    overs: [[]],
    fow: [],
    target,
    done: false,
    endReason: null,
  };
}

const blankBatter = (name) => ({ name, runs: 0, balls: 0, fours: 0, sixes: 0, out: null });

function currentBowler(inn, setup) {
  if (inn.bowler === null) {
    // nobody named for this over: book it to a generic bowler so the totals still add up
    const name = `${setup.teams[inn.bowling].name} bowler`;
    let i = inn.bowlers.findIndex((b) => b.name === name);
    if (i === -1) i = inn.bowlers.push({ name, balls: 0, runs: 0, wickets: 0 }) - 1;
    inn.bowler = i;
  }
  return inn.bowlers[inn.bowler];
}

function allOutAt(setup, rules) {
  return rules.lastManStands ? setup.playersPerSide : setup.playersPerSide - 1;
}

function checkEnd(inn, setup, rules) {
  if (inn.wickets >= allOutAt(setup, rules)) return "all out";
  if (inn.target !== null && inn.runs >= inn.target) return "target chased";
  if (inn.balls >= setup.overs * 6) return "overs done";
  return null;
}

// What a ball looks like in the over strip: "•", "4", "W", "Wd", "Nb+4", "2lb".
function symbol(ball, wicket) {
  if (ball.extra === "wd") return ball.extraRuns ? `Wd+${ball.extraRuns}` : "Wd";
  if (ball.extra === "nb") return ball.runs ? `Nb+${ball.runs}` : "Nb";
  if (ball.extra === "b" || ball.extra === "lb") return wicket ? "W" : `${ball.extraRuns}${ball.extra}`;
  if (wicket) return ball.runs ? `${ball.runs}W` : "W";
  return ball.runs ? String(ball.runs) : "•";
}

export function describe(ball, outName) {
  if (ball.wicket) {
    const how = ball.wicket.how;
    const by = ball.wicket.fielder ? ` by ${ball.wicket.fielder}` : "";
    return `Out! ${outName}, ${how}${["caught", "run out", "stumped", "one tip one hand"].includes(how) ? by : ""}`;
  }
  if (ball.extra === "wd") return ball.extraRuns ? `Wide, and ${ball.extraRuns} more` : "Wide";
  if (ball.extra === "nb") return ball.runs ? `No ball, and ${ball.runs} off the bat` : "No ball";
  if (ball.extra === "b") return `${ball.extraRuns} bye${ball.extraRuns === 1 ? "" : "s"}`;
  if (ball.extra === "lb") return `${ball.extraRuns} leg bye${ball.extraRuns === 1 ? "" : "s"}`;
  if (ball.runs === 6) return "Six!";
  if (ball.runs === 4) return "Four!";
  if (ball.runs === 0) return "Dot ball";
  return ball.runs === 1 ? "Single" : `${ball.runs} runs`;
}

// Gully rules the engine enforces itself, so a model can never talk its way around them.
function applyLaneRules(ball, rules) {
  const b = structuredClone(ball);
  let note = null;
  if (rules.sixIsOut && !b.extra && b.runs === 6 && !b.wicket) {
    b.runs = 0;
    b.wicket = { how: "over the wall", batter: "striker", fielder: null };
    note = "Over the wall is out in this lane";
  }
  if (b.wicket?.how === "lbw" && rules.noLbw) {
    b.wicket = null;
    note = "No LBW in this lane, so not out";
  }
  if (b.wicket?.how === "one tip one hand" && !rules.oneTipOneHand) {
    b.wicket = null;
    note = "One tip one hand isn't a rule here, so not out";
  }
  return { ball: b, note };
}

function playBall(state, inn, raw) {
  const { setup, rules } = state;
  const { ball, note } = applyLaneRules(raw, rules);
  const bowler = currentBowler(inn, setup);
  const striker = inn.batters[inn.striker];
  const before = { runs: inn.runs, wickets: inn.wickets, balls: inn.balls };

  let legal = true;
  let total = 0;
  let ran = 0; // runs actually run between the wickets, which decides who's on strike

  if (ball.extra === "wd") {
    total = rules.wideRuns + ball.extraRuns;
    ran = ball.extraRuns;
    legal = !rules.wideRebowl;
    inn.extras.wd += total;
    bowler.runs += total;
  } else if (ball.extra === "nb") {
    total = rules.noBallRuns + ball.runs;
    ran = ball.boundary ? 0 : ball.runs;
    legal = !rules.noBallRebowl;
    inn.extras.nb += rules.noBallRuns;
    striker.runs += ball.runs;
    striker.balls += 1;
    if (ball.runs === 4 && ball.boundary) striker.fours += 1;
    if (ball.runs === 6 && ball.boundary) striker.sixes += 1;
    bowler.runs += total;
  } else if (ball.extra === "b" || ball.extra === "lb") {
    total = ball.extraRuns;
    ran = ball.extraRuns;
    inn.extras[ball.extra] += total;
    striker.balls += 1;
  } else {
    total = ball.runs;
    ran = ball.boundary ? 0 : ball.runs;
    striker.runs += ball.runs;
    striker.balls += 1;
    if (ball.runs === 4 && ball.boundary) striker.fours += 1;
    if (ball.runs === 6 && ball.boundary) striker.sixes += 1;
    bowler.runs += total;
  }
  inn.runs += total;

  let outName = null;
  if (ball.wicket) {
    const end = ball.wicket.batter === "nonStriker" && inn.nonStriker !== null ? "nonStriker" : "striker";
    const outIdx = inn[end];
    const out = inn.batters[outIdx];
    outName = out.name;
    const how = ball.wicket.how;
    out.out = ball.wicket.fielder && ["caught", "run out", "stumped"].includes(how) ? `${how} (${ball.wicket.fielder})` : how;
    inn.wickets += 1;
    if (BOWLER_CREDIT.has(how)) bowler.wickets += 1;
    inn.fow.push({ runs: inn.runs, wicket: inn.wickets, batter: out.name, over: oversText(inn.balls + (legal ? 1 : 0)) });

    if (inn.wickets < allOutAt(setup, rules)) {
      const remaining = setup.playersPerSide - inn.nextIn;
      if (remaining > 0) {
        inn.batters.push(blankBatter(playerName(setup.teams[inn.batting], inn.nextIn)));
        inn[end] = inn.batters.length - 1;
        inn.nextIn += 1;
      } else {
        // last man stands: the survivor bats alone, always on strike
        const survivor = end === "striker" ? inn.nonStriker : inn.striker;
        inn.striker = survivor;
        inn.nonStriker = null;
      }
    }
  }

  if (ran % 2 === 1 && inn.nonStriker !== null) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];

  inn.overs[inn.overs.length - 1].push(symbol(ball, Boolean(ball.wicket)));
  if (legal) {
    inn.balls += 1;
    bowler.balls += 1;
  }

  const ended = checkEnd(inn, setup, rules);
  const overDone = legal && inn.balls % 6 === 0 && !ended;
  if (overDone) {
    if (inn.nonStriker !== null) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
    inn.overs.push([]);
    inn.bowler = null;
  }
  if (ended) {
    inn.done = true;
    inn.endReason = ended;
  }

  return {
    kind: "ball",
    innings: state.innings.indexOf(inn),
    batter: striker.name,
    bowler: bowler.name,
    said: describe(ball, outName),
    note,
    total,
    legal,
    boundary: !ball.wicket && ball.boundary ? ball.runs : null,
    wicket: Boolean(ball.wicket),
    overDone,
    inningsDone: Boolean(ended),
    before,
    after: { runs: inn.runs, wickets: inn.wickets, balls: inn.balls },
  };
}

function current(state) {
  return state.innings[state.innings.length - 1];
}

export function replay(setup, events = []) {
  const rules = normaliseRules(setup.rules);
  const state = { setup, rules, innings: [startInnings(setup, setup.battingFirst, null)], log: [], result: null };

  for (const ev of events) {
    let inn = current(state);
    if (state.result) {
      state.log.push({ kind: ev.kind, ignored: "match is over" });
      continue;
    }
    if (inn.done) {
      // first innings is over: the next event starts the chase
      inn = startInnings(setup, 1 - setup.battingFirst, inn.runs + 1);
      state.innings.push(inn);
    }

    if (ev.kind === "ball") {
      state.log.push(playBall(state, inn, ev));
    } else if (ev.kind === "bowler") {
      let i = inn.bowlers.findIndex((b) => b.name.toLowerCase() === ev.name.toLowerCase());
      if (i === -1) i = inn.bowlers.push({ name: ev.name, balls: 0, runs: 0, wickets: 0 }) - 1;
      inn.bowler = i;
      state.log.push({ kind: "bowler", said: `${ev.name} to bowl` });
    } else if (ev.kind === "batter") {
      const idx = ev.end === "nonStriker" ? inn.nonStriker : inn.striker;
      const b = idx === null ? null : inn.batters[idx];
      if (b && b.balls === 0 && b.runs === 0) {
        b.name = ev.name;
        state.log.push({ kind: "batter", said: `${ev.name} is in` });
      } else {
        state.log.push({ kind: "batter", ignored: "that batter has already faced a ball" });
      }
    } else if (ev.kind === "swap") {
      if (inn.nonStriker !== null) [inn.striker, inn.nonStriker] = [inn.nonStriker, inn.striker];
      state.log.push({ kind: "swap", said: "Strike changed" });
    } else if (ev.kind === "endInnings") {
      inn.done = true;
      inn.endReason = "called off";
      state.log.push({ kind: "endInnings", said: "Innings over" });
    } else {
      state.log.push({ kind: ev.kind, ignored: "unknown event" });
    }

    if (state.innings.length === 2 && current(state).done) state.result = result(state);
  }

  // first innings ended on the last event: show the chase as ready to start
  if (!state.result && current(state).done && state.innings.length === 1) {
    state.innings.push(startInnings(setup, 1 - setup.battingFirst, current(state).runs + 1));
  }
  return state;
}

function result(state) {
  const [first, second] = state.innings;
  const names = state.setup.teams.map((t) => t.name);
  if (second.runs >= second.target) {
    const left = allOutAt(state.setup, state.rules) - second.wickets;
    return { winner: second.batting, text: `${names[second.batting]} won by ${left} wicket${left === 1 ? "" : "s"}` };
  }
  if (second.runs === first.runs) return { winner: null, text: "It's a tie" };
  const by = first.runs - second.runs;
  return { winner: first.batting, text: `${names[first.batting]} won by ${by} run${by === 1 ? "" : "s"}` };
}

// One line for the scorer to hear after each ball: "Four! 24 for 1 after 2.3."
export function scoreLine(state) {
  const inn = current(state);
  if (state.result) return state.result.text;
  const score = `${inn.runs} for ${inn.wickets}`;
  const chase = inn.target !== null ? `, need ${Math.max(inn.target - inn.runs, 0)} off ${state.setup.overs * 6 - inn.balls}` : "";
  return `${score} after ${oversText(inn.balls)}${chase}`;
}
