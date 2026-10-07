import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normaliseEvent, quickParse } from "../../lib/calls.js";
import { normaliseRules, oversText, replay, scoreLine } from "../../lib/engine.js";

const setup = (over = {}) => ({
  teams: [
    { name: "Lane A", players: ["Rohan", "Aman", "Kabir", "Dev"] },
    { name: "Lane B", players: ["Ishaan", "Neel", "Raj", "Om"] },
  ],
  overs: 2,
  playersPerSide: 4,
  battingFirst: 0,
  rules: {},
  ...over,
});
const b = (fields) => normaliseEvent({ kind: "ball", ...fields });
const runs = (...rs) => rs.map((r) => b({ runs: r }));
const inn = (s, i = 0) => s.innings[i];

describe("runs and strike", () => {
  test("odd runs rotate strike, even runs don't", () => {
    const s = replay(setup(), runs(1, 2, 3));
    assert.equal(inn(s).runs, 6);
    const striker = inn(s).batters[inn(s).striker].name;
    assert.equal(striker, "Rohan"); // 1 -> Aman, 2 stays Aman, 3 -> Rohan
  });

  test("boundaries count for the batter and don't rotate", () => {
    const s = replay(setup(), [b({ runs: 4 }), b({ runs: 6 })]);
    const rohan = inn(s).batters[0];
    assert.deepEqual([rohan.runs, rohan.fours, rohan.sixes, rohan.balls], [10, 1, 1, 2]);
    assert.equal(inn(s).batters[inn(s).striker].name, "Rohan");
  });

  test("end of over swaps strike and adds a new over", () => {
    const s = replay(setup(), runs(0, 0, 0, 0, 0, 0));
    assert.equal(inn(s).balls, 6);
    assert.equal(inn(s).overs.length, 2);
    assert.equal(inn(s).batters[inn(s).striker].name, "Aman");
    assert.equal(oversText(inn(s).balls), "1.0");
  });
});

describe("extras", () => {
  test("a wide gives a run and is bowled again by default", () => {
    const s = replay(setup(), [b({ extra: "wd" })]);
    assert.deepEqual([inn(s).runs, inn(s).balls, inn(s).extras.wd], [1, 0, 1]);
  });

  test("lane rules can make a wide worth nothing and count as a ball", () => {
    const s = replay(setup({ rules: { wideRuns: 0, wideRebowl: false } }), [b({ extra: "wd" })]);
    assert.deepEqual([inn(s).runs, inn(s).balls], [0, 1]);
  });

  test("no ball plus a four: batter gets four, team gets five", () => {
    const s = replay(setup(), [b({ extra: "nb", runs: 4 })]);
    assert.deepEqual([inn(s).runs, inn(s).batters[0].runs, inn(s).balls], [5, 4, 0]);
  });

  test("byes go to extras, not the batter or the bowler", () => {
    const s = replay(setup(), [b({ extra: "b", extraRuns: 1 })]);
    assert.equal(inn(s).runs, 1);
    assert.equal(inn(s).batters[0].runs, 0);
    assert.equal(inn(s).bowlers[0].runs, 0);
    assert.equal(inn(s).batters[inn(s).striker].name, "Aman", "a single bye still rotates strike");
  });
});

describe("wickets", () => {
  test("next batter in order comes in at the same end", () => {
    const s = replay(setup(), [b({ wicket: { how: "bowled" } })]);
    assert.equal(inn(s).wickets, 1);
    assert.equal(inn(s).batters[0].out, "bowled");
    assert.equal(inn(s).batters[inn(s).striker].name, "Kabir");
    assert.equal(inn(s).bowlers[0].wickets, 1);
  });

  test("run out doesn't go to the bowler, and can be the non-striker", () => {
    const s = replay(setup(), [b({ wicket: { how: "run out", batter: "nonStriker" } })]);
    assert.equal(inn(s).batters[1].out, "run out");
    assert.equal(inn(s).bowlers[0].wickets, 0);
    assert.equal(inn(s).batters[inn(s).striker].name, "Rohan");
  });

  test("caught records the fielder", () => {
    const s = replay(setup(), [b({ wicket: { how: "caught", fielder: "Neel" } })]);
    assert.equal(inn(s).batters[0].out, "caught (Neel)");
  });

  test("all out at players minus one", () => {
    const s = replay(setup(), Array.from({ length: 3 }, () => b({ wicket: { how: "bowled" } })));
    assert.equal(inn(s).done, true);
    assert.equal(inn(s).endReason, "all out");
    assert.equal(s.innings.length, 2, "the chase is ready to start");
  });

  test("last man stands: the survivor bats alone and keeps strike", () => {
    const s = replay(setup({ rules: { lastManStands: true } }), [
      ...Array.from({ length: 3 }, () => b({ wicket: { how: "bowled" } })),
      b({ runs: 1 }),
    ]);
    assert.equal(inn(s).done, false);
    assert.equal(inn(s).nonStriker, null);
    assert.equal(inn(s).batters[inn(s).striker].runs, 1);
    const s2 = replay(setup({ rules: { lastManStands: true } }), Array.from({ length: 4 }, () => b({ wicket: { how: "bowled" } })));
    assert.equal(inn(s2).endReason, "all out");
  });
});

describe("gully rules the engine enforces", () => {
  test("over the wall is out", () => {
    const s = replay(setup({ rules: { sixIsOut: true } }), [b({ runs: 6 })]);
    assert.deepEqual([inn(s).runs, inn(s).wickets], [0, 1]);
    assert.equal(s.log[0].note, "Over the wall is out in this lane");
  });

  test("no LBW means not out", () => {
    const s = replay(setup({ rules: { noLbw: true } }), [b({ wicket: { how: "lbw" } })]);
    assert.equal(inn(s).wickets, 0);
  });

  test("one tip one hand only counts if the lane plays it", () => {
    assert.equal(inn(replay(setup(), [b({ wicket: { how: "one tip one hand" } })])).wickets, 0);
    assert.equal(inn(replay(setup({ rules: { oneTipOneHand: true } }), [b({ wicket: { how: "one tip one hand" } })])).wickets, 1);
  });

  test("rules are cleaned up", () => {
    const r = normaliseRules({ wideRuns: 9, sixIsOut: "yes", notes: ["  window = out ", 7, ""] });
    assert.equal(r.wideRuns, 1);
    assert.equal(r.sixIsOut, false);
    assert.deepEqual(r.notes, ["window = out"]);
  });
});

describe("innings and results", () => {
  const twelve = (r) => runs(...Array(12).fill(r));

  test("overs running out ends the innings and sets the target", () => {
    const s = replay(setup(), twelve(1));
    assert.equal(inn(s).endReason, "overs done");
    assert.equal(inn(s, 1).target, 13);
  });

  test("chasing team wins by wickets", () => {
    const s = replay(setup(), [...twelve(1), b({ runs: 6 }), b({ runs: 6 }), b({ runs: 1 })]);
    assert.equal(s.result.text, "Lane B won by 3 wickets");
    assert.equal(inn(s, 1).endReason, "target chased");
  });

  test("defending team wins by runs", () => {
    const s = replay(setup(), [...twelve(1), ...twelve(0)]);
    assert.equal(s.result.text, "Lane A won by 12 runs");
  });

  test("a tie is a tie", () => {
    const s = replay(setup(), [...twelve(1), ...runs(...Array(11).fill(1))]);
    assert.equal(s.result, null, "one ball left");
    const tie = replay(setup(), [...twelve(1), ...twelve(1)]);
    assert.equal(tie.result.text, "It's a tie");
  });

  test("events after the result are ignored", () => {
    const s = replay(setup(), [...twelve(1), ...twelve(0), b({ runs: 4 })]);
    assert.equal(s.log.at(-1).ignored, "match is over");
  });

  test("score line for the scorer to hear", () => {
    const s = replay(setup(), [...twelve(1), b({ runs: 4 })]);
    assert.equal(scoreLine(s), "4 for 0 after 0.1, need 9 off 11");
  });
});

describe("other events", () => {
  test("naming the bowler books the over to them", () => {
    const s = replay(setup(), [{ kind: "bowler", name: "Ishaan" }, ...runs(4, 1)]);
    assert.equal(inn(s).bowlers[0].name, "Ishaan");
    assert.equal(inn(s).bowlers[0].runs, 5);
  });

  test("renaming a batter only works before they've faced a ball", () => {
    const s = replay(setup(), [{ kind: "batter", name: "Virat", end: "striker" }, b({ runs: 1 }), { kind: "batter", name: "X", end: "nonStriker" }]);
    assert.equal(inn(s).batters[0].name, "Virat");
    assert.equal(inn(s).batters[0].runs, 1);
    assert.equal(inn(s).batters[0].name !== "X", true);
  });
});

describe("quick calls", () => {
  const first = (t) => quickParse(t)?.[0];
  test("runs in English, Hinglish and Devanagari", () => {
    assert.equal(first("Four.").runs, 4);
    assert.equal(first("chauka").boundary, true);
    assert.equal(first("चौका").runs, 4);
    assert.equal(first("छक्का").runs, 6);
    assert.equal(first("do run").runs, 2);
    assert.equal(first("single").runs, 1);
    assert.equal(first("dot ball").runs, 0);
    assert.equal(first("4 runs").boundary, false, "four runs run, not a boundary");
  });

  test("extras", () => {
    assert.equal(first("wide").extra, "wd");
    assert.deepEqual([first("wide and two runs").extra, first("wide and two runs").extraRuns], ["wd", 2]);
    assert.deepEqual([first("no ball and four").extra, first("no ball and four").runs], ["nb", 4]);
    assert.equal(first("2 leg byes").extra, "lb");
  });

  test("wickets", () => {
    assert.equal(first("bowled").wicket.how, "bowled");
    assert.deepEqual(first("caught by Rohan").wicket, { how: "caught", batter: "striker", fielder: "rohan" });
    assert.equal(first("run out").wicket.how, "run out");
    assert.equal(first("आउट").wicket.how, "out");
  });

  test("undo and anything unclear", () => {
    assert.equal(quickParse("undo"), "undo");
    assert.equal(quickParse("galat"), "undo");
    assert.equal(quickParse("Aman ne wall ke upar maara"), null);
    assert.equal(quickParse(""), null);
  });

  test("events from anywhere are checked", () => {
    assert.equal(normaliseEvent({ kind: "ball", runs: 99 }).runs, 0);
    assert.equal(normaliseEvent({ kind: "ball", extra: "lb" }).extraRuns, 1);
    assert.equal(normaliseEvent({ kind: "ball", wicket: { how: "caught behind" } }).wicket.how, "caught");
    assert.equal(normaliseEvent({ kind: "teleport" }), null);
    assert.equal(normaliseEvent({ kind: "bowler", name: "  " }), null);
  });
});
