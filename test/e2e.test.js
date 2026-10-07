// Real-browser tests: every screen at phone-to-desktop widths in both themes, then the flows clicked
// through. Needs `npm run build` and Chrome (set CHROME_PATH if it isn't in a usual place).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import puppeteer from "puppeteer-core";
import { EDGE_MATCHES } from "./fixtures/edge-matches.js";
import { startServer, tempDataDir } from "./helpers/server.js";

const CHROME =
  process.env.CHROME_PATH ||
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((p) => fs.existsSync(p));
if (!CHROME && process.env.CI) throw new Error("Chrome not found; set CHROME_PATH");

const RESULTS = path.resolve("test-results");
const WIDTHS = [320, 390, 768, 1280];
const THEMES = ["light", "dark"];

let browser;
before(async () => {
  if (!CHROME) return;
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
  });
});
after(() => browser?.close());

// Runs in the page: anything wider than the viewport or spilling out of its box.
function layoutProblems() {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const desc = (el) => {
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls} "${(el.innerText || "").trim().slice(0, 30).replace(/\s+/g, " ")}"`;
  };
  if (document.documentElement.scrollWidth > vw) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if ((cs.opacity === "0" && cs.position === "absolute") || el.closest("[aria-hidden=true]")) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) out.push(`off screen: ${desc(el)}`);
    if (!["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      out.push(`content wider than its box: ${desc(el)}`);
    const p = el.parentElement;
    if (p && p !== document.body && !getComputedStyle(p).display.startsWith("inline")) {
      const spill = r.right - p.getBoundingClientRect().right;
      if (spill > 1) out.push(`spills ${Math.round(spill)}px out of ${desc(p)}: ${desc(el)}`);
    }
  }
  return [...new Set(out)];
}

async function newPage(width, theme = "light", errors = []) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/status of 4\d\d|status of 503/.test(m.text())) errors.push(m.text());
  });
  page.on("dialog", (d) => d.dismiss());
  await page.setViewport({ width, height: 900, isMobile: width < 600, hasTouch: width < 600 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  return page;
}

describe("layout", { skip: !CHROME && "Chrome not found" }, () => {
  let server;
  before(async () => (server = await startServer({ dataDir: tempDataDir(EDGE_MATCHES) })));
  after(() => server?.stop());

  const pages = [
    ["home", "/", null],
    ["new match with rules checked", "/new", "rules"],
    ["scorer, first ball", "/m/fresh?k=scorer", null],
    ["scorer, busy over with the out sheet open", "/m/busy?k=scorer", "Out"],
    ["scorer, no ball sheet", "/m/busy?k=scorer", "Nb"],
    ["spectator, busy over", "/m/busy", null],
    ["finished with report", "/m/done", null],
    ["scorer, finished", "/m/done?k=scorer", null],
    ["tiny match", "/m/tiny?k=scorer", "Bye"],
    ["missing match", "/m/nope", null],
    ["404 page", "/no/such/page", null],
  ];

  for (const [name, url, open] of pages) {
    test(name, async () => {
      const failures = [];
      for (const width of WIDTHS) {
        for (const theme of THEMES) {
          const errors = [];
          const page = await newPage(width, theme, errors);
          try {
          await page.goto(server.base + url, { waitUntil: "networkidle2" });
          await page.waitForFunction(() => !document.body.innerText.includes("Walking out to the pitch"), { timeout: 8000 });
          await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
          if (open === "rules") {
            await page.waitForSelector("form[data-ready]");
            await page.type("textarea[placeholder^='Over the wall']", "over the wall is out, last man stands, no lbw");
            const [btn] = await page.$$("xpath/.//button[contains(., 'Check how the umpire')]");
            await btn.click();
            await page.waitForSelector(".rules");
          } else if (open) {
            const [btn] = await page.$$(`xpath/.//button[normalize-space()='${open}']`);
            if (btn) await btn.click();
          }
          await new Promise((r) => setTimeout(r, 100));
          const problems = [...(await page.evaluate(layoutProblems)), ...errors.map((e) => `browser error: ${e}`)];
          if (problems.length) {
            fs.mkdirSync(RESULTS, { recursive: true });
            await page.screenshot({ path: path.join(RESULTS, `${name.replace(/\W+/g, "-")}-${width}-${theme}.png`), fullPage: true });
            failures.push(`${width}px ${theme}:\n    ${problems.slice(0, 8).join("\n    ")}`);
          }
          } catch (err) {
            fs.mkdirSync(RESULTS, { recursive: true });
            await page.screenshot({ path: path.join(RESULTS, `${name.replace(/\W+/g, "-")}-${width}-${theme}-error.png`), fullPage: true });
            failures.push(`${width}px ${theme}: ${err.message}`);
          }
          await page.close();
        }
      }
      assert.equal(failures.length, 0, failures.join("\n"));
    });
  }
});

describe("flows", { skip: !CHROME && "Chrome not found" }, () => {
  let server;
  const errors = [];
  before(async () => (server = await startServer()));
  after(() => server?.stop());

  const open = async (url, width = 390) => {
    const page = await newPage(width, "light", errors);
    await page.goto(server.base + url, { waitUntil: "networkidle2" });
    return page;
  };
  const text = (page) => page.evaluate(() => document.body.innerText);
  const waitText = (page, s, timeout = 10000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, s);
  const score = (page) => page.$eval(".score", (e) => e.innerText);
  async function click(page, label) {
    await page.bringToFront();
    const [el] = await page.$$(`xpath/.//*[self::button or self::a or self::label][normalize-space()='${label}']`);
    assert.ok(el, `no "${label}" on ${page.url()}`);
    await el.click();
  }
  async function clickIn(page, scope, label) {
    await page.bringToFront();
    const [el] = await page.$$(`${scope} ::-p-xpath(.//*[self::button or self::label][normalize-space()='${label}'])`);
    assert.ok(el, `no "${label}" inside ${scope} on ${page.url()}`);
    await el.click();
  }
  async function type(page, selector, value, index = 0) {
    await page.bringToFront();
    const el = (await page.$$(selector))[index];
    await el.focus();
    await el.evaluate((e) => e.select?.());
    await el.type(value);
  }
  // do something on the scorer page and wait for the server to answer it
  async function act(page, fn) {
    const answered = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/matches/"), { timeout: 10000 });
    await fn();
    await answered;
    await new Promise((r) => setTimeout(r, 150));
  }

  let scorer;
  let scorerUrl;

  test("setting up a match", async () => {
    scorer = await open("/new");
    await scorer.waitForSelector("form[data-ready]");
    await type(scorer, "input[maxlength='20']", "Gali 4", 0);
    await type(scorer, "input[maxlength='20']", "Building C", 1);
    await type(scorer, "textarea", "Rohan, Aman, Kabir", 0);
    await type(scorer, "textarea", "Ishaan, Neel, Raj", 1);
    await type(scorer, "input[type='number']", "1", 0);
    await click(scorer, "+ Over the wall is out");
    const [check] = await scorer.$$("xpath/.//button[contains(., 'Check how the umpire')]");
    await check.click();
    await scorer.waitForSelector(".rules");
    const wall = await scorer.$$eval(".rule", (rows) => rows.find((r) => r.innerText.includes("Over the wall"))?.querySelector("input").checked);
    assert.equal(wall, true, "the umpire read the rule");
    await click(scorer, "Start the match");
    await scorer.waitForFunction(() => location.pathname.startsWith("/m/"), { timeout: 10000 });
    await scorer.waitForSelector(".mic");
    scorerUrl = scorer.url();
    assert.match(await score(scorer), /^0\/0$/);
    assert.ok((await text(scorer)).includes("Who's bowling this over?"));
  });

  test("buttons, sheets, typed calls and undo", async () => {
    await clickIn(scorer, ".sheet", "Neel");
    await waitText(scorer, "Neel: 0.0-0-0");

    await act(scorer, () => click(scorer, "4"));
    assert.equal(await score(scorer), "4/0");

    await act(scorer, async () => {
      await click(scorer, "Nb");
      await clickIn(scorer, ".sheet", "2");
    });
    assert.equal(await score(scorer), "7/0", "no ball plus two");

    await act(scorer, () => click(scorer, "6"));
    assert.equal(await score(scorer), "7/1", "over the wall is out in this lane");
    assert.ok((await text(scorer)).includes("Over the wall is out in this lane"));

    await act(scorer, () => click(scorer, "Undo"));
    assert.equal(await score(scorer), "7/0");

    await act(scorer, async () => {
      await click(scorer, "Out");
      await clickIn(scorer, ".sheet", "caught");
      await clickIn(scorer, ".sheet", "Raj");
      await clickIn(scorer, ".sheet", "Give it out");
    });
    assert.equal(await score(scorer), "7/1");
    assert.ok((await text(scorer)).includes("caught by Raj"));

    await act(scorer, async () => {
      await type(scorer, "input[aria-label='Type the call']", "chauka");
      await click(scorer, "Score");
    });
    assert.equal(await score(scorer), "11/1");
    assert.match(await text(scorer), /Heard\W*chauka/);

    await act(scorer, async () => {
      await type(scorer, "input[aria-label='Type the call']", "something nobody can parse here");
      await click(scorer, "Score");
    });
    assert.ok((await text(scorer)).includes("simple calls"), "asks again");
    assert.equal(await score(scorer), "11/1", "an unclear call scores nothing");
  });

  test("a friend following the live link sees the score but no controls", async () => {
    const friend = await open(new URL(scorerUrl).pathname);
    await friend.waitForSelector(".score");
    assert.equal(await score(friend), "11/1");
    assert.equal(await friend.$(".mic"), null);
    assert.equal(await friend.$(".pad"), null);
    await act(scorer, () => click(scorer, "1"));
    await friend.bringToFront();
    await friend.waitForFunction(() => document.querySelector(".score")?.innerText === "12/1", { timeout: 10000 });
  });

  test("finishing the match and writing the report", async () => {
    // two legal balls left in the first innings
    for (const label of ["•", "•"]) {
      await act(scorer, () => click(scorer, label));
    }
    await waitText(scorer, "Target 13");
    await clickIn(scorer, ".sheet", "Rohan");
    for (const label of ["4", "4", "4", "1"]) {
      await act(scorer, () => click(scorer, label));
    }
    await waitText(scorer, "Building C won by");
    assert.equal(await scorer.$(".mic"), null, "no mic once it's over");
    await click(scorer, "Write the match report");
    await scorer.waitForSelector(".report", { timeout: 10000 });
    assert.ok((await text(scorer)).includes("Player of the match"));
    const share = await scorer.$$eval("a.btn", (as) => as.map((a) => decodeURIComponent(a.href)).find((h) => h.includes("wa.me")));
    assert.match(share, /Building C won by/);
  });

  test("the home page remembers the match", async () => {
    await scorer.goto(server.base + "/", { waitUntil: "networkidle2" });
    await waitText(scorer, "Your matches");
    assert.ok((await text(scorer)).includes("Gali 4 vs Building C"));
  });

  test("no browser errors along the way", () => {
    assert.deepEqual([...new Set(errors)], []);
  });
});
