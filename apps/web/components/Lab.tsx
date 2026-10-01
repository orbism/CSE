"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BASES,
  DEFAULT_GENOME,
  LabEngine,
  MAX_OPS,
  OPS,
  OP_RANGES,
  breed,
  decodeGenome,
  encodeGenome,
  genomeKey,
  randomGenome,
  type BaseName,
  type Genome,
  type OpName,
} from "@cse/art";
import { PALETTES, deriveToken } from "@cse/core";
import { useAccount } from "wagmi";
import { MASTER_SEED } from "../lib/config";
import { ConnectModal } from "./ConnectModal";
import { FormPickerModal } from "./FormPickerModal";
import Link from "next/link";
import { LabExportBar } from "./LabExportBar";
import { DESK_QUERY, LabWindow, useDesk } from "./LabDesk";
import { LabTips } from "./LabTips";
import { RadioSpectrum } from "./RadioSpectrum";
import { getRadio } from "../lib/radio";
import { WordmarkText } from "./Masthead";
import { AudioMeter } from "./AudioMeter";
import { AudioDrive, DEFAULT_TUNING, type AudioSource, type AudioTuning } from "../lib/audio";
import { type Pop, type PopKind, VideoPop, popKind, popWindow } from "../lib/popout";

const MAX_PIXELS = 1400;

/** Heat added per "Get weird" press: twenty to go from cold to fully hot. */
const HEAT_STEP = 0.05;

/**
 * Heat as a colour: the strip's own ink at zero, then blue climbing the
 * spectrum (cyan, green, yellow, orange) to red at 100%.
 */
const heatColor = (t: number) => (t <= 0 ? undefined : `hsl(${Math.round(220 * (1 - t))} 90% 62%)`);

type FullKind = "window" | "screen";
type FsDoc = Document & {
  webkitFullscreenElement?: Element;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
const fsElement = () => document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement;

/** Advanced sound controls, one window per group, stacked under a two-wide Sound. */
const SOUND_SECTIONS: {
  id: string;
  title: string;
  col: number;
  knobs: [keyof AudioTuning, number, number, string?][];
}[] = [
  {
    id: "pulse",
    title: "Pulse",
    col: 0,
    knobs: [
      ["pump", 0, 2],
      ["snap", 0.3, 2, "pulse length, lower is tighter"],
      ["kickHz", 35, 120, "kick band, lower isolates the kick from the bass line"],
      ["squash", 0, 2],
      ["breathe", 0, 2, "swell with the bass level"],
    ],
  },
  {
    id: "motion",
    title: "Motion",
    col: 1,
    knobs: [
      ["spin", 0, 2],
      ["whip", 0, 2, "spin kick per beat"],
      ["wobble", 0, 2, "roll on hi-hats"],
    ],
  },
  {
    id: "surface",
    title: "Surface",
    col: 1,
    knobs: [
      ["feedback", 0, 2],
      ["glitch", 0, 2],
      ["flash", 0, 1, "strobe, photosensitivity warning"],
    ],
  },
];

/**
 * The Lab.
 *
 * Not a preset browser. A form here is the operator chain that made it, so the
 * chain is what the controls edit, what the URL carries, and what breeding
 * recombines. Nothing here can be minted — the collection is fixed at 512 and
 * was uniqueness-checked before the mint opened.
 */
export function Lab() {
  const [genome, setGenome] = useState<Genome>(DEFAULT_GENOME);
  const [engine, setEngine] = useState<LabEngine | null>(null);
  const [spinning, setSpinning] = useState(true);
  const [tray, setTray] = useState<Genome[]>([]);
  const [temperature, setTemperature] = useState(0);
  const [copied, setCopied] = useState(false);
  const [triangles, setTriangles] = useState(0);
  const [audio, setAudio] = useState<{ source: AudioSource; drive: AudioDrive } | null>(null);
  const [audioError, setAudioError] = useState("");
  const [tuning, setTuning] = useState<AudioTuning>(DEFAULT_TUNING);
  const [advanced, setAdvanced] = useState(false);
  /** "window": the desk fills the browser viewport. "screen": true full screen. */
  const [full, setFull] = useState<FullKind | null>(null);
  /** "load yours": connect first if needed, then pick a Form. */
  const [picker, setPicker] = useState<"connect" | "forms" | null>(null);
  const { isConnected } = useAccount();
  const [canTrueFull, setCanTrueFull] = useState(false);
  const [popAvail, setPopAvail] = useState<PopKind | null>(null);
  const [popped, setPopped] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LabEngine | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const audioRef = useRef<AudioDrive | null>(null);
  const measureRef = useRef<() => number>(() => 0);
  const popRef = useRef<Pop | null>(null);
  /** The pop-out window while the canvas lives in it. */
  const popWinRef = useRef<Window | null>(null);
  const videoPopRef = useRef<VideoPop | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const desk = useDesk(deskRef, dockRef, full);

  // ---- engine lifecycle. One WebGL context, created once.
  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const measure = () =>
      Math.max(
        200,
        Math.min(MAX_PIXELS, Math.round(wrap.clientWidth * Math.min(2, window.devicePixelRatio || 1))),
      );
    measureRef.current = measure;

    LabEngine.create({ canvas, size: measure(), fontUrl: "/fonts/JetBrainsMono-Regular.woff2", master: MASTER_SEED })
      .then((e) => {
        if (disposed) {
          e.dispose();
          return;
        }
        engineRef.current = e;
        setEngine(e);
      })
      .catch((err) => console.error("lab engine failed to start", err));

    // While popped out, the pop-out's size rules, not the dock's.
    const observer = new ResizeObserver(() => !popWinRef.current && engineRef.current?.resize(measure()));
    observer.observe(wrap);
    return () => {
      disposed = true;
      observer.disconnect();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // ---- music drives the form live, on top of the genome
  const stopAudio = useCallback(() => {
    engineRef.current?.setDrive(null);
    audioRef.current?.close();
    audioRef.current = null;
    getRadio().setFeed(null);
    setAudio(null);
  }, []);

  const startAudio = async (source: AudioSource) => {
    stopAudio();
    setAudioError("");
    // A mic or a shared tab would hear the site radio too; stop it first.
    if (source !== "radio") getRadio().pause();
    try {
      const drive = await AudioDrive.open(source, stopAudio);
      drive.tuning = tuning;
      audioRef.current = drive;
      // the header spectrum follows whatever the Lab is hearing
      if (source !== "radio") getRadio().setFeed(drive);
      if (popWinRef.current) drive.setFrameWindow(popWinRef.current);
      engineRef.current?.setDrive(drive.read);
      setAudio({ source, drive });
      setSpinning(true);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (audioRef.current) audioRef.current.tuning = tuning;
  }, [tuning]);

  const tune = (key: keyof AudioTuning, min: number, max: number, label: string = key, hint?: string) => (
    <Slider
      key={key}
      label={`${label} ${tuning[key].toFixed(max > 10 ? 0 : 2)}`}
      min={min}
      max={max}
      step={max > 10 ? 1 : 0.01}
      value={tuning[key]}
      onChange={(v) => setTuning((t) => ({ ...t, [key]: v }))}
      hint={hint}
    />
  );

  useEffect(() => stopAudio, [stopAudio]);

  // Advanced reshapes the desk (Sound doubles, its groups stack beneath), so it
  // re-tidies to the layout designed for it.
  const { tidy } = desk;
  useEffect(() => tidy(), [advanced, tidy]);

  // ---- full modes. Both lay the desk over the page; "screen" also asks the
  // browser for real full screen (desktop, iPad), which phones can't do.
  useEffect(() => {
    const d = document as FsDoc;
    setCanTrueFull(!!(d.fullscreenEnabled ?? d.webkitFullscreenEnabled));
  }, []);

  const leaveTrueFull = () => {
    const d = document as FsDoc;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.();
  };

  const exitFull = useCallback(() => {
    setFull(null);
    if (fsElement()) leaveTrueFull();
  }, []);

  const toggleFull = (kind: FullKind) => {
    if (full === kind) return exitFull();
    if (kind === "screen") {
      const el = rootRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
      if (el?.requestFullscreen) el.requestFullscreen().catch(() => setFull("window"));
      else el?.webkitRequestFullscreen?.();
    } else if (fsElement()) leaveTrueFull();
    setFull(kind);
  };

  useEffect(() => {
    if (!full) return;
    let entered = false;
    const onChange = () => {
      if (fsElement()) entered = true;
      else if (entered && full === "screen") setFull(null); // left via Esc or browser chrome
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && full === "window" && exitFull();
    // Full modes only exist on the desk; shrinking below it leaves.
    const mq = window.matchMedia(DESK_QUERY);
    const onMq = () => !mq.matches && exitFull();
    mq.addEventListener("change", onMq);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
      document.body.style.overflow = "";
    };
  }, [full, exitFull]);

  // ---- pop-out: the visualizer in an always-on-top window (see lib/popout)
  useEffect(() => setPopAvail(popKind()), []);

  // Safari's path needs its video already playing when the click comes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (popAvail !== "video" || !engine || !canvas) return;
    const v = new VideoPop(canvas, () => {
      popRef.current = null;
      setPopped(false);
    });
    videoPopRef.current = v;
    return () => {
      v.dispose();
      videoPopRef.current = null;
    };
  }, [popAvail, engine]);

  useEffect(() => () => popRef.current?.close(), []);

  const togglePop = async () => {
    const canvas = canvasRef.current;
    const e = engineRef.current;
    if (!canvas || !e) return;
    if (popRef.current) return popRef.current.close();
    try {
      if (popAvail === "window") {
        popRef.current = await popWindow(canvas, {
          onOpen: (win) => {
            popWinRef.current = win;
            e.setFrameWindow(win);
            audioRef.current?.setFrameWindow(win);
          },
          onResize: (px) => {
            e.resize(Math.max(200, Math.min(MAX_PIXELS, px)));
            e.redraw();
          },
          onDrag: (dx, dy) => e.rotateBy(dx, dy),
          onClose: () => {
            popRef.current = null;
            popWinRef.current = null;
            e.setFrameWindow(null);
            audioRef.current?.setFrameWindow(null);
            e.resize(measureRef.current());
            e.redraw();
            setPopped(false);
          },
        });
      } else if (videoPopRef.current) {
        await videoPopRef.current.open();
        popRef.current = videoPopRef.current;
      } else return;
      setPopped(true);
    } catch (err) {
      console.warn("pop-out refused", err);
    }
  };

  // ---- rebuild whenever the genome changes
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.load(genome);
    setTriangles(e.triangles);
    if (spinning) e.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genome, engine]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (spinning) e.start();
    else e.stop();
  }, [spinning]);

  // ---- a genotype in the URL is the share mechanism
  useEffect(() => {
    const hash = window.location.hash.replace(/^#g=/, "");
    if (!hash) return;
    const g = decodeGenome(decodeURIComponent(hash));
    if (g) setGenome(g);
  }, []);

  const apply = useCallback((g: Genome) => {
    seenRef.current.add(genomeKey(g));
    setGenome(g);
    window.history.replaceState(null, "", `#g=${encodeURIComponent(encodeGenome(g))}`);
  }, []);

  /**
   * Escalating, not merely random. Each consecutive press raises the
   * temperature — longer chains, wilder operators, parameters pushed to their
   * limits — so holding it down travels somewhere rather than resampling the
   * same neighbourhood. Anything already served this session is rerolled.
   * Twenty presses from cold to fully hot.
   */
  const getWeird = useCallback(() => {
    const t = Math.min(1, temperature + HEAT_STEP);
    setTemperature(t);
    for (let attempt = 0; attempt < 24; attempt++) {
      const g = randomGenome(`${Date.now()}-${attempt}-${Math.random()}`, t);
      if (!seenRef.current.has(genomeKey(g))) {
        apply(g);
        return;
      }
    }
    apply(randomGenome(`${Date.now()}-fallback`, t));
  }, [temperature, apply]);

  const patch = (fn: (g: Genome) => Genome) => apply(fn(structuredClone(genome)));

  /**
   * A collection Form becomes the chain's starting shape, in its own palette
   * and glyph density, with an empty chain to build on.
   */
  const loadForm = (form: { id: number; nonce: number }) => {
    const token = deriveToken(MASTER_SEED, form.id, form.nonce);
    // a fresh starting shape starts cold
    setTemperature(0);
    apply({
      ...genome,
      form,
      ops: [],
      render: {
        ...genome.render,
        palette: token.traits.palette.name,
        rows: Math.max(24, Math.min(240, token.drivers.density)),
      },
    });
  };

  return (
    <div ref={rootRef} className={`lab${full ? " lab-full" : ""}`}>
      <div className="lab-bar">
        {full && (
          <Link href="/" className="wordmark lab-bar-mark" onClick={exitFull}>
            <WordmarkText />
          </Link>
        )}
        {full && <span className="lab-bar-title">Lab</span>}
        {full && <RadioSpectrum className="lab-bar-spectrum" />}
        <LabTips />
        <div className="lab-bar-tools">
          <button onClick={desk.tidy} title="Snap everything to a clean grid; sizes are kept">
            tidy
          </button>
          <button className="lab-dice" onClick={desk.roll} title="Roll a random layout" aria-label="Random layout">
            ⚄
          </button>
          <button
            className={full === "window" ? "on" : ""}
            onClick={() => toggleFull("window")}
            title="Fill the browser window with the desk"
          >
            {full === "window" ? "exit full window" : "full window"}
          </button>
          {canTrueFull && (
            <button
              className={full === "screen" ? "on" : ""}
              onClick={() => toggleFull("screen")}
              title="True full screen"
            >
              {full === "screen" ? "exit full screen" : "full screen"}
            </button>
          )}
        </div>
      </div>

      <div
        ref={deskRef}
        className="lab-desk"
        style={{ "--content": `${desk.bottom}px` } as React.CSSProperties}
      >
        {/* Docked, never floating: the form and its genotype stay top left. */}
        <div ref={dockRef} className="lab-dock">
          <div
            ref={wrapRef}
            className="lab-canvas"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, y: e.clientY };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              engineRef.current?.rotateBy((e.clientX - d.x) * 0.01, (e.clientY - d.y) * 0.01);
              dragRef.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
          >
            {/* The canvas's own slot: it can leave for the pop-out and come
                back without React ever reconciling around it. */}
            <div className="lab-canvas-slot">
              <canvas ref={canvasRef} />
            </div>
            <div className="lab-canvas-info" aria-live="off">
              {genome.form && <>loaded CSE #{String(genome.form.id).padStart(4, "0")} · </>}
              drag to turn · {triangles.toLocaleString()} triangles · heat{" "}
              <span style={{ color: heatColor(temperature) }}>{Math.round(temperature * 100)}%</span>
            </div>
            {popped && popAvail === "window" && (
              <button className="lab-popped" onPointerDown={(ev) => ev.stopPropagation()} onClick={togglePop}>
                ⧉ popped out · click to bring it back
              </button>
            )}
            {popAvail && !(popped && popAvail === "window") && (
              <button
                className={`lab-popout${popped ? " on" : ""}`}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={togglePop}
                title={popped ? "Bring the visualizer back" : "Pop out: an always-on-top window you can park anywhere"}
                aria-label="Pop out visualizer"
              >
                ⧉
              </button>
            )}
          </div>

          <div className="tooling">
            <div className="tooling-buttons">
              <button className={spinning ? "" : "on"} onClick={() => setSpinning((s) => !s)}>
                {spinning ? "Pause" : "Play"}
              </button>
              <button
                className="primary"
                onClick={getWeird}
                title="Each press goes further out than the last"
              >
                Get weird ⚡
              </button>
              <button
                onClick={() => {
                  setTray((t) => [genome, ...t].slice(0, 4));
                }}
                title="Keep this one to breed with"
              >
                Keep
              </button>
              <button
                disabled={tray.length < 1}
                onClick={() => apply(breed(genome, tray[0], `${Date.now()}`))}
                title="Splice this chain with the last one you kept"
              >
                Breed
              </button>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
              <button
                className="lab-load"
                onClick={() => setPicker(isConnected ? "forms" : "connect")}
                title="Load a CSE Form from your wallet as the starting shape"
              >
                {isConnected ? "Load yours" : "Connect wallet"}
              </button>
            </div>
          </div>

          <div className="lab-dock-genotype">
            <div className="mono-label">Genotype</div>
            <textarea
              className="lab-genotype"
              spellCheck={false}
              value={encodeGenome(genome)}
              onChange={(e) => {
                const g = decodeGenome(e.target.value.trim());
                if (g) apply(g);
              }}
            />
          </div>
        </div>

        <LabWindow id="sound" title="Sound" desk={desk} span={advanced ? 2 : 1} col={0}>
          <div className="lab-chips lab-sound-src">
            <button className={audio ? "" : "on"} onClick={stopAudio}>
              off
            </button>
            <button
              className={audio?.source === "share" ? "on" : ""}
              onClick={() => startAudio("share")}
              title="Share a tab (or the whole screen) and tick “Share audio”"
            >
              tab / system
            </button>
            <button
              className={audio?.source === "input" ? "on" : ""}
              onClick={() => startAudio("input")}
              title="Mic, or a loopback device like BlackHole carrying system audio"
            >
              mic / line-in
            </button>
            <button
              className={audio?.source === "radio" ? "on" : ""}
              onClick={() => startAudio("radio")}
              title="CSE Radio, the player at the bottom of the page, straight in"
            >
              CSE Radio
            </button>
            <button
              className={`lab-advanced${advanced ? " on" : ""}`}
              onClick={() => setAdvanced((a) => !a)}
              title="Per-effect controls"
            >
              advanced
            </button>
          </div>
          <AudioMeter drive={audio?.drive ?? null} advanced={advanced} />
          {tune(
            "sensitivity",
            0,
            2,
            "sensitivity",
            audioError || "kick → pump · mids → feedback · highs → spin · hats → wobble + glitch",
          )}
          {advanced && (
            <button className="lab-sub-reset" onClick={() => setTuning(DEFAULT_TUNING)}>
              reset sound
            </button>
          )}
        </LabWindow>

        {/* Advanced breaks out into a window per group, beside a wider Sound. */}
        {advanced &&
          SOUND_SECTIONS.map((sec) => (
            <LabWindow
              key={sec.id}
              id={`sound-${sec.id}`}
              title={`Sound · ${sec.title}`}
              desk={desk}
              col={sec.col}
            >
              {sec.knobs.map(([k, lo, hi, hint]) => tune(k, lo, hi, k, hint))}
            </LabWindow>
          ))}

        <LabWindow id="presets" title="Base · palette" desk={desk} col={advanced ? 2 : 0}>
          <div className="mono-label">Base</div>
          {genome.form && (
            <p className="lab-hint">
              Starting from CSE #{String(genome.form.id).padStart(4, "0")}. Pick a base to drop it.
            </p>
          )}
          <div className="lab-chips">
            {BASES.map((b) => (
              <button
                key={b}
                className={genome.base === b && !genome.form ? "on" : ""}
                onClick={() => patch((g) => ({ ...g, base: b as BaseName, form: undefined }))}
              >
                {b}
              </button>
            ))}
          </div>
          <div className="mono-label" style={{ marginTop: 12 }}>
            Palette
          </div>
          <div className="lab-chips">
            {PALETTES.map((p) => (
              <button
                key={p.name}
                className={genome.render.palette === p.name ? "on" : ""}
                onClick={() => patch((g) => ({ ...g, render: { ...g.render, palette: p.name } }))}
              >
                {p.name}
              </button>
            ))}
          </div>
        </LabWindow>

        <LabWindow id="field" title="Field" desk={desk}>
          <Slider
            label={`degree ${genome.field.degree}`}
            min={3}
            max={5}
            step={1}
            value={genome.field.degree}
            onChange={(v) => patch((g) => ({ ...g, field: { ...g.field, degree: v as 3 | 4 | 5 } }))}
            hint="4 and 5 roots are outside the collection's cubic vocabulary"
          />
          <Slider
            label={`energy ${genome.field.energy.toFixed(2)}`}
            min={0}
            max={1}
            step={0.01}
            value={genome.field.energy}
            onChange={(v) => patch((g) => ({ ...g, field: { ...g.field, energy: v } }))}
          />
          <Slider
            label={`curvature ${genome.field.curvature.toFixed(2)}`}
            min={0}
            max={1}
            step={0.01}
            value={genome.field.curvature}
            onChange={(v) => patch((g) => ({ ...g, field: { ...g.field, curvature: v } }))}
          />
        </LabWindow>

        <LabWindow id="render" title="Render" desk={desk}>
          <Slider
            label={`rows ${genome.render.rows}`}
            min={24}
            max={240}
            step={1}
            value={genome.render.rows}
            onChange={(v) => patch((g) => ({ ...g, render: { ...g.render, rows: v } }))}
          />
          <Slider
            label={`spin ${genome.render.spin.toFixed(2)}`}
            min={-0.6}
            max={0.6}
            step={0.01}
            value={genome.render.spin}
            onChange={(v) => patch((g) => ({ ...g, render: { ...g.render, spin: v } }))}
          />
          <Slider
            label={`feedback ${genome.render.feedback.toFixed(2)}`}
            min={0}
            max={1}
            step={0.01}
            value={genome.render.feedback}
            onChange={(v) => patch((g) => ({ ...g, render: { ...g.render, feedback: v } }))}
            hint="the glyph grid displaces the geometry it just drew"
          />
        </LabWindow>

        <LabWindow id="chain" title={`Operator chain ${genome.ops.length}/${MAX_OPS}`} desk={desk} col={advanced ? 3 : 1}>
          {genome.ops.map((op, i) => (
            <div className="lab-op" key={`${op.op}-${i}`}>
              <div className="lab-op-head">
                <select
                  value={op.op}
                  onChange={(e) =>
                    patch((g) => {
                      const name = e.target.value as OpName;
                      g.ops[i] = {
                        op: name,
                        args: OP_RANGES[name].map(([lo, hi]) => (lo + hi) / 2),
                      };
                      return g;
                    })
                  }
                >
                  {OPS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
                <button
                  title="Remove"
                  onClick={() =>
                    patch((g) => {
                      g.ops.splice(i, 1);
                      return g;
                    })
                  }
                >
                  ✕
                </button>
              </div>
              {OP_RANGES[op.op].map(([lo, hi], k) => (
                <input
                  key={k}
                  type="range"
                  min={lo}
                  max={hi}
                  step={(hi - lo) / 100}
                  value={op.args[k] ?? lo}
                  onChange={(e) =>
                    patch((g) => {
                      g.ops[i].args[k] = Number(e.target.value);
                      return g;
                    })
                  }
                />
              ))}
            </div>
          ))}
          <button
            disabled={genome.ops.length >= MAX_OPS}
            onClick={() =>
              patch((g) => {
                g.ops.push({ op: "warp", args: [0.6] });
                return g;
              })
            }
          >
            + operator
          </button>
        </LabWindow>

        <LabWindow id="kept" title={`Kept ${tray.length}/4`} desk={desk}>
          {tray.length === 0 ? (
            <span className="lab-hint">Keep a form to breed with it.</span>
          ) : (
            <div className="lab-chips">
              {tray.map((g, i) => (
                <button key={genomeKey(g) + i} onClick={() => apply(g)} title={encodeGenome(g)}>
                  {genomeKey(g).slice(0, 6)}
                </button>
              ))}
            </div>
          )}
        </LabWindow>

        <LabWindow id="export" title="Export" desk={desk} col={advanced ? 2 : 0}>
          <LabExportBar engine={engine} name={`cse-lab-${genomeKey(genome)}`} />
        </LabWindow>
      </div>
      {/* connecting from "load yours" carries straight on to the picker */}
      <ConnectModal
        open={picker === "connect"}
        onClose={() => setPicker(null)}
        onConnected={() => setPicker("forms")}
        container={rootRef.current}
      />
      <FormPickerModal
        open={picker === "forms"}
        onClose={() => setPicker(null)}
        onLoad={loadForm}
        container={rootRef.current}
      />
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  hint,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="lab-slider">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="lab-hint">{hint}</span>}
    </div>
  );
}
