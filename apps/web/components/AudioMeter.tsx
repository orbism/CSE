"use client";

import { useEffect, useRef } from "react";
import type { LabDrive } from "@cse/art";
import type { AudioDrive } from "../lib/audio";

const LO_HZ = 30;
const HI_HZ = 16000;

/** Output meters in advanced view, with the rough value each reads full at. */
const OUTPUTS: [keyof LabDrive, string, number][] = [
  ["pulse", "pump", 0.3],
  ["squash", "squash", 0.12],
  ["feedback", "fdbk", 1],
  ["spin", "spin", 4],
  ["roll", "roll", 0.15],
  ["glitch", "glitch", 1],
  ["flash", "flash", 1],
];

/**
 * Live spectrum. Log-spaced bars like a hardware EQ, the beat spring as a wash
 * behind them, BPM once the tracker has locked. Advanced adds peak caps and a
 * row showing what each output is actually sending to the form.
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
    const peaks = new Float32Array(bars);
    let raf = 0;

    const draw = () => {
      const accent = css.getPropertyValue("--accent").trim();
      const dim = css.getPropertyValue("--ink-dim").trim();
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
        let v = 0;
        if (drive) {
          const f0 = LO_HZ * Math.pow(HI_HZ / LO_HZ, i / bars);
          const f1 = LO_HZ * Math.pow(HI_HZ / LO_HZ, (i + 1) / bars);
          const b0 = Math.max(1, Math.floor(f0 / drive.binHz));
          const b1 = Math.max(b0, Math.min(drive.bins.length - 1, Math.floor(f1 / drive.binHz)));
          for (let b = b0; b <= b1; b++) v = Math.max(v, drive.bins[b]);
          v /= 255;
        }
        const bh = Math.max(dpr, v * specH);
        ctx.fillStyle = i / bars < 0.35 ? accent : dim;
        ctx.fillRect(i * bw + dpr, specH - bh, bw - dpr * 2, bh);
        if (advanced) {
          peaks[i] = Math.max(v, peaks[i] - 0.012);
          ctx.fillStyle = accent;
          ctx.fillRect(i * bw + dpr, specH - peaks[i] * specH - dpr * 2, bw - dpr * 2, dpr * 2);
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
