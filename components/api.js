export async function api(path, body) {
  const init =
    body === undefined
      ? { cache: "no-store" }
      : body instanceof FormData
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this:", text);
    return false;
  }
}

export const whatsapp = (message) => `https://wa.me/?text=${encodeURIComponent(message)}`;

// Matches started on this phone, so the scorer can get back to them.
const KEY = "gully-umpire:matches";
export function rememberMatch(entry) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]").filter((m) => m.id !== entry.id);
    localStorage.setItem(KEY, JSON.stringify([entry, ...list].slice(0, 10)));
  } catch {}
}
export function recentMatches() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

// Speaking results out loud is the whole point: nobody should need to look at the screen.
export function speak(text, { queue = false } = {}) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    if (!queue) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    u.voice = voices.find((v) => v.lang === "en-IN") || voices.find((v) => v.lang?.startsWith("en")) || null;
    u.rate = 1.05;
    synth.speak(u);
  } catch {}
}
