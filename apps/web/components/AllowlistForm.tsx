"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectModal } from "./ConnectModal";

const WINNERS = 420;

/**
 * One field, one button. The field is the connected wallet and nothing else,
 * so entering means proving you hold the address. Everything that comes back
 * is the server's word: already in, entries closed, or in the hat.
 */
export function AllowlistForm() {
  const { address, isConnected } = useAccount();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "warn" | "err" } | null>(null);
  const [stats, setStats] = useState<{ entries: number; closed: boolean; entered: boolean; won: boolean } | null>(null);

  useEffect(() => {
    setMsg(null);
    fetch(`/api/allowlist${address ? `?address=${address}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
  }, [address]);

  const submit = async () => {
    if (!address) return setPicking(true);
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMsg({ text: "You are in. Winners are drawn at random and published here.", kind: "ok" });
        setStats((s) => (s ? { ...s, entries: s.entries + 1, entered: true } : s));
      } else if (res.status === 409) setMsg({ text: body.error ?? "This wallet was already submitted.", kind: "warn" });
      else setMsg({ text: body.error ?? `Could not enter (${res.status}).`, kind: "err" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel allowlist">
      <div className="panel-head">
        <span>Raffle</span>
        <span className="mono-label">{stats ? (stats.closed ? "drawn" : `${stats.entries} entered`) : ""}</span>
      </div>
      <div className="panel-body">
        <p>
          Connect the wallet you will mint with and submit it. Every entry goes into one draw:{" "}
          <b>{WINNERS} wallets are selected at random</b> for the allowlist window, two hours at the allowlist price
          before the public mint opens to everyone. One entry per wallet.
        </p>
        <label className="mono-label" htmlFor="allowlist-address">
          Wallet
        </label>
        <input
          id="allowlist-address"
          className="allowlist-input"
          value={address ?? ""}
          placeholder="connect a wallet"
          readOnly
          spellCheck={false}
        />
        {stats?.closed ? (
          <div className={`status ${stats.won ? "ok" : "warn"}`}>
            {stats.won
              ? "Drawn, and this wallet is on the allowlist."
              : stats.entered
                ? "Drawn. This wallet was not selected; the public mint follows the allowlist window."
                : "The draw has happened and entries are closed."}
          </div>
        ) : (
          <button className="primary" style={{ width: "100%", marginTop: 12 }} disabled={busy} onClick={submit}>
            {!isConnected ? "Connect wallet" : stats?.entered ? "Already entered" : busy ? "Entering…" : "Enter the raffle"}
          </button>
        )}
        {msg && <div className={`status ${msg.kind}`}>{msg.text}</div>}
      </div>
      <ConnectModal open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}
