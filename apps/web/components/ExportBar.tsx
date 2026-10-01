"use client";

import { useState } from "react";
import type { Engine } from "@cse/art";
import {
  DEFAULT_GIF_FPS,
  DEFAULT_GIF_SIZE,
  DEFAULT_MP4_FPS,
  DEFAULT_MP4_SIZE,
  DEFAULT_SECONDS,
  GIF_RATES,
  GIF_SIZES,
  MAX_SECONDS,
  MIN_SECONDS,
  MP4_RATES,
  MP4_SIZES,
  PNG_SIZE,
  BYTES_WARN,
  PRESSURE_MAX,
  PRESSURE_WARN,
  estimateGifBytes,
  estimateMp4Bytes,
  exportGif,
  exportMp4,
  exportPng,
  frameCount,
  framePressure,
} from "@/lib/export";

type Job = "png" | "gif" | "mp4";

const size = (bytes: number) =>
  bytes > 900_000 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Download a Form as a still, a looping GIF or a looping MP4.
 *
 * Choosing a format opens its settings rather than exporting immediately: rate
 * and length together decide the frame count, which is what actually costs the
 * time and — for GIF — nearly all of the file size. Worth seeing before
 * committing to a run.
 */
export function ExportBar({ engine, name }: { engine: Engine | null; name: string }) {
  const [busy, setBusy] = useState<Job | null>(null);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState<Job | null>(null);
  const [hud, setHud] = useState(false);
  const [gifFps, setGifFps] = useState<number>(DEFAULT_GIF_FPS);
  const [mp4Fps, setMp4Fps] = useState<number>(DEFAULT_MP4_FPS);
  const [gifSize, setGifSize] = useState<number>(DEFAULT_GIF_SIZE);
  const [mp4Size, setMp4Size] = useState<number>(DEFAULT_MP4_SIZE);
  const [seconds, setSeconds] = useState(DEFAULT_SECONDS);

  const isMp4 = open === "mp4";
  const fps = isMp4 ? mp4Fps : gifFps;
  const outSize = isMp4 ? mp4Size : gifSize;
  const loop = { fps, seconds, size: outSize, hud };
  const frames = frameCount(loop);
  const pressure = framePressure(loop);
  const tooHeavy = pressure > PRESSURE_MAX;
  const bytes = isMp4 ? estimateMp4Bytes(loop) : estimateGifBytes(loop);

  async function run(job: Job, fn: () => Promise<void>) {
    if (!engine || busy) return;
    setBusy(job);
    setError(null);
    setProgress(null);
    setStatus("starting…");
    // let the bar paint before the render loop blocks the thread
    await new Promise((r) => setTimeout(r, 30));
    try {
      await fn();
      setStatus("done");
      setTimeout(() => setStatus(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      // loop encoders leave the piece on their last sampled frame
      engine?.redraw();
      setBusy(null);
      setProgress(null);
    }
  }

  const onProgress = (stage: string, done: number, total: number) => {
    setStatus(total > 1 ? `${stage} ${done}/${total}` : stage);
    setProgress(total > 1 ? { done, total } : null);
  };

  const pick = (job: Job) => setOpen((o) => (o === job ? null : job));

  return (
    <div className="export-bar">
      <div className="mono-label">Download</div>

      <div className="export-buttons">
        <button
          className={open === "png" ? "on" : ""}
          disabled={!engine || busy !== null}
          onClick={() => pick("png")}
          title={`Still image, ${PNG_SIZE}×${PNG_SIZE}`}
        >
          PNG
        </button>
        <button
          className={open === "gif" ? "on" : ""}
          disabled={!engine || busy !== null}
          onClick={() => pick("gif")}
          title="Looping GIF"
        >
          GIF
        </button>
        <button
          className={open === "mp4" ? "on" : ""}
          disabled={!engine || busy !== null}
          onClick={() => pick("mp4")}
          title="Looping MP4"
        >
          MP4
        </button>
      </div>

      {open && (
        <div className="export-opts">
          {open !== "png" && (
            <>
              <div className="opt-row">
                <span className="opt-label">Size</span>
                <div className="opt-choices">
                  {(isMp4 ? MP4_SIZES : GIF_SIZES).map((sz) => (
                    <button
                      key={sz}
                      className={outSize === sz ? "on" : ""}
                      onClick={() => (isMp4 ? setMp4Size(sz) : setGifSize(sz))}
                      title={sz >= 560 ? "Full readout text fits" : "Readout shows tags only"}
                    >
                      {sz === 2048 ? "2K" : sz}
                    </button>
                  ))}
                </div>
              </div>

              <div className="opt-row">
                <span className="opt-label">Rate</span>
                <div className="opt-choices">
                  {(isMp4 ? MP4_RATES : GIF_RATES).map((r) => (
                    <button
                      key={r}
                      className={fps === r ? "on" : ""}
                      onClick={() => (isMp4 ? setMp4Fps(r) : setGifFps(r))}
                    >
                      {r}fps
                    </button>
                  ))}
                </div>
              </div>

              <div className="opt-row">
                <span className="opt-label">Length</span>
                <input
                  type="range"
                  min={MIN_SECONDS}
                  max={MAX_SECONDS}
                  step={0.5}
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                />
                <span className="opt-value num">{seconds.toFixed(1)}s</span>
              </div>

              <div className="opt-note">
                {outSize}×{outSize} · {frames} frames · {(360 / frames).toFixed(1)}° apart · ~
                {size(bytes)}
                {hud && outSize < 560 && <> · readout: tags only</>}
              </div>

              {(pressure > PRESSURE_WARN || bytes > BYTES_WARN) && (
                <div className={`opt-warn ${tooHeavy ? "hard" : ""}`}>
                  {tooHeavy
                    ? `Too large to encode in the browser: ${frames} frames at ${outSize}px will not fit in memory. Reduce the size, rate or length.`
                    : bytes > BYTES_WARN
                      ? `About ${size(bytes)}, large enough to be awkward to share. ${frames} frames at ${outSize}px will also take a while.`
                      : `Heavy: ${frames} frames at ${outSize}px. This will take a while.`}
                </div>
              )}
            </>
          )}

          <label className="opt-check">
            <input type="checkbox" checked={hud} onChange={(e) => setHud(e.target.checked)} />
            <span>Keep readout</span>
          </label>

          <button
            className="primary opt-go"
            disabled={!engine || busy !== null || tooHeavy}
            onClick={() => {
              if (open === "png") return run("png", () => exportPng(engine!, name, hud));

              /*
               * Loops carry the Feedback trait's trail, which is history rather
               * than a function of the pose. `primeLoop` runs one revolution
               * first so the trail is already on its periodic orbit at frame 0
               * and the last frame meets the first. Stopping the animation loop
               * matters too: the encoder yields between frames, and a live rAF
               * tick would advance the trail at an unrelated rotation in the gap.
               */
              const loopExport = (fn: () => Promise<void>) => async () => {
                const wasRunning = engine!.running;
                engine!.stop();
                try {
                  engine!.primeLoop(frames);
                  await fn();
                } finally {
                  if (wasRunning) engine!.start();
                }
              };

              if (open === "gif")
                return run("gif", loopExport(() => exportGif(engine!, name, loop, onProgress)));
              return run("mp4", loopExport(() => exportMp4(engine!, name, loop, onProgress)));
            }}
          >
            Export {open.toUpperCase()}
          </button>
        </div>
      )}

      {busy && (
        <div className="export-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
          <div
            className={`export-progress-fill ${progress ? "" : "indeterminate"}`}
            style={progress ? { width: `${(progress.done / progress.total) * 100}%` } : undefined}
          />
          <span className="export-progress-text">{status || "working…"}</span>
        </div>
      )}

      {busy === "mp4" && status.startsWith("loading") && (
        <div className="export-note">First MP4 downloads a 31 MB encoder. Once only.</div>
      )}
      {error && <div className="status err">{error}</div>}
    </div>
  );
}
