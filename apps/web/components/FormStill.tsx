"use client";

import { useEffect, useState } from "react";

/**
 * What is true of every Form of a given type, and nothing that is not.
 *
 * The discriminant class picks the family, and the class is exactly the sign of
 * Δ — which in turn fixes the root state. So for any one form these three are
 * constant across the whole collection, while palette, phase and band vary token
 * by token and are deliberately left out.
 */
const TAXONOMY: Record<string, { delta: string; roots: string }> = {
  Separated: { delta: "Δ > 0", roots: "3 real distinct" },
  Fractured: { delta: "Δ < 0", roots: "1 real, 2 complex" },
  Merged: { delta: "Δ ≈ 0", roots: "repeated root" },
};

/**
 * A documentation still on the art page, enlargeable.
 *
 * Stills rather than live canvases: one WebGL context per form on a single page
 * would exhaust the browser's limit and stall the scroll. As a grid tile a
 * form reads as a silhouette and little else, so clicking opens the same PNG at
 * full size — no second asset, no renderer.
 */
export function FormStill({ name, cls }: { name: string; cls: string }) {
  const [open, setOpen] = useState(false);
  const src = `/forms/${name.toLowerCase()}.png`;
  const tax = TAXONOMY[cls];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="form-still"
        src={src}
        alt={`${name}, a rendered example`}
        width={420}
        height={420}
        loading="lazy"
        onClick={() => setOpen(true)}
        title={`${name} · click to enlarge`}
      />

      {open && (
        // the backdrop takes the click, so anywhere outside the image closes
        <div className="lightbox" onClick={() => setOpen(false)}>
          <figure onClick={() => setOpen(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${name}, a rendered example`} width={420} height={420} />
            <figcaption>
              <span className="lb-name">{name}</span>
              <span className="lb-tax">
                {cls}
                {tax && ` · ${tax.delta} · ${tax.roots}`}
              </span>
            </figcaption>
          </figure>
        </div>
      )}
    </>
  );
}
