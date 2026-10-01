"use client";

import { STATIONS, getRadio, useRadio } from "../lib/radio";
import { VolumeGlyph } from "./VolumeGlyph";

/**
 * The site radio, as a thin strip pinned to the bottom of every page: station
 * arrows, play, what's on, volume. Always opens on DNBRADIO and never plays
 * until asked.
 */
export function RadioStrip() {
  const s = useRadio();
  const station = STATIONS[s.station];
  const busy = s.playing || s.loading;
  const what = s.error || s.title || (busy ? "tuning in…" : "press play");
  const text = `${station.name} · ${what}`;
  // station in the accent, what's on in the main ink, so both read on any scheme
  const line = (
    <>
      <b>{station.name}</b> · {what}
    </>
  );

  return (
    <div className="radio" role="region" aria-label="Site radio">
      <button aria-label="Previous station" title="Previous station" onClick={() => getRadio().step(-1)}>
        ‹
      </button>
      <button
        className={`radio-play${busy ? " on" : ""}`}
        aria-label={busy ? "Pause" : "Play"}
        onClick={() => getRadio().toggle()}
      >
        {s.loading ? "…" : s.playing ? "❚❚" : "▶"}
      </button>
      <button aria-label="Next station" title="Next station" onClick={() => getRadio().step(1)}>
        ›
      </button>
      {/* Two copies scroll as one, so the loop has no seam. */}
      <div className="radio-marquee" title={text}>
        <div className="radio-track" style={{ animationDuration: `${Math.max(14, text.length * 0.32)}s` }}>
          <span>{line}</span>
          <span aria-hidden>{line}</span>
        </div>
      </div>
      <VolumeGlyph />
      <input
        className="radio-volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={s.volume}
        aria-label="Volume"
        onChange={(e) => getRadio().setVolume(Number(e.target.value))}
      />
    </div>
  );
}
