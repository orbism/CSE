"use client";

import { useEffect, useRef, useState } from "react";
import { type Callout, type Engine, layoutCallouts } from "@cse/art";



/**
 * Annotation overlay: which part of the equation is doing the work, pinned to
 * the geometry doing it.
 *
 * Callouts are placed radially on a ring around the piece rather than beside
 * each point. Placing them next to the anchor and then shoving them apart on
 * collision made the labels move for reasons unrelated to the geometry, which
 * read as drifting; on a ring, a label only moves when its anchor sweeps round,
 * and every leader line points back at the centre.
 */
export function Hud({ engine, on }: { engine: Engine | null; on: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Callout[]>([]);
  const [size, setSize] = useState(0);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (!engine || !on) {
      setPlaced([]);
      return;
    }
    let raf = 0;
    const tick = () => {
      const wrap = wrapRef.current;
      if (wrap) {
        const size = wrap.clientWidth;
        // same layout the canvas renderer uses for exports, so a download
        // matches what was on screen when it was asked for
        const { callouts, compact: isCompact } = layoutCallouts(
          engine.projectAnchors(size),
          size,
        );
        setSize(size);
        setCompact(isCompact);
        setPlaced(callouts);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, on]);

  if (!on) return <div ref={wrapRef} className="hud" aria-hidden />;

  return (
    <div ref={wrapRef} className="hud on">
      <svg className="hud-lines" aria-hidden>
        {placed.map((a, i) => (
          <g key={i} opacity={a.opacity}>
            <circle cx={a.x} cy={a.y} r={3} className="hud-dot" />
            <circle cx={a.x} cy={a.y} r={7} className="hud-ring" />
            {/* dot -> elbow -> label, so the leader always points inward */}
            <polyline
              points={`${a.x},${a.y} ${a.ex},${a.ey} ${a.lx},${a.ly}`}
              className="hud-line"
              fill="none"
            />
          </g>
        ))}
      </svg>

      {placed.map((a, i) => (
        <div
          key={i}
          className={`hud-label term-${a.term} ${compact ? "compact" : ""}`}
          // Anchored to whichever edge it grows away from, with the remaining
          // space as its max-width. Containment is then the browser's problem,
          // not an estimate that breaks whenever the text wraps differently.
          style={
            a.side < 0
              ? {
                  right: size - a.lx,
                  top: a.ly,
                  maxWidth: Math.max(60, a.lx - 8),
                  opacity: a.opacity,
                  transform: "translateY(-50%)",
                  textAlign: "right",
                  alignItems: "flex-end",
                }
              : {
                  left: a.lx,
                  top: a.ly,
                  maxWidth: Math.max(60, size - a.lx - 8),
                  opacity: a.opacity,
                  transform: "translateY(-50%)",
                  textAlign: "left",
                  alignItems: "flex-start",
                }
          }
          title={a.detail}
        >
          <span className="hud-tag">{a.label}</span>
          {!compact && <span className="hud-detail">{a.detail}</span>}
        </div>
      ))}
    </div>
  );
}
