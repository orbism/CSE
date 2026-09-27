"use client";

import { useState } from "react";
import type { LabEngine } from "@cse/art";
import {
  DEFAULT_GIF_FPS,
  DEFAULT_GIF_SIZE,
  DEFAULT_SECONDS,
  GIF_RATES,
  GIF_SIZES,
  MAX_SECONDS,
  MIN_SECONDS,
  PNG_SIZE,
  exportGif,
  exportPng,
  frameCount,
} from "@/lib/export";

/**
 * PNG and GIF for a Lab form. No MP4, deliberately: video is for pieces that
 * exist, and it would pull a 31 MB ffmpeg wasm blob onto a page people are meant
 * to poke at idly.
 *
 * The Lab needs its own bar rather than the gallery's because of the feedback
 * loop — see the freeze below, which the gallery has no concept of.
 */
export function LabExportBar({ engine, name }: { engine: LabEngine | null; name: string }) {
  const [open, setOpen] = useState<"png" | "gif" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(DEFAULT_GIF_FPS);
  const [size, setSize] = useState<number>(DEFAULT_GIF_SIZE);
  const [seconds, setSeconds] = useState<number>(DEFAULT_SECONDS);

  const frames = frameCount({ fps, seconds });

  async function run(job: string, fn: () => Promise<void>) {
    if (!engine || busy) return;
    setBusy(job);
    setError(null);
    setStatus("starting…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      await fn();
      setStatus("done");
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      engine?.redraw();
      setBusy(null);
    }
  }

  return (
    <div className="export-bar">
      <div className="mono-label">Download</div>

      <div className="export-buttons">
        <button
          className={open === "png" ? "on" : ""}
          disabled={!engine || busy !== null}
          onClick={() => setOpen((o) => (o === "png" ? null : "png"))}
          title={`Still image, ${PNG_SIZE}×${PNG_SIZE}`}
        >
          PNG
        </button>
        <button
          className={open === "gif" ? "on" : ""}
          disabled={!engine || busy !== null}
          onClick={() => setOpen((o) => (o === "gif" ? null : "gif"))}
          title="Looping GIF"
        >
          GIF
        </button>
      </div>

      {open === "png" && (
        <div className="export-opts">
          <button
            className="primary"
            disabled={busy !== null}
            onClick={() => run("png", async () => exportPng(engine!, name))}
          >
            {busy === "png" ? "Rendering…" : `Download PNG · ${PNG_SIZE}²`}
          </button>
        </div>
      )}

      {open === "gif" && (
        <div className="export-opts">
          {/* `opt-row`/`opt-choices`, the same classes the gallery's export bar
              uses — they already carry the selected-state rule. The bespoke
              class this had before was styled nowhere, so a chosen size or rate
              looked identical to an unchosen one. */}
          <div className="opt-row">
            <span className="opt-label">Size</span>
            <div className="opt-choices">
              {GIF_SIZES.map((s) => (
                <button key={s} className={s === size ? "on" : ""} onClick={() => setSize(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="opt-row">
            <span className="opt-label">Rate</span>
            <div className="opt-choices">
              {GIF_RATES.map((r) => (
                <button key={r} className={r === fps ? "on" : ""} onClick={() => setFps(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <label className="mono-label">Seconds</label>
          <input
            type="range"
            min={MIN_SECONDS}
            max={MAX_SECONDS}
            step={1}
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
          <div className="export-note">
            {frames} frames · one full revolution
          </div>

          <button
            className="primary"
            disabled={busy !== null}
            onClick={() =>
              run("gif", async () => {
                /*
                 * The export has to show the same thing the canvas does —
                 * feedback included, since that is the setting the Lab has and
                 * the collection does not.
                 *
                 * Two things make that work. `primeLoop` walks the field through
                 * one revolution first, so it is already on its periodic orbit
                 * when frame 0 is taken and the last frame meets the first.
                 * Stopping the animation loop matters just as much: `exportGif`
                 * yields between frames, and a live rAF tick would step the
                 * field at some unrelated rotation in the gap, pulling every
                 * subsequent frame off that orbit.
                 */
                const wasRunning = engine!.running;
                engine!.stop();
                try {
                  engine!.primeLoop(frames);
                  await exportGif(engine!, name, { fps, seconds, size, hud: false }, (stage, done, total) =>
                    setStatus(`${stage} ${done}/${total}`),
                  );
                } finally {
                  if (wasRunning) engine!.start();
                }
              })
            }
          >
            {busy === "gif" ? status || "Encoding…" : `Download GIF · ${frames} frames`}
          </button>
        </div>
      )}

      {status && !busy && <div className="export-note">{status}</div>}
      {error && <div className="status err">{error}</div>}
    </div>
  );
}
