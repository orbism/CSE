"use client";

import { useEffect, useRef } from "react";
import type { Token } from "@cse/core";
import { Engine } from "@cse/art";

/** Above this the glyph pass costs more than the extra sharpness is worth. */
const MAX_PIXELS = 1600;

/**
 * Runs the same renderer the pinned bundle uses, so what the demo box shows is
 * exactly what a minted token would be — not an approximation of it.
 *
 * The canvas resolution follows its container rather than being fixed, so the
 * piece stays crisp at any size: the glyph grid is re-rasterised at the new
 * pixel size on every resize, it is not a bitmap being stretched.
 */
export function ArtCanvas({
  token,
  animate = true,
  onEngine,
}: {
  token: Token | null;
  animate?: boolean;
  /** Handed the live engine so callers can export frames from it. */
  onEngine?: (engine: Engine | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const pendingRef = useRef<Token | null>(token);
  const sizeRef = useRef(0);

  // Create once. WebGL context creation is expensive and browsers cap how many
  // live contexts a page may hold, so this must not run per token.
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

    Engine.create({
      canvas,
      size: measure(),
      fontUrl: "/fonts/JetBrainsMono-Regular.woff2",
    })
      .then((engine) => {
        if (disposed) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        sizeRef.current = measure();
        onEngine?.(engine);
        const initial = pendingRef.current;
        if (initial) {
          engine.load(initial);
          if (animate) engine.start();
        }
      })
      .catch((e) => console.error("art engine failed to start", e));

    const observer = new ResizeObserver(() => {
      const engine = engineRef.current;
      if (!engine) return;
      const next = measure();
      // ignore sub-pixel jitter; every resize re-renders the whole glyph grid
      if (Math.abs(next - sizeRef.current) < 24) return;
      sizeRef.current = next;
      engine.resize(next);
    });
    observer.observe(wrap);

    return () => {
      disposed = true;
      observer.disconnect();
      engineRef.current?.dispose();
      engineRef.current = null;
      onEngine?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load only when the token changes. Reloading on an `animate` flip rebuilt
  // the piece and redrew frame 0, so pausing snapped the Form back to its
  // starting rotation.
  useEffect(() => {
    pendingRef.current = token;
    const engine = engineRef.current;
    if (!engine || !token) return;
    engine.load(token);
    if (animate) engine.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (animate) engine.start();
    else engine.stop();
  }, [animate]);

  return (
    <div ref={wrapRef} style={{ width: "100%", aspectRatio: "1", background: "#000" }}>
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%", background: "#000" }}
      />
    </div>
  );
}
