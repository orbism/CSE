"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useConnect } from "wagmi";
import { activeChain } from "@/lib/config";

/**
 * Pick a wallet. Lists whatever this browser actually has — wagmi discovers
 * installed wallets through EIP-6963, each with its own name and icon — and
 * connects straight to the collection's chain. Closes once connected.
 *
 * Portalled to <body> (or `container`) so no panel's stacking or overflow can
 * clip it. The Lab passes its own root, which is what's visible in true full
 * screen, where nothing outside the full-screen element shows.
 */
export function ConnectModal({
  open,
  onClose,
  onConnected,
  container,
}: {
  open: boolean;
  onClose: () => void;
  /** Called instead of `onClose` once a wallet connects. */
  onConnected?: () => void;
  container?: Element | null;
}) {
  const { connectors, connectAsync } = useConnect();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  // a fresh open starts clean; kept apart from the listener below, whose
  // `onClose` changes every time the panel above re-renders
  useEffect(() => {
    if (open) setError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel wallet-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Connect a wallet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-head">
          <span>Connect a wallet</span>
          <button className="wallet-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="panel-body">
          {connectors.length === 0 ? (
            <p className="wallet-modal-empty">
              No wallet in this browser. Install{" "}
              <a href="https://rabby.io" target="_blank" rel="noreferrer noopener">
                Rabby
              </a>{" "}
              or{" "}
              <a href="https://metamask.io" target="_blank" rel="noreferrer noopener">
                MetaMask
              </a>
              , then reload.
            </p>
          ) : (
            <div className="wallet-options">
              {connectors.map((c) => (
                <button
                  key={c.uid}
                  className="wallet-option"
                  disabled={pending !== null}
                  onClick={async () => {
                    setPending(c.uid);
                    setError("");
                    try {
                      await connectAsync({ connector: c, chainId: activeChain.id });
                      (onConnected ?? onClose)();
                    } catch (e) {
                      setError((e as { shortMessage?: string }).shortMessage ?? String(e).split("\n")[0]);
                    } finally {
                      setPending(null);
                    }
                  }}
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" width={28} height={28} />
                  ) : (
                    <span className="wallet-option-blank" aria-hidden />
                  )}
                  <span>{c.name}</span>
                  {pending === c.uid && <span className="wallet-option-note">confirm in wallet…</span>}
                </button>
              ))}
            </div>
          )}
          {error && <div className="status err">{error}</div>}
        </div>
      </div>
    </div>,
    container ?? document.body,
  );
}
