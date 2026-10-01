"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { COLLECTION, deriveToken } from "@cse/core";
import { IS_DEMO, MASTER_SEED, imageUrl } from "@/lib/config";
import { nonceFor, useTokenIndex } from "@/lib/tokens";

const pad = (n: number) => String(n).padStart(4, "0");

/**
 * Pick one of your Forms to load into the Lab. Lists what the connected wallet
 * holds (via /api/owner), as images where the collection has them and as
 * number + form name where it doesn't. Any Form can also be loaded by id —
 * the maths is public, and before the mint nobody holds anything.
 */
export function FormPickerModal({
  open,
  onClose,
  onLoad,
  container,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (form: { id: number; nonce: number }) => void;
  /** Where to render; the Lab passes its root so true full screen shows it. */
  container?: Element | null;
}) {
  const { address } = useAccount();
  const index = useTokenIndex();
  const [owned, setOwned] = useState<number[] | null>(null);
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const [byId, setById] = useState("");

  useEffect(() => {
    if (!open) return;
    setChosen(null);
    setOwned(null);
    setNote("");
    if (IS_DEMO) {
      setOwned([]);
      setNote("Nothing's minted yet, so no wallet holds a Form. Load any one by id below.");
      return;
    }
    if (!address) return;
    let live = true;
    fetch(`/api/owner?address=${address}`)
      .then((r) => r.json())
      .then((d: { tokenIds?: number[]; error?: string }) => {
        if (!live) return;
        setOwned(d.tokenIds ?? []);
        if (d.error) setNote("Couldn't read this wallet's Forms right now.");
        else if (!d.tokenIds?.length) setNote("This wallet doesn't hold a Form yet.");
      })
      .catch(() => live && (setOwned([]), setNote("Couldn't read this wallet's Forms right now.")));
    return () => {
      live = false;
    };
  }, [open, address]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const tiles = useMemo(
    () =>
      (owned ?? []).map((id) => ({
        id,
        structure: deriveToken(MASTER_SEED, id, nonceFor(index, id)).traits.structure,
        src: imageUrl(id),
      })),
    [owned, index],
  );

  if (!open) return null;

  const typed = Number(byId);
  const typedOk = Number.isInteger(typed) && typed >= 1 && typed <= COLLECTION.supply;
  const load = (id: number) => {
    onLoad({ id, nonce: nonceFor(index, id) });
    onClose();
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel wallet-modal form-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Load one of your Forms"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <span>Load yours</span>
          <button className="wallet-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="panel-body">
          {owned === null ? (
            <p className="wallet-modal-empty">Reading your wallet…</p>
          ) : (
            note && <p className="wallet-modal-empty">{note}</p>
          )}

          {tiles.length > 0 && (
            <div className="form-pick-grid">
              {tiles.map((t) => (
                <button
                  key={t.id}
                  className={`form-pick${chosen === t.id ? " on" : ""}`}
                  onClick={() => setChosen(t.id)}
                  onDoubleClick={() => load(t.id)}
                  title={`CSE #${pad(t.id)} · ${t.structure}`}
                >
                  {t.src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.src} alt="" loading="lazy" />
                  ) : (
                    <span className="form-pick-blank">{t.structure}</span>
                  )}
                  <span className="form-pick-id">#{pad(t.id)}</span>
                </button>
              ))}
            </div>
          )}

          {tiles.length > 0 && (
            <button
              className="primary form-pick-go"
              disabled={chosen === null}
              onClick={() => chosen !== null && load(chosen)}
            >
              {chosen === null ? "Pick a Form" : `Load CSE #${pad(chosen)}`}
            </button>
          )}

          <form
            className="form-pick-byid"
            onSubmit={(e) => {
              e.preventDefault();
              if (typedOk) load(typed);
            }}
          >
            <label className="mono-label" htmlFor="form-by-id">
              Or any Form by id
            </label>
            <input
              id="form-by-id"
              inputMode="numeric"
              placeholder={`1 to ${COLLECTION.supply}`}
              value={byId}
              onChange={(e) => setById(e.target.value.replace(/\D/g, ""))}
            />
            <button disabled={!typedOk}>Load</button>
          </form>
        </div>
      </div>
    </div>,
    container ?? document.body,
  );
}
