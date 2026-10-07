// Starts the built app (`npm run build` first) on a free port with its own data folder.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export function tempDataDir(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flatmate-court-"));
  if (seed) fs.writeFileSync(path.join(dir, "cases.json"), JSON.stringify(seed));
  return dir;
}

export async function startServer({ env = {}, dataDir = tempDataDir() } = {}) {
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("Run `npm run build` before these tests.");
  const port = await freePort();
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      GROQ_API_KEY: "",
      MONGODB_URI: "",
      MOCK_COURT: "1",
      DISABLE_RATE_LIMIT: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      DATA_DIR: dataDir,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    base,
    dataDir,
    log: () => log,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill();
      }),
  };
}

// Small JSON client with the case tokens passed as query params, like the real pages do.
export function client(base) {
  return async function call(method, url, { body, k, p } = {}) {
    const q = new URLSearchParams();
    if (k) q.set("k", k);
    if (p) q.set("p", p);
    const res = await fetch(`${base}${url}${q.size ? `?${q}` : ""}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}

export async function waitFor(fn, { timeout = 15000, interval = 200 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error("timed out waiting");
}
