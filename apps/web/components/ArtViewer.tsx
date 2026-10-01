"use client";

import { useEffect, useRef, useState } from "react";
import type { Token } from "@cse/core";
import type { Engine } from "@cse/art";
import { ArtCanvas } from "./ArtCanvas";
import { Hud } from "./Hud";

/**
 * The Form, its tooling, and whatever the caller wants underneath.
 *
 * Controls live in a strip below the art rather than floating over it: they are
 * site chrome, not part of the piece, and overlaying them meant hovering to
 * discover they existed at all.
 */
export function ArtViewer({
  token,
  caption,
  children,
  footer,
}: {
  token: Token | null;
  caption?: string;
  /** Rendered under the tooling strip, in both inline and fullscreen views. */
  footer?: (engine: Engine | null) => React.ReactNode;
  /** Rendered beside the art in the fullscreen overlay. */
  children?: React.ReactNode;
}) {
  const [full, setFull] = useState(false);
  const [spin, setSpin] = useState(true);
  const [hud, setHud] = useState(false);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [fullEngine, setFullEngine] = useState<Engine | null>(null);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [full]);

  const tooling = (target: Engine | null) => (
    <div className="tooling">
      <span className="mono-label">Tooling</span>
      <div className="tooling-buttons">
        <button
          className={spin ? "" : "on"}
          onClick={() => setSpin((s) => !s)}
          title={spin ? "Hold the Form still, then drag to turn it" : "Resume rotation"}
        >
          {spin ? "Pause" : "Play"}
        </button>
        <button
          className={hud ? "on" : ""}
          onClick={() => setHud((h) => !h)}
          title="Label which part of the equation builds each feature"
        >
          Readout
        </button>
        <button onClick={() => setFull((f) => !f)} title="Fill the window">
          {full ? "Exit ✕" : "Expand"}
        </button>
      </div>
      {!spin && <span className="tooling-hint">drag to turn</span>}
    </div>
  );

  const stage = (
    isFull: boolean,
    target: Engine | null,
    setTarget: (e: Engine | null) => void,
  ) => (
    <Frame
      engine={target}
      paused={!spin}
      // while the overlay is open the inline stage is still mounted behind it;
      // leaving its readout live means two projection loops for one visible piece
      hud={hud && (isFull || !full)}
      caption={caption}
      className={isFull ? "art-full-stage" : "art-stage"}
    >
      <ArtCanvas token={token} animate={spin} onEngine={setTarget} />
    </Frame>
  );

  return (
    <>
      <div className="art-frame">{stage(false, engine, setEngine)}</div>
      {tooling(engine)}
      {!full && footer?.(engine)}

      {full && (
        <div className="art-full" onClick={() => setFull(false)}>
          <div className="art-full-inner" onClick={(e) => e.stopPropagation()}>
            {stage(true, fullEngine, setFullEngine)}
            <div className="art-full-side">
              {caption && <div className="mono-label">{caption}</div>}
              {children}
              {tooling(fullEngine)}
              {/* the fullscreen canvas has its own engine and WebGL context, so
                  the footer must be handed whichever one is on screen */}
              {footer?.(fullEngine)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Wraps the canvas with the HUD layer and, when paused, drag-to-turn.
 *
 * Dragging is only offered while paused: fighting a running animation for
 * control of the same rotation feels broken rather than interactive.
 */
function Frame({
  engine,
  paused,
  hud,
  caption,
  className,
  children,
}: {
  engine: Engine | null;
  paused: boolean;
  hud: boolean;
  caption?: string;
  className: string;
  children: React.ReactNode;
}) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`${className} ${paused ? "grabbable" : ""} ${dragging ? "grabbing" : ""}`}
      onPointerDown={(e) => {
        if (!paused || !engine) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        last.current = { x: e.clientX, y: e.clientY };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!last.current || !engine) return;
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };
        engine.rotateBy(dx * 0.01, dy * 0.006);
      }}
      onPointerUp={() => {
        last.current = null;
        setDragging(false);
      }}
      onPointerLeave={() => {
        last.current = null;
        setDragging(false);
      }}
    >
      {children}
      <Hud engine={engine} on={hud} />
      {caption && <div className="art-caption">{caption}</div>}
    </div>
  );
}
