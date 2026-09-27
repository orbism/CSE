"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type Branch, type Cubic, cx, fromRoots, tokenFromCubic } from "@cse/core";
import { ArtCanvas } from "./ArtCanvas";

/**
 * A live figure for one section of the maths page.
 *
 * Three Forms side by side, all driven by the same sliders, so what moves as you
 * drag is the *same* change applied to three different solutions — which is the
 * only honest way to show that a parameter does one thing rather than three.
 *
 * They run the real pipeline. `tokenFromCubic` hands the coefficients straight
 * to `solve`, `deriveTraits` and `deriveDrivers`, so these are not illustrations
 * of the renderer, they are the renderer.
 *
 * ## Why the viewport gate
 *
 * Each canvas owns a WebGL context and browsers cap how many a page may hold —
 * around eight to sixteen, after which the oldest are killed and start rendering
 * black. Five sections times three canvases is over that on its own. The engines
 * are therefore created only while a figure is near the viewport and disposed
 * when it leaves, so a scroll through the page holds three or six at a time.
 */

export type DemoMode = "coefficients" | "roots";

export interface DemoSample {
  label: string;
  /** Coefficient mode: the base cubic the sliders modify. */
  cubic?: Cubic;
  /** Root mode: the three real roots, before scale and separation are applied. */
  roots?: [number, number, number];
  branch?: Branch;
}

export interface DemoControl {
  key: "a" | "b" | "c" | "branch" | "scale" | "separation";
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  /** One line on what this value does, shown under the slider. */
  hint?: string;
}

export function MathDemo({
  mode,
  samples,
  controls,
  readouts = [],
}: {
  mode: DemoMode;
  samples: DemoSample[];
  controls: DemoControl[];
  /** Which derived values to print under each Form. */
  readouts?: ("equation" | "depressed" | "delta" | "class" | "structure" | "bands")[];
}) {
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(controls.map((c) => [c.key, c.initial])),
  );
  const [visible, setVisible] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      // start a screen early so the figure is already running by the time it
      // is read, and keep it alive a screen after
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const tokens = useMemo(
    () =>
      samples.map((s) => {
        const branch = ((values.branch ?? s.branch ?? 0) | 0) as Branch;
        if (mode === "roots" && s.roots) {
          // Move the roots themselves and let energy and feedback follow, which
          // is the actual claim the Energy/Feedback section makes. Setting those
          // drivers directly would be a lie about where they come from.
          const scale = values.scale ?? 1;
          const sep = values.separation ?? 1;
          const [r1, r2, r3] = s.roots;
          const mid = (r1 + r2) / 2;
          const cubic = fromRoots(
            cx((mid + (r1 - mid) * sep) * scale),
            cx((mid + (r2 - mid) * sep) * scale),
            cx(r3 * scale),
          );
          return tokenFromCubic(cubic, branch);
        }
        const base = s.cubic ?? { a: 0, b: 0, c: 0 };
        return tokenFromCubic(
          {
            a: values.a ?? base.a,
            b: values.b ?? base.b,
            c: values.c ?? base.c,
          },
          branch,
        );
      }),
    [samples, mode, values],
  );

  return (
    <div className="math-demo" ref={wrapRef}>
      <div className="math-demo-grid">
        {tokens.map((token, i) => (
          <figure key={samples[i].label}>
            <div className="math-demo-canvas">
              {visible ? (
                <ArtCanvas token={token} animate />
              ) : (
                <div className="math-demo-idle" />
              )}
            </div>
            <figcaption>
              <span className="math-demo-name">{samples[i].label}</span>
              {readouts.includes("equation") && <code>{token.equation}</code>}
              {readouts.includes("depressed") && (
                <code>
                  y³ {token.solution.p < 0 ? "−" : "+"} {Math.abs(token.solution.p).toFixed(2)}y{" "}
                  {token.solution.q < 0 ? "−" : "+"} {Math.abs(token.solution.q).toFixed(2)}
                </code>
              )}
              {readouts.includes("delta") && (
                <code>Δ = {token.solution.discriminant.toFixed(2)}</code>
              )}
              {readouts.includes("class") && (
                <span>
                  {token.traits.discriminantClass} · {token.traits.rootState}
                </span>
              )}
              {readouts.includes("structure") && <span>{token.traits.structure}</span>}
              {readouts.includes("bands") && (
                <span>
                  Energy {token.traits.energyBand} · Feedback {token.traits.feedbackBand}
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="math-demo-controls">
        {controls.map((c) => (
          <div className="math-demo-control" key={c.key}>
            <label htmlFor={`d-${c.key}-${samples[0].label}`}>
              {c.label}
              <span className="num">
                {c.step >= 1 ? values[c.key] : values[c.key]?.toFixed(2)}
              </span>
            </label>
            <input
              id={`d-${c.key}-${samples[0].label}`}
              type="range"
              min={c.min}
              max={c.max}
              step={c.step}
              value={values[c.key]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [c.key]: Number(e.target.value) }))
              }
            />
            {c.hint && <span className="math-demo-hint">{c.hint}</span>}
          </div>
        ))}
        <button
          onClick={() =>
            setValues(Object.fromEntries(controls.map((c) => [c.key, c.initial])))
          }
        >
          Reset
        </button>
      </div>
    </div>
  );
}
