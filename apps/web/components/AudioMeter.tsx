"use client";

import { useEffect, useRef } from "react";
import type { LabDrive } from "@cse/art";
import { type AudioDrive, PeakHold, logBar } from "../lib/audio";

/** Output meters in advanced view, with the rough value each reads full at. */
const OUTPUTS: [keyof LabDrive, string, number][] = [
  ["pulse", "pump", 0.2],
  ["squash", "squash", 0.12],
  ["feedback", "fdbk", 1],
  ["spin", "spin", 4],
  ["roll", "roll", 0.15],
  ["glitch", "glitch", 1],
  ["flash", "flash", 1],
];

/**
 * Live spectrum. Log-spaced bars like a hardware EQ, the beat spring as a wash
 * behind them, peak caps that hang and then fall, BPM once the tracker has
 * locked. Advanced adds a row showing what each output is sending to the form.
 */
export function AudioMeter({ drive, advanced }: { drive: AudioDrive | null; advanced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Live declaration: re-read per frame so a scheme change shows immediately.
    const css = getComputedStyle(canvas);
    const bars = advanced ? 48 : 20;
    const peaks = new PeakHold(bars);
    let raf = 0;

    const draw = () => {
      const accent = css.getPropertyValue("--accent").trim();
      const dim = css.getPropertyValue("--ink-dim").trim();
      const mid = css.getPropertyValue("--accent-2").trim();
      const high = css.getPropertyValue("--accent-3").trim();
      const line = css.getPropertyValue("--line").trim();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const specH = advanced ? h * 0.62 : h;

      if (drive && drive.beat > 0) {
        ctx.globalAlpha = drive.beat * 0.18;
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, w, specH);
        ctx.globalAlpha = 1;
      }

      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = drive ? logBar(drive.bins, drive.binHz, i, bars) : 0;
        const bh = Math.max(dpr, v * specH);
        ctx.fillStyle = i / bars < 0.35 ? accent : i / bars < 0.7 ? mid : high;
        ctx.fillRect(i * bw + dpr, specH - bh, bw - dpr * 2, bh);
        const peak = peaks.update(i, v);
        if (peak > 0.02) {
          ctx.fillStyle = css.getPropertyValue("--ink-bright").trim();
          ctx.fillRect(i * bw + dpr, specH - peak * specH - dpr * 2, bw - dpr * 2, dpr * 2);
        }
      }

      ctx.font = `${10 * dpr}px monospace`;
      ctx.textBaseline = "top";
      ctx.fillStyle = dim;
      ctx.textAlign = "right";
      ctx.fillText(drive ? (drive.bpm ? `${drive.bpm} BPM` : "listening…") : "no input", w - 4 * dpr, 3 * dpr);

      if (advanced) {
        const top = specH + 6 * dpr;
        const ow = w / OUTPUTS.length;
        const oh = h - top - 14 * dpr;
        ctx.textAlign = "center";
        OUTPUTS.forEach(([key, label, full], i) => {
          const v = drive ? Math.min(1, Math.abs(drive.out[key]) / full) : 0;
          const x = i * ow + ow * 0.2;
          ctx.fillStyle = line;
          ctx.fillRect(x, top, ow * 0.6, oh);
          ctx.fillStyle = accent;
          ctx.fillRect(x, top + oh * (1 - v), ow * 0.6, oh * v);
          ctx.fillStyle = dim;
          ctx.fillText(label, i * ow + ow / 2, top + oh + 3 * dpr);
        });
      }

      if (drive) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [drive, advanced]);

  return <canvas ref={ref} className={`audio-meter${advanced ? " advanced" : ""}`} />;
}
