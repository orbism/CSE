"use client";

import { useEffect, useRef } from "react";
import { PeakHold, logBar } from "../lib/audio";
import { getRadio, useRadio } from "../lib/radio";

/** CSS px per bar, gap included. */
const PITCH = 5;

/**
 * Bars growing up from the element's bottom edge, with peak caps that hang
 * and then drift down.
 *
 * Shows the Lab's input when the Lab has one (mic or shared tab), otherwise the
 * site radio. The radio's fade in and out comes through the analyser, so the
 * bars rise and sink with it; once everything has settled the loop stops, so an
 * idle page costs nothing.
 *
 * Music carries far more energy low than high, so raw bars sit pinned at the
 * bottom end through any bassline. A tilt makes the lowest bars clear a floor
 * before they register and caps their reach, rising to untouched at the top.
 */
export function RadioSpectrum({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { playing, fed } = useRadio();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(canvas);
    const radio = getRadio();
    let levels = new Float32Array(0);
    let peaks = new PeakHold(0);
    let own: Uint8Array<ArrayBuffer> | null = null;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const count = Math.max(4, Math.floor(canvas.clientWidth / PITCH));
      if (levels.length !== count) {
        levels = new Float32Array(count);
        peaks = new PeakHold(count);
      }

      // whichever input is live: the Lab's, else the radio's (fading or not)
      let bins: Uint8Array | null = null;
      let hz = 1;
      if (radio.feed) {
        bins = radio.feed.bins;
        hz = radio.feed.binHz;
      } else if (radio.analyser) {
        const an = radio.analyser;
        if (!own || own.length !== an.frequencyBinCount) own = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(own);
        bins = own;
        hz = an.context.sampleRate / an.fftSize;
      }

      // re-read per frame so a scheme change shows immediately; lows, mids, highs
      const colors = ["--accent", "--accent-2", "--accent-3"].map((v) => css.getPropertyValue(v).trim());
      const cap = css.getPropertyValue("--ink-bright").trim();
      ctx.clearRect(0, 0, w, h);
      const bw = w / count;
      let alive = playing || fed;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const tilt = 0.42 * Math.pow(1 - t, 1.6);
        const raw = bins ? logBar(bins, hz, i, count) : 0;
        const target = (Math.max(0, raw - tilt) / (1 - tilt)) * (0.82 + 0.18 * t);
        // fast up, slower down: reads as a meter, not a strobe
        levels[i] += (target - levels[i]) * (target > levels[i] ? 0.6 : 0.18);
        const peak = peaks.update(i, levels[i]);
        if (levels[i] > 0.004 || peak > 0.004) alive = true;

        const x = i * bw;
        const bh = levels[i] * h;
        ctx.fillStyle = colors[t < 0.35 ? 0 : t < 0.7 ? 1 : 2];
        if (bh > 0.5) ctx.fillRect(x, h - bh, bw - dpr, bh);
        if (peak > 0.02) {
          ctx.fillStyle = cap;
          ctx.fillRect(x, h - peak * h - dpr, bw - dpr, dpr);
        }
      }
      raf = alive ? requestAnimationFrame(draw) : 0;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing, fed]);

  return <canvas ref={ref} className={`radio-spectrum ${playing || fed ? "on" : ""} ${className}`} aria-hidden />;
}
