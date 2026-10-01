"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { COLLECTION, deriveToken, tokenSummary } from "@cse/core";
import { MASTER_SEED } from "@/lib/config";
import type { TokenRow } from "@/lib/tokens";
import { ArtViewer } from "./ArtViewer";
import { ExportBar } from "./ExportBar";

const fmt = (c: { re: number; im: number }) => {
  const re = c.re.toFixed(4);
  if (Math.abs(c.im) < 5e-5) return re;
  return `${re} ${c.im < 0 ? "−" : "+"} ${Math.abs(c.im).toFixed(4)}i`;
};

/**
 * A Form in the gallery: live art, the full mathematics, and the downloads.
 *
 * Uses the same renderer rather than an iframe of the pinned bundle, which is
 * what makes exporting possible — an iframe's canvas is cross-document and its
 * pixels cannot be read out.
 */
export function TokenModal({
  row,
  onClose,
  onStep,
}: {
  row: TokenRow;
  onClose: () => void;
  /** Move by one Form within the current filtered, sorted list. Wraps at both ends. */
  onStep?: (delta: number) => void;
}) {
  const token = useMemo(
    () => deriveToken(MASTER_SEED, row.tokenId, row.nonce ?? 0),
    [row.tokenId, row.nonce],
  );
  const summary = useMemo(() => tokenSummary(token), [token]);
  const pad = String(row.tokenId).padStart(4, "0");

  const stageRef = useRef<HTMLDivElement>(null);
  const dirRef = useRef<1 | -1>(1);

  /** Remember which way we are travelling so the glitch throws the right way. */
  const step = useCallback(
    (delta: number) => {
      dirRef.current = delta >= 0 ? 1 : -1;
      onStep?.(delta);
    },
    [onStep],
  );

  /**
   * Replay the transition on every change of Form.
   *
   * Deliberately a class toggle and a forced reflow rather than a React `key`:
   * keying this subtree would remount `ArtViewer`, and that tears down and
   * rebuilds a WebGL context on every arrow press — browsers cap how many live
   * contexts a page may hold, so stepping through a filtered set would run the
   * page out of them.
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    el.classList.remove("stepping-next", "stepping-prev");
    // reading layout forces the removal to commit, which is what lets the
    // animation restart instead of being treated as already running
    void el.offsetWidth;
    el.classList.add(dirRef.current > 0 ? "stepping-next" : "stepping-prev");
  }, [row.tokenId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // arrow keys as well as the on-screen boxes: once you are stepping through
      // a filtered set, reaching for the mouse every time is the annoying part
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, step]);

  const maths = (
    <dl className="kv">
      <dt>Cubic</dt>
      <dd>{summary.equation}</dd>
      <dt>Depressed</dt>
      <dd>{summary.depressed}</dd>
      <dt>p</dt>
      <dd>{summary.p.toFixed(6)}</dd>
      <dt>q</dt>
      <dd>{summary.q.toFixed(6)}</dd>
      <dt>Δ</dt>
      <dd>{summary.discriminant.toFixed(6)}</dd>
      <dt>Shift</dt>
      <dd>{summary.shift.toFixed(6)}</dd>
      <dt>A</dt>
      <dd>{fmt(summary.resolvent)}</dd>
      <dt>α</dt>
      <dd>{fmt(summary.roots[0])}</dd>
      <dt>β</dt>
      <dd>{fmt(summary.roots[1])}</dd>
      <dt>γ</dt>
      <dd>{fmt(summary.roots[2])}</dd>
      <dt>Perm</dt>
      <dd>
        ({summary.permutation.join(" ")}) · {summary.parity === 0 ? "even" : "odd"}
      </dd>
      <dt>Seed</dt>
      <dd style={{ fontSize: 10 }}>{summary.seed}</dd>
    </dl>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* The stage exists so the step buttons can stretch to the modal's height
          rather than the viewport's — `align-self: stretch` measures the flex
          container, and the backdrop is the whole screen. */}
      <div className="modal-stage">
        {onStep && (
          <button
            className="modal-step prev"
            aria-label="Previous Form"
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
          >
            ‹
          </button>
        )}

        <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span>Cubic Symmetry Engine · Form #{pad}</span>
          <button style={{ border: 0, padding: "2px 6px" }} onClick={onClose}>
            Close ✕
          </button>
        </div>

        <div className="modal-grid" ref={stageRef}>
          <div>
            <ArtViewer
              token={token}
              caption={`CSE #${pad} · ${summary.traits.structure}`}
              footer={(engine) => <ExportBar engine={engine} name={`cse-form-${pad}`} />}
            >
              {maths}
            </ArtViewer>
          </div>

          <div className="modal-side">
            <div className="mono-label" style={{ marginBottom: 8 }}>
              Traits
            </div>
            {Object.entries({
              Structure: summary.traits.structure,
              "Root State": summary.traits.rootState,
              Symmetry: summary.traits.symmetry,
              "Discriminant Class": summary.traits.discriminantClass,
              Band: summary.traits.discriminantBand,
              Energy: summary.traits.energyBand,
              Feedback: summary.traits.feedbackBand,
              Phase: `ω${summary.traits.phase}`,
              Palette: summary.traits.palette,
              "Rarity Rank": row.rarityRank ? `#${row.rarityRank} / ${COLLECTION.supply}` : "-",
            }).map(([k, v]) => (
              <div className="trait-row" key={k}>
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}

            <div className="mono-label" style={{ margin: "16px 0 8px" }}>
              Mathematics
            </div>
              {maths}
            </div>
          </div>
        </div>

        {onStep && (
          <button
            className="modal-step next"
            aria-label="Next Form"
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
