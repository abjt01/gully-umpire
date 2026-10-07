// API behaviour against the built app in mock mode (no AI key). Run `npm run build` first.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { client, startServer, waitFor } from "./helpers/server.js";

let server;
let call;
before(async () => {
  server = await startServer();
  call = client(server.base);
});
after(() => server?.stop());

const SETUP = {
  teams: [
    { name: "Gali 4", players: ["Rohan", "Aman", "Kabir"] },
    { name: "Building C", players: ["Ishaan", "Neel", "Raj"] },
  ],
  overs: 1,
  playersPerSide: 3,
  battingFirst: 0,
  rulesText: "over the wall is out, one tip one hand",
};

async function newMatch(extra = {}) {
  const { status, data } = await call("POST", "/api/matches", { body: { ...SETUP, ...extra } });
  assert.equal(status, 201, JSON.stringify(data));
  return data;
}
const said = (res) => res.data.said;

describe("setting up a match", () => {
  test("rejects bad setups with a readable message", async () => {
    const bad = [
      [{ overs: 0 }, "Overs must be between 1 and 20."],
      [{ overs: 21 }, "Overs must be between 1 and 20."],
      [{ playersPerSide: 1 }, "Each side needs between 2 and 11 players."],
      [{ playersPerSide: 12 }, "Each side needs between 2 and 11 players."],
      [{ teams: [{ name: "Same" }, { name: "same" }] }, "The two teams need different names."],
      [{ rulesText: "x".repeat(601) }, "The lane rules is too long (max 600 characters)."],
    ];
    for (const [over, error] of bad) {
      const res = await call("POST", "/api/matches", { body: { ...SETUP, ...over } });
      assert.equal(res.status, 400, JSON.stringify(over));
      assert.equal(res.data.error, error);
    }
    assert.equal((await call("POST", "/api/matches", { body: "{nope" })).status, 400);
  });

  test("rules typed in plain words become settings, even without a model", async () => {
    const { id } = await newMatch();
    const { data } = await call("GET", `/api/matches/${id}`);
    assert.equal(data.rules.sixIsOut, true);
    assert.equal(data.rules.oneTipOneHand, true);
  });

  test("rules can be previewed before starting", async () => {
    const { data } = await call("POST", "/api/rules", { body: { text: "last man stands, no lbw" } });
    assert.equal(data.rules.lastManStands, true);
    assert.equal(data.rules.noLbw, true);
  });

  test("blank team names get defaults", async () => {
    const { id } = await newMatch({ teams: [{}, {}] });
    const { data } = await call("GET", `/api/matches/${id}`);
    assert.deepEqual(data.setup.teams.map((t) => t.name), ["Team A", "Team B"]);
  });
});

describe("scoring", () => {
  test("only the scorer's link can change the score", async () => {
    const { id, k } = await newMatch();
    const viewer = await call("GET", `/api/matches/${id}`);
    assert.equal(viewer.data.scorer, false);
    assert.equal((await call("GET", `/api/matches/${id}`, { k })).data.scorer, true);
    for (const [action, body] of [
      ["ball", { event: { kind: "ball", runs: 4 } }],
      ["call", { text: "four" }],
      ["undo", {}],
      ["report", {}],
    ]) {
      assert.equal((await call("POST", `/api/matches/${id}/${action}`, { body })).status, 403, action);
      assert.equal((await call("POST", `/api/matches/${id}/${action}`, { k: "wrong", body })).status, 403, action);
    }
  });

  test("buttons, quick calls and undo", async () => {
    const { id, k } = await newMatch();
    assert.match(said(await call("POST", `/api/matches/${id}/ball`, { k, body: { event: { kind: "ball", runs: 4, boundary: true } } })), /^Four! 4 for 0/);
    assert.match(said(await call("POST", `/api/matches/${id}/call`, { k, body: { text: "chauka" } })), /^Four! 8 for 0/);
    assert.match(said(await call("POST", `/api/matches/${id}/call`, { k, body: { text: "छक्का" } })), /over the wall/);
    assert.match(said(await call("POST", `/api/matches/${id}/call`, { k, body: { text: "galat" } })), /^Last ball taken back/);
    const { data } = await call("GET", `/api/matches/${id}`);
    assert.equal(data.innings[0].runs, 8);
    assert.equal(data.innings[0].wickets, 0);
  });

  test("bad events and empty undos are refused", async () => {
    const { id, k } = await newMatch();
    assert.equal((await call("POST", `/api/matches/${id}/ball`, { k, body: { event: { kind: "teleport" } } })).status, 400);
    assert.equal((await call("POST", `/api/matches/${id}/undo`, { k, body: {} })).status, 409);
    assert.equal((await call("POST", `/api/matches/${id}/call`, { k, body: { text: "" } })).status, 400);
    assert.equal((await call("POST", `/api/matches/${id}/fly`, { k, body: {} })).status, 404);
  });

  test("a call the quick parser can't read asks again without a model", async () => {
    const { id, k } = await newMatch();
    const res = await call("POST", `/api/matches/${id}/call`, { k, body: { text: "Rohan ne wall pe maara aur bhaag gaya" } });
    assert.equal(res.status, 200);
    assert.equal(res.data.unclear, true);
    assert.equal(res.data.match.events, 0);
  });

  test("voice without a key says so instead of failing silently", async () => {
    const { id, k } = await newMatch();
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(4000)], { type: "audio/webm" }), "call.webm");
    const res = await fetch(`${server.base}/api/matches/${id}/voice?k=${k}`, { method: "POST", body: form });
    assert.equal(res.status, 503);
    const empty = new FormData();
    empty.append("audio", new Blob([new Uint8Array(10)], { type: "audio/webm" }), "call.webm");
    assert.equal((await fetch(`${server.base}/api/matches/${id}/voice?k=${k}`, { method: "POST", body: empty })).status, 400);
    assert.equal((await fetch(`${server.base}/api/matches/${id}/voice?k=${k}`, { method: "POST", body: "nope" })).status, 400);
  });

  test("calls that land at the same moment are both scored, in order", async () => {
    const { id, k } = await newMatch();
    await Promise.all(["1", "2", "four"].map((text) => call("POST", `/api/matches/${id}/call`, { k, body: { text } })));
    const { data } = await call("GET", `/api/matches/${id}`);
    assert.equal(data.events, 3);
    assert.equal(data.innings[0].runs, 7);
  });
});

describe("a whole match", () => {
  test("innings break, chase, result, commentary and report", async () => {
    const { id, k } = await newMatch({ rulesText: "" });
    const score = (text) => call("POST", `/api/matches/${id}/call`, { k, body: { text } });

    for (const t of ["four", "1", "dot", "wide", "bowled", "2"]) await score(t);
    assert.match(said(await score("single")), /End of the innings\. Gali 4 made 9 for 1\. Building C need 10 to win off 6 balls/);
    let { data } = await call("GET", `/api/matches/${id}`);
    assert.equal(data.innings[0].done, true);
    assert.equal(data.lastCall.heard, "single");
    assert.equal(data.innings[1].target, 10);

    const notable = await score("six");
    assert.equal(typeof notable.data.notable, "number");
    const c = await call("POST", `/api/matches/${id}/commentary`, { k, body: { index: notable.data.notable } });
    assert.ok(c.data.line.length > 0);
    assert.equal((await call("POST", `/api/matches/${id}/report`, { k, body: {} })).status, 409, "not over yet");

    const last = await score("four");
    assert.match(last.data.said, /Building C won by 2 wickets/);
    ({ data } = await call("GET", `/api/matches/${id}`));
    assert.equal(data.result.winner, 1);
    assert.match(said(await score("four")), /match is over/);

    const report = await call("POST", `/api/matches/${id}/report`, { k, body: {} });
    assert.equal(report.status, 200);
    assert.ok(report.data.report.headline);
    const again = await call("GET", `/api/matches/${id}`);
    assert.deepEqual(again.data.report, report.data.report, "report is kept");
  });

  test("undo after the result reopens the match and drops the report", async () => {
    const { id, k } = await newMatch({ rulesText: "", playersPerSide: 2 });
    for (const t of ["bowled", "bowled"]) await call("POST", `/api/matches/${id}/call`, { k, body: { text: t } });
    await call("POST", `/api/matches/${id}/report`, { k, body: {} });
    await call("POST", `/api/matches/${id}/undo`, { k, body: {} });
    const { data } = await call("GET", `/api/matches/${id}`);
    assert.equal(data.result, null);
    assert.equal(data.report, null);
  });

  test("unknown match is a 404 everywhere", async () => {
    assert.equal((await call("GET", "/api/matches/nope")).status, 404);
    assert.equal((await call("POST", "/api/matches/nope/call", { k: "x", body: { text: "four" } })).status, 404);
    assert.equal((await call("GET", `/api/matches/${"x".repeat(3000)}`)).status, 404);
  });
});

describe("rate limiting", () => {
  test("one address can't create endless matches", async () => {
    const limited = await startServer({ env: { DISABLE_RATE_LIMIT: "0" } });
    const api = client(limited.base);
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await api("POST", "/api/matches", { body: SETUP })).status);
    await limited.stop();
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(201));
    assert.equal(statuses[30], 429);
  });
});

describe("waitFor helper sanity", () => {
  test("resolves when the condition holds", async () => assert.equal(await waitFor(async () => 1), 1));
});
