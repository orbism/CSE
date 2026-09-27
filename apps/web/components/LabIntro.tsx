"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One sentence always; the rest on request. Scrolling down toward the desk
 * folds it away again, measured from where it was opened, so opening it while
 * already scrolled doesn't snap it shut.
 */
export function LabIntro() {
  const [open, setOpen] = useState(false);
  const openedAt = useRef(0);

  useEffect(() => {
    if (!open) return;
    openedAt.current = window.scrollY;
    const onScroll = () => window.scrollY > openedAt.current + 40 && setOpen(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open]);

  return (
    <div className="lab-intro">
      <p className="lede">
        Build a form from a <em>chain of operators</em> — the chain is the artefact, it lives in
        the URL, and it mutates and breeds.{" "}
        <button className="lab-intro-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "less" : "more"}
        </button>
      </p>
      {open && (
        <p className="muted">
          The collection's twenty-two forms are hand-authored; this has none, and nothing here is
          mintable. <strong>Get weird</strong> escalates with each press. <strong>Feedback</strong>{" "}
          feeds the glyph grid back into the geometry, so the form is partly sculpted by its own
          image. <strong>Sound</strong> lets your music drive it live.
        </p>
      )}
    </div>
  );
}
