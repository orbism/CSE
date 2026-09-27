"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mainnet } from "wagmi/chains";
import { useAccount, useConnect, useDisconnect, useEnsName, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/config";

const truncate = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Wallet control for the masthead.
 *
 * Connectors come from wagmi's EIP-6963 discovery, so every installed wallet is
 * listed and nothing here needs a project id or a hosted modal.
 */
export function ConnectButton() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  // ENS lives on mainnet regardless of which chain the app targets
  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const wrongChain = isConnected && chainId !== undefined && chainId !== activeChain.id;

  if (!isConnected) {
    const only = connectors.length === 1 ? connectors[0] : null;
    return (
      <div className="wallet" ref={rootRef}>
        <button
          className="wallet-main"
          disabled={connecting || connectors.length === 0}
          onClick={() => {
            if (connectors.length === 0) return;
            if (only) connect({ connector: only, chainId: activeChain.id });
            else setOpen((o) => !o);
          }}
        >
          {connectors.length === 0
            ? "No wallet"
            : connecting
              ? "Connecting…"
              : "Connect"}
        </button>

        {open && connectors.length > 1 && (
          <div className="wallet-menu">
            {connectors.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  connect({ connector: c, chainId: activeChain.id });
                  setOpen(false);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        {connectError && <div className="wallet-note err">{connectError.message.split("\n")[0]}</div>}
      </div>
    );
  }

  return (
    <div className="wallet" ref={rootRef}>
      {wrongChain && (
        <button
          className="wallet-chain"
          disabled={switching}
          onClick={() => switchChain({ chainId: activeChain.id })}
          title={`Your wallet is on chain ${chainId}; this collection lives on ${activeChain.name}`}
        >
          {switching ? "Switching…" : `Switch to ${activeChain.name}`}
        </button>
      )}

      <button className="wallet-main" onClick={() => setOpen((o) => !o)}>
        <span className={wrongChain ? "dot warn" : "dot ok"} />
        {ensName ?? truncate(address!)}
        <span className="caret">▾</span>
      </button>

      {open && (
        <div className="wallet-menu">
          <button
            onClick={() => {
              setOpen(false);
              router.push(`/output?wallet=${address}`);
            }}
          >
            View forms
          </button>
          <button
            onClick={() => {
              setOpen(false);
              disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
