"use client";

import { useEffect, useRef, useState } from "react";

const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
const EXT = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg" };
const MAX_MS = 8000;

// Hold to talk. The mic stream stays open between calls so the browser only asks once.
export default function Recorder({ onAudio, busy, onError }) {
  const stream = useRef(null);
  const rec = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const [live, setLive] = useState(false);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function start() {
    if (rec.current || busy) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("This browser can't record. Use the buttons below.");
      return;
    }
    try {
      stream.current ||= await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      onError("Microphone is blocked. Allow it for this site, or use the buttons below.");
      return;
    }
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    const r = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      clearTimeout(timer.current);
      rec.current = null;
      setLive(false);
      const mime = (r.mimeType || type || "audio/webm").split(";")[0];
      const blob = new Blob(chunks.current, { type: mime });
      onAudio(blob, `call.${EXT[mime] || "webm"}`);
    };
    r.start();
    rec.current = r;
    setLive(true);
    timer.current = setTimeout(stop, MAX_MS);
  }

  function stop() {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }

  return (
    <button
      type="button"
      className={`mic${live ? " live" : ""}${busy ? " busy" : ""}`}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && start()}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Hold to call the ball"
    >
      <span>
        {live ? "Listening…" : busy ? "Scoring…" : "Hold and shout the ball"}
        <small>{live ? "Let go when you're done" : "“four” · “wide” · “out, caught by Rohan” · “chauka”"}</small>
      </span>
    </button>
  );
}
