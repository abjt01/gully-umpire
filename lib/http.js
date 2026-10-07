export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a route handler so thrown HttpErrors become JSON responses.
export function route(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      console.error(err);
      return Response.json({ error: "Something went wrong. Try that again." }, { status: 500 });
    }
  };
}

export async function readBody(req) {
  const raw = await req.text();
  if (raw.length > 64 * 1024) throw new HttpError(413, "That request is too big.");
  if (!raw.trim()) return {};
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "That request didn't make sense.");
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

export function creds(req) {
  const q = new URL(req.url).searchParams;
  return { k: q.get("k") || "", p: q.get("p") || "" };
}

export function text(value, { label, max, min = 0 }) {
  const s = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (s.length < min) throw new HttpError(400, min > 1 ? `${label} is too short.` : `${label} is required.`);
  if (s.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
  return s;
}

const buckets = (globalThis.__guBuckets ||= new Map());

export function rateLimit(req, name, max, windowMs) {
  if (process.env.DISABLE_RATE_LIMIT === "1") return;
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  const key = `${name}:${ip}`;
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) throw new HttpError(429, "Slow down a little. Try again in a bit.");
  recent.push(now);
  buckets.set(key, recent);
}
