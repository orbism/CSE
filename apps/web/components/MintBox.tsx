"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeEventLog, formatEther, parseEther } from "viem";
import {
  useAccount,
  useBalance,
  useDisconnect,
  useReadContracts,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { COLLECTION, type Prior, type Token, capturePose, dHash, hashToHex, tokenSummary } from "@cse/core";
import type { Engine } from "@cse/art";
import { CSE_ABI, MINT_STATE } from "@/lib/abi";
import { CONTRACT_ADDRESS, IS_DEMO, activeChain } from "@/lib/config";
import { describeTxError } from "@/lib/errors";
import { approve, priorsOf, rollClear } from "@/lib/roll";
import { loadTokenIndex } from "@/lib/tokens";
import { ArtViewer } from "./ArtViewer";
import { ConnectModal } from "./ConnectModal";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pad = (n: number) => String(n).padStart(4, "0");

type Phase = "rolling" | "checking" | "ready" | "approving" | "minting" | "minted";

/**
 * Roll, look, mint.
 *
 * Nothing here is pre-made. "Solve again" rolls a fresh 32-byte seed, derives
 * the Form from it on the spot, and clears it against every minted Form: the
 * maths locally, the rendered fingerprint through the approver. Minting sends
 * that exact seed with the approver's signature for this wallet, so what lands
 * on chain is what is on screen and nobody else can take the roll.
 *
 * "Surprise me" runs the same pipeline with the canvas covered and mints the
 * first clear roll sight unseen; the cover lifts when the transaction lands.
 */
export function MintBox() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [picking, setPicking] = useState(false);

  const wrongChain = isConnected && walletChainId !== undefined && walletChainId !== activeChain.id;

  const base = { address: CONTRACT_ADDRESS, abi: CSE_ABI, chainId: activeChain.id } as const;
  const { data, refetch } = useReadContracts({
    contracts: [
      { ...base, functionName: "mintState" },
      { ...base, functionName: "price" },
      { ...base, functionName: "totalMinted" },
      { ...base, functionName: "remainingPublic" },
      { ...base, functionName: "MAX_PER_WALLET" },
      { ...base, functionName: "mintedBy", args: [address ?? "0x0000000000000000000000000000000000000000"] },
    ],
    query: { refetchInterval: 12_000, enabled: !IS_DEMO },
  });
  const state = (data?.[0]?.result as number | undefined) ?? 0;
  const price = (data?.[1]?.result as bigint | undefined) ?? parseEther("0.005");
  const supply = Number((data?.[2]?.result as bigint | undefined) ?? 0n);
  const remaining = Number((data?.[3]?.result as bigint | undefined) ?? 0n);
  const maxPerWallet = Number((data?.[4]?.result as bigint | undefined) ?? 20n);
  const walletMinted = Number((data?.[5]?.result as bigint | undefined) ?? 0n);
  const label = IS_DEMO ? "CLOSED" : (MINT_STATE[state] ?? "CLOSED");
  const isLive = label === "LIVE";
  const soldOut = remaining === 0 && supply > 0;
  const walletRemaining = Math.max(0, maxPerWallet - walletMinted);

  const { data: balance } = useBalance({
    address,
    chainId: activeChain.id,
    query: { enabled: !!address && !IS_DEMO, refetchInterval: 20_000 },
  });
  const { writeContractAsync, data: hash, error, reset } = useWriteContract();
  const { data: receipt, isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // ── the roll ──────────────────────────────────────────────────────────────
  const priorsRef = useRef<Prior[]>([]);
  const [priorsReady, setPriorsReady] = useState(IS_DEMO);
  const [seed, setSeed] = useState<`0x${string}` | null>(null);
  const [token, setToken] = useState<Token | null>(null);
  const [phase, setPhase] = useState<Phase>("rolling");
  const [blind, setBlind] = useState(false);
  const [note, setNote] = useState("");
  const [mintedId, setMintedId] = useState<number | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const rollId = useRef(0);

  // what the approver will compare against, derived here from the minted seeds
  const loadPriors = useCallback(async (refresh = false) => {
    if (IS_DEMO) return;
    try {
      priorsRef.current = priorsOf(await loadTokenIndex(refresh));
    } catch {
      // without the index the local gate is skipped; the approver still runs the real one
    }
    setPriorsReady(true);
  }, []);
  useEffect(() => {
    loadPriors();
  }, [loadPriors]);

  /** A fresh seed that clears the structural gate; the perceptual gate follows once it has rendered. */
  const roll = useCallback(() => {
    rollId.current++;
    const next = rollClear(priorsRef.current);
    setSeed(next.seed);
    setToken(next.token);
    setMintedId(null);
    setNote("");
    setPhase(IS_DEMO ? "ready" : "checking");
  }, []);

  // first roll waits for the priors so the opening Form is one that could actually mint
  useEffect(() => {
    if (priorsReady && !seed) roll();
  }, [priorsReady, seed, roll]);

  // Perceptual gate: fingerprint the live render and ask the approver (dry run).
  // Rerolls silently on a collision, which is rare but real against a full set.
  useEffect(() => {
    if (phase !== "checking" || !token || !seed || !engineRef.current) return;
    const mine = rollId.current;
    const engine = engineRef.current;
    const timer = setTimeout(async () => {
      try {
        const grid = engine.fingerprint(capturePose(token));
        engine.redraw();
        const minter = address ?? "0x0000000000000000000000000000000000000001";
        const ok = await approve(seed, minter, hashToHex(dHash(grid)), true);
        if (mine !== rollId.current) return;
        if (ok) setPhase("ready");
        else roll();
      } catch (e) {
        if (mine !== rollId.current) return;
        setNote(e instanceof Error ? e.message : String(e));
        setPhase("ready");
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [phase, token, seed, address, roll]);

  // ── the mint ──────────────────────────────────────────────────────────────
  const mint = useCallback(async () => {
    if (!seed || !address || phase !== "ready") return;
    reset();
    setNote("");
    if (wrongChain) {
      try {
        await switchChainAsync({ chainId: activeChain.id });
      } catch {
        return;
      }
    }
    setPhase("approving");
    try {
      const grid = engineRef.current?.fingerprint(capturePose(token!));
      engineRef.current?.redraw();
      const approval = await approve(seed, address, grid ? hashToHex(dHash(grid)) : null, false);
      if (!approval || approval === true) {
        // someone minted something too close while this was on screen
        setNote("That one just stopped being unique. Here is another.");
        roll();
        return;
      }
      setPhase("minting");
      await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CSE_ABI,
        functionName: "mint",
        args: [seed, approval.deadline, approval.signature],
        value: price,
        chainId: activeChain.id,
      });
    } catch (e) {
      setPhase("ready");
      if (blind) setBlind(false);
      const friendly = describeTxError(e as Error);
      setNote(friendly.title + (friendly.detail ? ` ${friendly.detail}` : ""));
    }
  }, [seed, address, phase, wrongChain, switchChainAsync, reset, token, price, writeContractAsync, roll, blind]);

  // blind mint: the moment the hidden roll is clear, send it
  useEffect(() => {
    if (blind && phase === "ready" && isConnected && isLive) void mint();
  }, [blind, phase, isConnected, isLive, mint]);

  // landed: read the id off the Minted event, lift the cover, refresh the set
  useEffect(() => {
    if (!isSuccess || !receipt) return;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: CSE_ABI, data: log.data, topics: log.topics });
        if (ev.eventName === "Minted") setMintedId(Number(ev.args.tokenId));
      } catch {
        // not ours
      }
    }
    setPhase("minted");
    setBlind(false);
    refetch();
    loadPriors(true);
  }, [isSuccess, receipt, refetch, loadPriors]);

  const shown = useMemo(() => (token ? tokenSummary(token) : null), [token]);
  const gasHeadroom = parseEther("0.0004");
  const shortOfFunds = isConnected && balance !== undefined && balance.value < price + gasHeadroom;
  const friendly = error ? describeTxError(error) : null;
  const busy = phase === "approving" || phase === "minting" || confirming;
  const canMint = isLive && isConnected && phase === "ready" && !soldOut && walletRemaining > 0 && !shortOfFunds;

  return (
    <div className="panel">
      <div className="panel-head">
        <span>{isLive ? "Mint" : "The collection"}</span>
        <span className="mint-state">
          mint:{" "}
          <span className={`badge ${label === "LIVE" ? "live" : label === "SOLD_OUT" ? "sold" : "closed"}`}>
            {isLive ? "open" : "closed"}
          </span>
        </span>
      </div>

      {token && shown ? (
        <div className={`mint-stage${blind ? " blind" : ""}`}>
          <ArtViewer
            token={token}
            caption={mintedId ? `CSE #${pad(mintedId)} · ${shown.traits.structure}` : `unminted · ${shown.traits.structure}`}
            onEngine={(e) => (engineRef.current = e)}
          >
            <dl className="kv">
              <dt>Equation</dt>
              <dd>{shown.equation}</dd>
              <dt>Depressed</dt>
              <dd>{shown.depressed}</dd>
              <dt>Δ</dt>
              <dd>{shown.discriminant.toFixed(3)}</dd>
            </dl>
          </ArtViewer>
          {blind && (
            <div className="mint-blind">
              <span className="mono-label">rolling in the dark</span>
              <span>{busy ? "minting…" : phase === "checking" ? "checking it's one of a kind…" : "confirm in your wallet"}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="solving">
          <span className="mono-label">Solving…</span>
        </div>
      )}

      <div className="panel-body">
        <dl className="kv">
          <dt>Form</dt>
          <dd>
            {mintedId ? (
              <span style={{ color: "var(--accent)" }}>#{pad(mintedId)} · yours</span>
            ) : phase === "checking" ? (
              <span className="muted">checking it&rsquo;s one of a kind…</span>
            ) : phase === "ready" && !IS_DEMO ? (
              <span style={{ color: "var(--accent)" }}>unique · unminted</span>
            ) : (
              "unminted"
            )}
          </dd>
          <dt>Equation</dt>
          <dd>{blind ? "hidden" : (shown?.equation ?? "—")}</dd>
          <dt>Structure</dt>
          <dd>
            {blind
              ? "hidden"
              : shown
                ? `${shown.traits.structure} · ${shown.traits.rootState} · ω${shown.traits.phase}`
                : "—"}
          </dd>
        </dl>

        <div className="mint-actions">
          <button
            onClick={() => {
              setBlind(false);
              roll();
            }}
            disabled={busy || soldOut}
            title="Roll a fresh equation nobody has minted"
          >
            Solve again ⟳
          </button>
          {isLive && (
            <button
              onClick={() => {
                if (!isConnected) return setPicking(true);
                setBlind(true);
                roll();
              }}
              disabled={busy || soldOut || walletRemaining === 0}
              title="Mint the next clear roll without seeing it first"
            >
              Surprise me
            </button>
          )}
        </div>

        {!isLive && (
          <p className="mint-note">
            {IS_DEMO
              ? "Mint opens mid October, check back then. Till then it's the real renderer rolling real Forms, so solve away."
              : label === "SOLD_OUT"
                ? "The mint has closed. Every Form is in the gallery."
                : "The mint has not opened. This is the real renderer rolling real Forms."}
          </p>
        )}

        {isLive && (
          <div style={{ marginTop: 14 }}>
            <dl className="kv">
              <dt>You mint</dt>
              <dd style={{ color: "var(--accent)" }}>{blind ? "the one under the cover" : "this one, exactly"}</dd>
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
              <button className="primary" style={{ width: "100%", marginTop: 12 }} onClick={() => setPicking(true)}>
                Connect wallet
              </button>
            ) : (
              <>
                <button className="primary" style={{ width: "100%", marginTop: 12 }} disabled={!canMint || busy} onClick={mint}>
                  {soldOut
                    ? "Sold out"
                    : walletRemaining === 0
                      ? "Wallet limit reached"
                      : shortOfFunds
                        ? "Not enough ETH"
                        : phase === "checking"
                          ? "Checking…"
                          : phase === "approving"
                            ? "Approving…"
                            : switching
                              ? `Switching to ${activeChain.name}…`
                              : wrongChain
                                ? `Switch to ${activeChain.name} & mint`
                                : phase === "minting" && !confirming
                                  ? "Confirm in wallet…"
                                  : confirming
                                    ? "Minting…"
                                    : `Mint this one · ${formatEther(price)} ETH`}
                </button>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--ink-faint)" }}>
                  <span>{address ? short(address) : ""}</span>
                  <button style={{ border: 0, padding: 0, fontSize: 10 }} onClick={() => disconnect()}>
                    Disconnect
                  </button>
                </div>
              </>
            )}

            {wrongChain && (
              <div className="status warn">
                Your wallet is on chain {walletChainId}. This collection lives on {activeChain.name} ({activeChain.id}).
                Minting will switch it for you.
              </div>
            )}
            {shortOfFunds && !friendly && (
              <div className="status warn">
                Not enough ETH. You have {formatEther(balance!.value).slice(0, 8)} {balance!.symbol}; this costs{" "}
                {formatEther(price)} plus gas.
              </div>
            )}
            {note && <div className="status warn">{note}</div>}
            {isSuccess && mintedId && (
              <div className="status ok">
                Minted #{pad(mintedId)}. Find it in <a href="/output">output</a>, or load it in the{" "}
                <a href="/">lab</a>.
              </div>
            )}
            {friendly && !note && (
              <div className={`status ${friendly.benign ? "warn" : "err"}`}>
                <strong>{friendly.title}</strong>
                {friendly.detail && <div className="status-detail">{friendly.detail}</div>}
              </div>
            )}
          </div>
        )}
      </div>
      <ConnectModal open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}
