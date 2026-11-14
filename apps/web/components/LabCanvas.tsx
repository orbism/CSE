"use client";

import { useEffect, useRef } from "react";
import { type Genome, type LabDrive, LabEngine } from "@cse/art";

const MAX_PIXELS = 1600;

/**
 * A Lab engine on a canvas that follows its container, as `ArtCanvas` does
 * for the collection renderer. One WebGL context per mount; the genome and
 * the live drive can change without rebuilding it.
 */
export function LabCanvas({
  genome,
  drive = null,
  onEngine,
}: {
  genome: Genome;
  /** Per-frame modulation (the radio), or null for the genome alone. */
  drive?: (() => LabDrive) | null;
  /** The engine and its canvas, for exports; null again on unmount. */
  onEngine?: (engine: LabEngine | null, canvas: HTMLCanvasElement | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LabEngine | null>(null);
  const genomeRef = useRef(genome);
  const driveRef = useRef(drive);

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

    LabEngine.create({ canvas, size: measure(), fontUrl: "/fonts/JetBrainsMono-Regular.woff2" })
      .then((engine) => {
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        engine.load(genomeRef.current);
        engine.setDrive(driveRef.current);
        engine.start();
        onEngine?.(engine, canvas);
      })
      .catch((e) => console.error("lab engine failed to start", e));

    const observer = new ResizeObserver(() => engineRef.current?.resize(measure()));
    observer.observe(wrap);

    return () => {
      disposed = true;
      observer.disconnect();
      engineRef.current?.dispose();
      engineRef.current = null;
      onEngine?.(null, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    genomeRef.current = genome;
    engineRef.current?.load(genome);
  }, [genome]);

  useEffect(() => {
    driveRef.current = drive;
    engineRef.current?.setDrive(drive);
  }, [drive]);

  return (
    <div ref={wrapRef} style={{ width: "100%", aspectRatio: "1", background: "#000" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", background: "#000" }} />
    </div>
  );
}
