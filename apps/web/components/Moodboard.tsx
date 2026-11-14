"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LabEngine } from "@cse/art";
import { AudioDrive } from "@/lib/audio";
import { type Sample, buildBoard, sampleName } from "@/lib/moodboard";
import { useRadio } from "@/lib/radio";
import { LabCanvas } from "./LabCanvas";
import { LabExportBar } from "./LabExportBar";

/**
 * Live WebGL contexts the board may hold at once.
 *
 * Browsers cap a page at around sixteen and silently drop the oldest beyond
 * that, and every Lab engine also steps its feedback field on the CPU each
 * frame. Six is about what a screen shows at once, and leaves room for the
 * modal's engine.
 */
const LIVE_CAP = 6;
const live = new Set<() => void>();
const waiting: (() => void)[] = [];

function acquire(grant: () => void) {
  if (live.has(grant) || waiting.includes(grant)) return;
  if (live.size < LIVE_CAP) {
    live.add(grant);
    grant();
  } else waiting.push(grant);
}

function release(grant: () => void) {
  const i = waiting.indexOf(grant);
  if (i >= 0) waiting.splice(i, 1);
  if (!live.delete(grant)) return;
  const next = waiting.shift();
  if (next) {
    live.add(next);
    next();
  }
}

/**
 * The collection's range on one page, every tile a Form running on the Lab
 * engine with its feedback loop closed, so the surface reacts as it turns.
 * While the site radio plays, the music drives every tile the way it drives
 * the Lab. Tiles only run while on screen, from a small pool of engines.
 */
export function Moodboard() {
  const board = useMemo(buildBoard, []);
  const [open, setOpen] = useState<Sample | null>(null);
  const drive = useRadioDrive();

  const section = (title: string, note: string, samples: Sample[]) => (
    <section className="mood-section">
      <div className="mono-label">{title}</div>
      <p className="mood-note">{note}</p>
      <div className="grid mood-grid">
        {samples.map((s) => (
          <Tile key={s.token.seed} sample={s} drive={drive} onOpen={() => setOpen(s)} />
        ))}
      </div>
    </section>
  );

  return (
    <>
      {section("Structures", "All twenty-two forms, each shown by its liveliest instance.", board.structures)}
      {section(
        "Energy × Feedback",
        "Every pairing of the two behaviour axes, from a still field to a runaway one.",
        board.bands,
      )}
      {section("Palettes", "The nine inks.", board.palettes)}
      {open && <SampleModal sample={open} drive={drive} onClose={() => setOpen(null)} />}
    </>
  );
}

/** The site radio as a live drive whenever it is playing; nothing otherwise. */
function useRadioDrive(): AudioDrive | null {
  const { playing } = useRadio();
  const [drive, setDrive] = useState<AudioDrive | null>(null);

  useEffect(() => {
    if (!playing) return;
    let current: AudioDrive | null = null;
    AudioDrive.open("radio", () => {})
      .then((d) => {
        current = d;
        setDrive(d);
      })
      .catch(() => {});
    return () => {
      current?.close();
      setDrive(null);
    };
  }, [playing]);

  return drive;
}

function Tile({ sample, drive, onOpen }: { sample: Sample; drive: AudioDrive | null; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grant = () => setOn(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) acquire(grant);
        else {
          release(grant);
          setOn(false);
        }
      },
      { rootMargin: "60px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      release(grant);
    };
  }, []);

  return (
    <div className="tile" ref={ref} onClick={onOpen} title="Open · download">
      {on ? <LabCanvas genome={sample.genome} drive={drive?.read ?? null} /> : <div className="mood-hold" />}
      <div className="meta">
        <span>{sample.label}</span>
        <span>{sample.sub}</span>
      </div>
    </div>
  );
}

function SampleModal({
  sample,
  drive,
  onClose,
}: {
  sample: Sample;
  drive: AudioDrive | null;
  onClose: () => void;
}) {
  const t = sample.token;
  const [stage, setStage] = useState<{ engine: LabEngine | null; canvas: HTMLCanvasElement | null }>({
    engine: null,
    canvas: null,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const traits = {
    Structure: t.traits.structure,
    "Root State": t.traits.rootState,
    Symmetry: t.traits.symmetry,
    "Discriminant Class": t.traits.discriminantClass,
    Band: t.traits.discriminantBand,
    Energy: t.traits.energyBand,
    Feedback: t.traits.feedbackBand,
    Phase: `ω${t.traits.phase}`,
    Palette: t.traits.palette.name,
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-stage">
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="panel-head">
            <span>Cubic Symmetry Engine · moodboard · {sample.label}</span>
            <button style={{ border: 0, padding: "2px 6px" }} onClick={onClose}>
              Close ✕
            </button>
          </div>
          <div className="modal-grid">
            <div>
              <LabCanvas
                genome={sample.genome}
                drive={drive?.read ?? null}
                onEngine={(engine, canvas) => setStage({ engine, canvas })}
              />
              <LabExportBar engine={stage.engine} name={sampleName(t)} canvas={stage.canvas} audio={drive} />
            </div>
            <div className="modal-side">
              <div className="mono-label" style={{ marginBottom: 8 }}>
                Traits
              </div>
              {Object.entries(traits).map(([k, v]) => (
                <div className="trait-row" key={k}>
                  <span>{k}</span>
                  <span>{v}</span>
                </div>
              ))}
              <div className="mono-label" style={{ margin: "16px 0 8px" }}>
                Cubic
              </div>
              <div style={{ fontSize: 13 }}>{t.equation}</div>
              <div className="mood-seed">sample · not a minted Form</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
