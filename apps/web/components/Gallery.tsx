"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ARCHETYPES, PALETTES } from "@cse/core";
import { imageUrl } from "@/lib/config";
import { type TokenRow, useTokenIndex } from "@/lib/tokens";
import { TokenModal } from "./TokenModal";

const ROOT_STATES = ["3 Real Distinct", "1 Real 2 Complex", "Double Root", "Triple Root"];
const DISC_CLASSES = ["Separated", "Fractured", "Merged"];
const SYMMETRIES = ["Identity", "Cyclic ω", "Cyclic ω²", "Transposed", "Full S₃"];
const ENERGY_BANDS = ["Still", "Charged", "Violent"];
const FEEDBACK_BANDS = ["None", "Echo", "Resonant", "Runaway"];
const SORTS = [
  "Token ↑",
  "Token ↓",
  "Rarest",
  "Commonest",
  "Minted ↑",
  "Minted ↓",
] as const;
const PER_PAGE = [12, 24, 60, 120, 240] as const;

const ANY = "";

export function Gallery() {
  const { rows, error: loadError } = useTokenIndex();

  const [structure, setStructure] = useState(ANY);
  const [rootState, setRootState] = useState(ANY);
  const [discClass, setDiscClass] = useState(ANY);
  const [symmetry, setSymmetry] = useState(ANY);
  const [phase, setPhase] = useState(ANY);
  const [palette, setPalette] = useState(ANY);
  const [energyBand, setEnergyBand] = useState(ANY);
  const [feedbackBand, setFeedbackBand] = useState(ANY);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Token ↑");

  const [walletInput, setWalletInput] = useState("");
  const [ownedIds, setOwnedIds] = useState<Set<number> | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [perPage, setPerPage] = useState<number>(60);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TokenRow | null>(null);

  /**
   * Mint times, id -> unix seconds. One log query behind an API route; absent
   * until it resolves, and absent for ids nobody has minted. Only the two
   * "Minted" sorts read it, so the gallery is fully usable before it lands.
   */
  const [mintedAt, setMintedAt] = useState<Record<number, number>>({});
  useEffect(() => {
    let live = true;
    fetch("/api/minted-at")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && b?.mintedAt && setMintedAt(b.mintedAt))
      .catch(() => {
        /* sorting by mint date is a convenience, not a requirement */
      });
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let out = rows.filter((r) => {
      if (structure && r.traits.structure !== structure) return false;
      if (rootState && r.traits.rootState !== rootState) return false;
      if (discClass && r.traits.discriminantClass !== discClass) return false;
      if (symmetry && r.traits.symmetry !== symmetry) return false;
      if (phase !== ANY && String(r.traits.phase) !== phase) return false;
      if (palette && r.traits.palette !== palette) return false;
      if (energyBand && r.traits.energyBand !== energyBand) return false;
      if (feedbackBand && r.traits.feedbackBand !== feedbackBand) return false;
      if (ownedIds && !ownedIds.has(r.tokenId)) return false;
      return true;
    });
    out = [...out];
    switch (sort) {
      case "Token ↑":
        out.sort((a, b) => a.tokenId - b.tokenId);
        break;
      case "Token ↓":
        out.sort((a, b) => b.tokenId - a.tokenId);
        break;
      case "Rarest":
        out.sort((a, b) => a.rarityRank - b.rarityRank);
        break;
      case "Commonest":
        out.sort((a, b) => b.rarityRank - a.rarityRank);
        break;
      // Unminted ids have no date at all, so they collect at the end of both
      // directions rather than pretending to be the oldest or the newest.
      case "Minted ↑":
        out.sort((a, b) => cmpMinted(a, b, mintedAt, 1));
        break;
      case "Minted ↓":
        out.sort((a, b) => cmpMinted(a, b, mintedAt, -1));
        break;
    }
    return out;
  }, [rows, structure, rootState, discClass, symmetry, phase, palette, energyBand, feedbackBand, ownedIds, sort, mintedAt]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
  const clampedPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(clampedPage * perPage, clampedPage * perPage + perPage);

  // Any change to what is listed, or how much of it fits, sends you back to the
  // top rather than to a page that may no longer exist.
  useEffect(() => setPage(0), [filtered.length, sort, perPage]);

  /** Step through the whole filtered list, wrapping, and follow it with the page. */
  const step = useCallback(
    (delta: number) => {
      if (!selected || filtered.length === 0) return;
      const at = filtered.findIndex((r) => r.tokenId === selected.tokenId);
      if (at === -1) return;
      const next = (at + delta + filtered.length) % filtered.length;
      setSelected(filtered[next]);
      setPage(Math.floor(next / perPage));
    },
    [selected, filtered, perPage],
  );

  const lookupWallet = useCallback(async (override?: string) => {
    const address = (override ?? walletInput).trim();
    setWalletError(null);
    if (!address) {
      setOwnedIds(null);
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setWalletError("Not a valid address");
      return;
    }
    setWalletBusy(true);
    try {
      const res = await fetch(`/api/owner?address=${address}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `lookup failed (${res.status})`);
      setOwnedIds(new Set<number>(body.tokenIds));
      if (body.tokenIds.length === 0) setWalletError("This wallet holds none of the collection");
    } catch (e) {
      setWalletError(String(e instanceof Error ? e.message : e));
      setOwnedIds(null);
    } finally {
      setWalletBusy(false);
    }
  }, [walletInput]);

  // "View forms" in the wallet menu links here with ?wallet=0x…
  const params = useSearchParams();
  const walletParam = params.get("wallet");
  useEffect(() => {
    if (!walletParam) return;
    setWalletInput(walletParam);
    lookupWallet(walletParam);
    // deliberately keyed on the param alone: re-running when the callback
    // identity changes would re-query on every keystroke in the input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletParam]);

  function clearAll() {
    setStructure(ANY);
    setRootState(ANY);
    setDiscClass(ANY);
    setSymmetry(ANY);
    setPhase(ANY);
    setPalette(ANY);
    setEnergyBand(ANY);
    setFeedbackBand(ANY);
    setWalletInput("");
    setOwnedIds(null);
    setWalletError(null);
  }

  const activeFilters =
    [structure, rootState, discClass, symmetry, palette, energyBand, feedbackBand].filter(Boolean)
      .length +
    (phase !== ANY ? 1 : 0) +
    (ownedIds ? 1 : 0);

  return (
    <section id="gallery">
      <div className="panel">
        <div className="panel-head">
          <span>Gallery</span>
          <span className="num">
            {rows ? `${filtered.length} / ${rows.length}` : "loading…"}
          </span>
        </div>

        <div className="filters">
          <Select label="Structure" value={structure} onChange={setStructure} options={[...ARCHETYPES]} />
          <Select label="Root state" value={rootState} onChange={setRootState} options={ROOT_STATES} />
          <Select label="Discriminant" value={discClass} onChange={setDiscClass} options={DISC_CLASSES} />
          <Select label="Symmetry" value={symmetry} onChange={setSymmetry} options={SYMMETRIES} />
          <Select label="Phase" value={phase} onChange={setPhase} options={["0", "1", "2"]} render={(v) => `ω${v}`} />
          <Select
            label="Palette"
            value={palette}
            onChange={setPalette}
            options={PALETTES.map((p) => p.name)}
          />
          <Select label="Energy" value={energyBand} onChange={setEnergyBand} options={ENERGY_BANDS} />
          <Select
            label="Feedback"
            value={feedbackBand}
            onChange={setFeedbackBand}
            options={FEEDBACK_BANDS}
          />

          <div className="field grow">
            <label className="mono-label" htmlFor="wallet">
              Wallet
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                id="wallet"
                placeholder="0x…"
                value={walletInput}
                spellCheck={false}
                onChange={(e) => setWalletInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookupWallet()}
              />
              <button onClick={() => lookupWallet()} disabled={walletBusy}>
                {walletBusy ? "…" : "Find"}
              </button>
            </div>
          </div>

          <div className="field">
            <label className="mono-label" htmlFor="sort">
              Sort
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as (typeof SORTS)[number])}
            >
              {SORTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="mono-label" htmlFor="per-page">
              Per page
            </label>
            <select
              id="per-page"
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value))}
            >
              {PER_PAGE.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <button onClick={clearAll} disabled={activeFilters === 0}>
            Clear{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>

        {walletError && <div className="status err" style={{ margin: "0 12px 12px" }}>{walletError}</div>}
      </div>

      {loadError && (
        <div className="empty">
          Token index unavailable — run <code>pnpm generate</code> first.
          <div style={{ fontSize: 11, marginTop: 6 }}>{loadError}</div>
        </div>
      )}

      {rows && filtered.length === 0 && !loadError && (
        <div className="empty">No tokens match these filters.</div>
      )}

      <div className="grid">
        {shown.map((row) => (
          <div className="tile" key={row.tokenId} onClick={() => setSelected(row)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(row.tokenId)} alt={`CSE #${row.tokenId}`} loading="lazy" />
            <div className="meta">
              <span className="num">#{String(row.tokenId).padStart(4, "0")}</span>
              <span>{row.traits.structure}</span>
            </div>
          </div>
        ))}
      </div>

      {pageCount > 1 && (
        <div className="pager">
          <button onClick={() => setPage(0)} disabled={clampedPage === 0}>
            ⏮
          </button>
          <button onClick={() => setPage((p) => p - 1)} disabled={clampedPage === 0}>
            ‹ Prev
          </button>
          <span className="num">
            Page {clampedPage + 1} / {pageCount}
            <span className="muted">
              {" "}
              · {clampedPage * perPage + 1}–{clampedPage * perPage + shown.length} of{" "}
              {filtered.length}
            </span>
          </span>
          <button onClick={() => setPage((p) => p + 1)} disabled={clampedPage >= pageCount - 1}>
            Next ›
          </button>
          <button onClick={() => setPage(pageCount - 1)} disabled={clampedPage >= pageCount - 1}>
            ⏭
          </button>
        </div>
      )}

      {selected && (
        <TokenModal row={selected} onClose={() => setSelected(null)} onStep={step} />
      )}
    </section>
  );
}

/**
 * Order by mint time, with never-minted ids last in both directions.
 *
 * `dir` flips only the comparison between two minted tokens: sending unminted
 * ones to the bottom of "oldest first" and the top of "newest first" would make
 * the sort look broken on a collection that is mostly unminted.
 */
function cmpMinted(
  a: TokenRow,
  b: TokenRow,
  mintedAt: Record<number, number>,
  dir: 1 | -1,
): number {
  const ta = mintedAt[a.tokenId];
  const tb = mintedAt[b.tokenId];
  if (ta === undefined && tb === undefined) return a.tokenId - b.tokenId;
  if (ta === undefined) return 1;
  if (tb === undefined) return -1;
  // ids minted in one transaction share a timestamp; break the tie by id so the
  // order is stable rather than whatever the sort happens to do
  return ta === tb ? a.tokenId - b.tokenId : (ta - tb) * dir;
}

function Select({
  label,
  value,
  onChange,
  options,
  render = (v: string) => v,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  render?: (v: string) => string;
}) {
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="field">
      <label className="mono-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {render(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
