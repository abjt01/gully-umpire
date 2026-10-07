"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { recentMatches } from "./api";

// localStorage only exists in the browser, so read it as an external store with an empty server snapshot.
let cache = null;
const subscribe = () => () => {};
const snapshot = () => (cache ??= JSON.stringify(recentMatches()));
const empty = () => "[]";

export default function RecentMatches() {
  const list = JSON.parse(useSyncExternalStore(subscribe, snapshot, empty));
  if (!list.length) return null;
  return (
    <section className="card">
      <h2>Your matches</h2>
      <ul className="feed">
        {list.map((m) => (
          <li key={m.id}>
            <Link href={`/m/${m.id}?k=${m.k}`}>{m.title}</Link>
            <span className="meta"> · {new Date(m.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
