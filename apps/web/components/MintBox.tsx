"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { readContract } from "wagmi/actions";
import { COLLECTION, type Token, deriveToken, tokenSummary } from "@cse/core";
import { CSE_ABI, MINT_STATE } from "@/lib/abi";
import { CONTRACT_ADDRESS, IS_DEMO, MASTER_SEED, activeChain, wagmiConfig } from "@/lib/config";
import { pickAvailable, useMintedSet } from "@/lib/minted";
import { describeTxError } from "@/lib/errors";
import { nonceFor, useTokenIndex } from "@/lib/tokens";
import { ArtViewer } from "./ArtViewer";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pad = (n: number) => String(n).padStart(4, "0");

/**
 * Solve, look, mint.
 *
 * The Form on screen is the Form the transaction mints — the contract takes
 * explicit token ids rather than handing out the next in sequence. "Solve
 * again" draws another id that nobody has taken yet.
 *
 * Downloads deliberately live in the gallery instead of here: you export a
 * piece you own, not one you are still deciding about.
 */
export function MintBox() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();

  // The wallet can sit on any network. Minting from the wrong one used to throw
  // a raw wagmi mismatch error; now the button switches first and then mints.
  const wrongChain =
    isConnected && walletChainId !== undefined && walletChainId !== activeChain.id;
  const index = useTokenIndex();
  const { minted, refetch: refetchMinted, isLoading: mintedLoading } = useMintedSet();

  /**
   * Whether the minted set is real yet.
   *
   * Before the first `mintedBitmap` read lands, `minted` is an empty Set — which
   * is indistinguishable from "nothing has been minted". Picking against it drew
   * from all 512 ids with no exclusion and then labelled the result available, so
   * on a slow first read the panel would offer a Form somebody already owns. An
   * empty set is not evidence of availability; only a completed read is.
   */
  const mintedKnown = !mintedLoading;

  const base = { address: CONTRACT_ADDRESS, abi: CSE_ABI, chainId: activeChain.id } as const;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...base, functionName: "mintState" },
      { ...base, functionName: "price" },
      { ...base, functionName: "totalSupply" },
      { ...base, functionName: "remainingPublic" },
      { ...base, functionName: "MAX_PER_WALLET" },
      {
        ...base,
        functionName: "mintedBy",
        args: [address ?? "0x0000000000000000000000000000000000000000"],
      },
    ],
    query: { refetchInterval: 12_000, enabled: !IS_DEMO },
  });

  const state = (data?.[0]?.result as number | undefined) ?? 0;
  const price = (data?.[1]?.result as bigint | undefined) ?? parseEther("0.005");
  const supply = Number((data?.[2]?.result as bigint | undefined) ?? 0n);
  const remaining = Number((data?.[3]?.result as bigint | undefined) ?? 0n);
  const maxPerWallet = Number((data?.[4]?.result as bigint | undefined) ?? 20n);
  const walletMinted = Number((data?.[5]?.result as bigint | undefined) ?? 0n);
  // A demo has no contract to ask: always closed.
  const label = IS_DEMO ? "CLOSED" : (MINT_STATE[state] ?? "CLOSED");
  const isLive = label === "LIVE";
  const walletRemaining = Math.max(0, maxPerWallet - walletMinted);

  const { data: balance } = useBalance({
    address,
    chainId: activeChain.id,
    query: { enabled: !!address && !IS_DEMO, refetchInterval: 20_000 },
  });

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // ── the Form on screen ────────────────────────────────────────────────────
  const [shownId, setShownId] = useState<number | null>(null);

  const solveAgain = useCallback(() => {
    setShownId((current) => pickAvailable(minted, current ?? undefined) ?? current);
  }, [minted]);

  // First pick happens on mount, not during render: rolling while rendering
  // makes the server and client disagree and triggers a hydration mismatch.
  // It also waits for the minted set, so the opening Form is never one that is
  // already owned.
  useEffect(() => {
    if (shownId === null && mintedKnown) setShownId(pickAvailable(minted) ?? 1);
  }, [minted, shownId, mintedKnown]);

  // if someone takes the piece being looked at, move on rather than let the
  // user send a transaction that is guaranteed to revert
  useEffect(() => {
    if (shownId !== null && minted.has(shownId)) solveAgain();
  }, [minted, shownId, solveAgain]);

  useEffect(() => {
    if (isSuccess) {
      refetch();
      refetchMinted();
      solveAgain();
    }
  }, [isSuccess, refetch, refetchMinted, solveAgain]);

  // `id` stays defined so the hooks below keep a stable shape; `ready` is what
  // gates rendering, because #1 is a real token that may well be owned.
  const ready = shownId !== null;
  const id = shownId ?? 1;

  /** Set when the pre-flight read finds the Form gone; cleared on the next try. */
  const [taken, setTaken] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  /**
   * Deriving at nonce 0 is wrong for any token the generator re-rolled to
   * satisfy the uniqueness gates — that Form's real art lives at a bumped
   * nonce. The published index carries the settled value.
   */
  const token: Token = useMemo(
    () => deriveToken(MASTER_SEED, id, nonceFor(index, id)),
    [id, index.rows],
  );
  const shown = useMemo(() => tokenSummary(token), [token]);
  const soldOut = remaining === 0 && supply > 0;

  // Catch an empty wallet before the user signs. Minting costs the price plus
  // gas, so compare against a little more than the price rather than the price
  // exactly — otherwise the check passes and the wallet still rejects it.
  const gasHeadroom = parseEther("0.0004");
  const shortOfFunds =
    isConnected && balance !== undefined && balance.value < price + gasHeadroom;
  const friendly = error ? describeTxError(error) : null;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{isLive ? "Mint" : "The collection"}</span>
        <span
          className={`badge ${label === "LIVE" ? "live" : label === "SOLD_OUT" ? "sold" : "closed"}`}
        >
          {label.replace("_", " ")}
        </span>
      </div>

      {ready ? (
        <ArtViewer token={token} caption={`CSE #${pad(id)} · ${shown.traits.structure}`}>
          <dl className="kv">
            <dt>Equation</dt>
            <dd>{shown.equation}</dd>
            <dt>Depressed</dt>
            <dd>{shown.depressed}</dd>
            <dt>Δ</dt>
            <dd>{shown.discriminant.toFixed(3)}</dd>
          </dl>
        </ArtViewer>
      ) : (
        <div className="solving">
          <span className="mono-label">Solving…</span>
        </div>
      )}

      <div className="panel-body">
        <dl className="kv">
          <dt>Form</dt>
          <dd>
            {ready ? `#${pad(id)}` : "-"}
            {/* "available" needs a completed read behind it, not merely an
                empty set that has not been filled in yet */}
            {ready && isLive && mintedKnown && !minted.has(id) && (
              <span style={{ color: "var(--accent)" }}> · available</span>
            )}
          </dd>
          <dt>Equation</dt>
          <dd>{ready ? shown.equation : "-"}</dd>
          <dt>Structure</dt>
          <dd>
            {ready
              ? `${shown.traits.structure} · ${shown.traits.rootState} · ω${shown.traits.phase}`
              : "-"}
          </dd>
        </dl>

        <button
          style={{ width: "100%", marginTop: 12 }}
          onClick={solveAgain}
          disabled={soldOut}
          title="Draw another equation nobody has taken"
        >
          Solve again ⟳
        </button>

        {!isLive && (
          <p style={{ fontSize: 11, color: "var(--ink-faint)", marginTop: 10, marginBottom: 0 }}>
            {IS_DEMO
              ? "Mint's closed for now. This is the real renderer running a real Form, solve away."
              : label === "SOLD_OUT"
                ? "The mint has closed. Every Form is in the gallery."
                : "The mint has not opened. This is the real renderer running a real Form."}
          </p>
        )}

        {isLive && (
          <div style={{ marginTop: 14 }}>
            <dl className="kv">
              <dt>You mint</dt>
              <dd style={{ color: "var(--accent)" }}>this one, #{pad(id)}</dd>
              <dt>Price</dt>
              <dd>{formatEther(price)} ETH</dd>
              <dt>Minted</dt>
              <dd>
                {supply} / {COLLECTION.supply} · {remaining} left
              </dd>
              <dt>Your cap</dt>
              <dd>
                {walletMinted} / {maxPerWallet}
              </dd>
            </dl>

            {!isConnected ? (
              connectors.length === 0 ? (
                <div className="status err">
                  No wallet detected. Install a browser wallet to mint.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                  {connectors.map((c) => (
                    <button
                      key={c.uid}
                      className="primary"
                      disabled={connecting}
                      onClick={() => connect({ connector: c, chainId: activeChain.id })}
                    >
                      {connecting ? "Connecting…" : `Connect ${c.name}`}
                    </button>
                  ))}
                </div>
              )
            ) : (
              <>
                <button
                  className="primary"
                  style={{ width: "100%", marginTop: 12 }}
                  disabled={
                    !ready ||
                    checking ||
                    isPending ||
                    confirming ||
                    switching ||
                    walletRemaining === 0 ||
                    soldOut ||
                    shortOfFunds
                  }
                  onClick={async () => {
                    reset();
                    setTaken(null);
                    // Ask the wallet to move first. If the user declines, stop
                    // here rather than sending a transaction that cannot land.
                    if (wrongChain) {
                      try {
                        await switchChainAsync({ chainId: activeChain.id });
                      } catch {
                        return;
                      }
                    }

                    // The bitmap is up to 15s stale, so between polls this Form
                    // may already be gone. One cheap read beats asking the user
                    // to sign something that is guaranteed to revert.
                    setChecking(true);
                    let free = true;
                    try {
                      free = (await readContract(wagmiConfig, {
                        address: CONTRACT_ADDRESS,
                        abi: CSE_ABI,
                        functionName: "isAvailable",
                        args: [BigInt(id)],
                        chainId: activeChain.id,
                      })) as boolean;
                    } catch {
                      // If the read itself fails, fall through and let the
                      // transaction be the judge — AlreadyMinted still catches it.
                    } finally {
                      setChecking(false);
                    }
                    if (!free) {
                      setTaken(id);
                      refetchMinted();
                      solveAgain();
                      return;
                    }

                    writeContract({
                      address: CONTRACT_ADDRESS,
                      abi: CSE_ABI,
                      functionName: "mint",
                      args: [[BigInt(id)]],
                      value: price,
                      chainId: activeChain.id,
                    });
                  }}
                >
                  {soldOut
                    ? "Sold out"
                    : walletRemaining === 0
                      ? "Wallet limit reached"
                      : shortOfFunds
                        ? "Not enough ETH"
                        : checking
                        ? "Checking…"
                        : switching
                        ? `Switching to ${activeChain.name}…`
                        : wrongChain
                          ? `Switch to ${activeChain.name} & mint`
                          : isPending
                            ? "Confirm in wallet…"
                            : confirming
                              ? "Minting…"
                              : `Mint #${pad(id)} · ${formatEther(price)} ETH`}
                </button>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--ink-faint)",
                  }}
                >
                  <span>{address ? short(address) : ""}</span>
                  <button
                    style={{ border: 0, padding: 0, fontSize: 10 }}
                    onClick={() => disconnect()}
                  >
                    Disconnect
                  </button>
                </div>
              </>
            )}

            {wrongChain && (
              <div className="status warn">
                Your wallet is on chain {walletChainId}. This collection lives on{" "}
                {activeChain.name} ({activeChain.id}). Minting will switch it for you.
              </div>
            )}

            {shortOfFunds && !friendly && (
              <div className="status warn">
                Not enough ETH. You have {formatEther(balance!.value).slice(0, 8)}{" "}
                {balance!.symbol}; this costs {formatEther(price)} plus gas.
              </div>
            )}

            {taken !== null && !isSuccess && (
              <div className="status warn">
                <strong>Someone took #{pad(taken)} first</strong>
                <div className="status-detail">
                  Nothing was sent. Here is another nobody has taken.
                </div>
              </div>
            )}

            {isSuccess && (
              <div className="status ok">
                Minted. Find it in <a href="/output">output</a>.
              </div>
            )}

            {friendly && (
              <div className={`status ${friendly.benign ? "warn" : "err"}`}>
                <strong>{friendly.title}</strong>
                {friendly.detail && <div className="status-detail">{friendly.detail}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
