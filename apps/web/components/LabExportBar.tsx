"use client";

import { useState } from "react";
import type { LabEngine } from "@cse/art";
import type { AudioDrive } from "@/lib/audio";
import {
  DEFAULT_GIF_FPS,
  DEFAULT_GIF_SIZE,
  DEFAULT_MP4_FPS,
  DEFAULT_SECONDS,
  GIF_RATES,
  GIF_SIZES,
  MAX_SECONDS,
  MIN_SECONDS,
  MP4_RATES,
  PNG_SIZE,
  type LoopOptions,
  exportGif,
  exportMp4,
  exportPng,
  frameCount,
  recordLiveMp4,
} from "@/lib/export";

/** Square video edges: 720p, 1080p and 1440p heights. */
const MP4_SIZES = [720, 1080, 1440] as const;
/** A silent MP4 is two seamless revolutions; one with sound, 1 to 4 turns' worth. */
const SILENT_LOOPS = 2;
const AUDIO_LOOPS = [1, 2, 3, 4] as const;

type Format = "png" | "gif" | "mp4";

/**
 * PNG, GIF and MP4 for a Lab form. The MP4 encoder is a 31 MB ffmpeg wasm
 * blob, loaded only when an MP4 is actually asked for.
 *
 * An MP4 can carry the Lab's live audio (tab, mic or radio). That one is
 * recorded in real time, visuals reacting as they play, rather than rendered
 * as a seamless loop: sound can't be rendered ahead of time.
 *
 * The Lab needs its own bar rather than the gallery's because of the feedback
 * loop — see `loop` below, which the gallery has no concept of.
 */
export function LabExportBar({
  engine,
  name,
  canvas,
  audio,
}: {
  engine: LabEngine | null;
  name: string;
  /** The Lab's live canvas, recorded when the MP4 carries sound. */
  canvas: HTMLCanvasElement | null;
  /** The Lab's current audio input, if any. */
  audio: AudioDrive | null;
}) {
  const [open, setOpen] = useState<Format | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gifFps, setGifFps] = useState<number>(DEFAULT_GIF_FPS);
  const [gifSize, setGifSize] = useState<number>(DEFAULT_GIF_SIZE);
  const [mp4Fps, setMp4Fps] = useState<number>(DEFAULT_MP4_FPS);
  const [mp4Size, setMp4Size] = useState<number>(MP4_SIZES[1]);
  const [withAudio, setWithAudio] = useState(false);
  const [audioLoops, setAudioLoops] = useState(2);
  const [seconds, setSeconds] = useState<number>(DEFAULT_SECONDS);

  const fps = open === "mp4" ? mp4Fps : gifFps;
  const live = withAudio && !!audio && !!canvas;
  const frames = frameCount({ fps, seconds }) * (open === "mp4" ? SILENT_LOOPS : 1);

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

  /*
   * A loop export has to show the same thing the canvas does — feedback
   * included, since that is the setting the Lab has and the collection does
   * not.
   *
   * Two things make that work. `primeLoop` walks the field through one
   * revolution first, so it is already on its periodic orbit when frame 0 is
   * taken and the last frame meets the first. Stopping the animation loop
   * matters just as much: the encoders yield between frames, and a live rAF
   * tick would step the field at some unrelated rotation in the gap, pulling
   * every subsequent frame off that orbit.
   */
  const loop = (job: Format, encode: (opts: LoopOptions) => Promise<void>, opts: LoopOptions) =>
    run(job, async () => {
      const wasRunning = engine!.running;
      engine!.stop();
      try {
        engine!.primeLoop(frameCount(opts));
        await encode(opts);
      } finally {
        if (wasRunning) engine!.start();
      }
    });

  const progress = (stage: string, done: number, total: number) => setStatus(`${stage} ${done}/${total}`);

  const tab = (f: Format, label: string, title: string) => (
    <button
      className={open === f ? "on" : ""}
      disabled={!engine || busy !== null}
      onClick={() => setOpen((o) => (o === f ? null : f))}
      title={title}
    >
      {label}
    </button>
  );

  const secondsSlider = (
    <>
      <label className="mono-label">Seconds per turn</label>
      <input
        type="range"
        min={MIN_SECONDS}
        max={MAX_SECONDS}
        step={1}
        value={seconds}
        onChange={(e) => setSeconds(Number(e.target.value))}
      />
    </>
  );

  return (
    <div className="export-bar">
      <div className="mono-label">Download</div>

      <div className="export-buttons">
        {tab("png", "PNG", `Still image, ${PNG_SIZE}×${PNG_SIZE}`)}
        {tab("gif", "GIF", "Looping GIF")}
        {tab("mp4", "MP4", "Looping H.264 video")}
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
          <Choices label="Size" options={GIF_SIZES} value={gifSize} onChange={setGifSize} />
          <Choices label="Rate" options={GIF_RATES} value={gifFps} onChange={setGifFps} />
          {secondsSlider}
          <div className="export-note">{frames} frames · one full revolution</div>
          <button
            className="primary"
            disabled={busy !== null}
            onClick={() =>
              loop("gif", (o) => exportGif(engine!, name, o, progress), {
                fps: gifFps,
                seconds,
                size: gifSize,
                hud: false,
              })
            }
          >
            {busy === "gif" ? status || "Encoding…" : `Download GIF · ${frames} frames`}
          </button>
        </div>
      )}

      {open === "mp4" && (
        <div className="export-opts">
          <Choices label="Size" options={MP4_SIZES} value={mp4Size} onChange={setMp4Size} />
          <Choices label="Rate" options={MP4_RATES} value={mp4Fps} onChange={setMp4Fps} />
          <label className="opt-check" title={audio ? "" : "Pick an input in Sound first"}>
            <input
              type="checkbox"
              checked={live}
              disabled={!audio}
              onChange={(e) => setWithAudio(e.target.checked)}
            />
            Record audio{audio ? "" : " · pick an input in Sound first"}
          </label>
          {live && <Choices label="Loops" options={AUDIO_LOOPS} value={audioLoops} onChange={setAudioLoops} />}
          {secondsSlider}
          <div className="export-note">
            {live
              ? `records live with sound · ${seconds * audioLoops}s`
              : `${frames} frames · two seamless revolutions · ${seconds * SILENT_LOOPS}s`}
          </div>
          <button
            className="primary"
            disabled={busy !== null}
            onClick={() =>
              live
                ? run("mp4", async () => {
                    // the canvas renders at the export size while it records,
                    // and keeps animating so it reacts to the music
                    const wasRunning = engine!.running;
                    const prev = canvas!.width;
                    engine!.start();
                    engine!.resize(mp4Size);
                    const tap = audio!.record();
                    try {
                      await recordLiveMp4(canvas!, tap.stream, { fps: mp4Fps, seconds: seconds * audioLoops }, name, progress);
                    } finally {
                      tap.release();
                      engine!.resize(prev);
                      if (!wasRunning) engine!.stop();
                    }
                  })
                : loop("mp4", (o) => exportMp4(engine!, name, o, progress), {
                    fps: mp4Fps,
                    seconds,
                    size: mp4Size,
                    hud: false,
                    loops: SILENT_LOOPS,
                  })
            }
          >
            {busy === "mp4"
              ? status || "Encoding…"
              : `${live ? "Record" : "Download"} MP4 · ${mp4Size}² · ${mp4Fps}fps`}
          </button>
        </div>
      )}

      {status && !busy && <div className="export-note">{status}</div>}
      {error && <div className="status err">{error}</div>}
    </div>
  );
}

/**
 * `opt-row`/`opt-choices`, the same classes the gallery's export bar uses —
 * they already carry the selected-state rule.
 */
function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly number[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="opt-row">
      <span className="opt-label">{label}</span>
      <div className="opt-choices">
        {options.map((o) => (
          <button key={o} className={o === value ? "on" : ""} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
