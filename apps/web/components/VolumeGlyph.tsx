"use client";

import { useEffect, useRef } from "react";
import { getRadio, useRadio } from "../lib/radio";

/**
 * The volume icon: a solid cone and three sound waves. Volume decides how many
 * waves light; while the radio plays they pulse with the music. Muted, the
 * waves go out and a × takes their place. Click to mute.
 */
export function VolumeGlyph() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { volume, playing } = useRadio();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(canvas);
    const radio = getRadio();
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = 30,
        H = 20;
      if (canvas.width !== W * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // how loud the music is right now, 0..1
      let music = 0;
      const an = radio.analyser;
      if (playing && an) {
        if (!bins || bins.length !== an.frequencyBinCount) bins = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 2; i < 64; i++) sum += bins[i];
        music = sum / (62 * 255);
      }

      const ink = css.getPropertyValue(playing ? "--accent" : "--ink-dim").trim();
      ctx.fillStyle = ink;
      // cone: magnet block plus the flare
      ctx.fillRect(2, 7.5, 4, 5);
      ctx.beginPath();
      ctx.moveTo(6, 7.5);
      ctx.lineTo(11, 3);
      ctx.lineTo(11, 17);
      ctx.lineTo(6, 12.5);
      ctx.fill();

      if (volume === 0) {
        ctx.fillStyle = css.getPropertyValue("--ink-faint").trim();
        ctx.font = `11px ${css.getPropertyValue("--body")}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("×", 19, 10);
      } else {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        for (let k = 0; k < 3; k++) {
          const lit = Math.max(0, Math.min(1, volume * 3 - k));
          if (!lit) continue;
          // each wave a little brighter with the music, never fully out
          ctx.globalAlpha = lit * (playing ? Math.min(1, 0.45 + music * 1.4 - k * 0.12) : 0.8);
          ctx.beginPath();
          ctx.arc(10, 10, 5 + k * 4.5, -0.7, 0.7);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      raf = playing ? requestAnimationFrame(draw) : 0;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [volume, playing]);

  return (
    <button
      className="radio-mute"
      aria-label={volume === 0 ? "Unmute" : "Mute"}
      aria-pressed={volume === 0}
      title={volume === 0 ? "Unmute" : "Mute"}
      onClick={() => getRadio().toggleMute()}
    >
      <canvas ref={ref} style={{ width: 30, height: 20 }} aria-hidden />
    </button>
  );
}
