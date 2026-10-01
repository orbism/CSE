"use client";

import { useEffect, useState } from "react";
import { useReadContracts } from "wagmi";
import { CSE_ABI } from "@/lib/abi";
import { CONTRACT_ADDRESS, IS_DEMO, activeChain, provenanceUrl } from "@/lib/config";

interface Published {
  masterSeed: string;
  supply: number;
  hash: string;
  algorithm: string;
  complete: boolean;
}

/**
 * Fetched once per page load, not once per mount.
 *
 * React's StrictMode double-invokes effects in development, which fired this
 * twice and — on a collection generated before provenance existed — logged two
 * 404s for the same missing file. Same approach as `lib/tokens.ts`.
 */
let cache: Promise<Published | null> | null = null;

function loadProvenance(): Promise<Published | null> {
  if (!cache) {
    cache = fetch(provenanceUrl())
      .then((r) => (r.ok ? (r.json() as Promise<Published>) : null))
      .catch(() => null);
  }
  return cache;
}

/**
 * Shows the commitment and lets you check it, rather than asking you to take it
 * on trust.
 *
 * Two independent sources: the value the contract was initialised with, which
 * has no setter, and the value published alongside the art. If they agree, the
 * art you can download is the art that was committed to before the mint opened.
 * If they ever disagree, that is worth knowing, so the mismatch is stated
 * plainly rather than hidden.
 */
export function ProvenanceCheck() {
  const [published, setPublished] = useState<Published | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let live = true;
    loadProvenance().then((p) => {
      if (!live) return;
      if (p) setPublished(p);
      else setFetchError(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const base = { address: CONTRACT_ADDRESS, abi: CSE_ABI, chainId: activeChain.id } as const;
  const { data } = useReadContracts({
    contracts: [
      { ...base, functionName: "provenanceHash" },
      { ...base, functionName: "masterSeed" },
      { ...base, functionName: "metadataFrozen" },
    ],
    query: { enabled: !IS_DEMO },
  });

  const onChainHash = data?.[0]?.result as string | undefined;
  const onChainSeed = data?.[1]?.result as string | undefined;
  const frozen = data?.[2]?.result as boolean | undefined;

  const ZERO = `0x${"0".repeat(64)}`;
  const committed = onChainHash !== undefined && onChainHash !== ZERO;
  const matches =
    committed && published !== null && onChainHash?.toLowerCase() === published.hash.toLowerCase();

  return (
    <div className="provenance">
      <Row label="On chain">
        {IS_DEMO ? (
          <span className="muted">contract not deployed yet</span>
        ) : onChainHash === undefined ? (
          <span className="muted">reading…</span>
        ) : committed ? (
          <code>{onChainHash}</code>
        ) : (
          <span className="muted">not committed on this deployment</span>
        )}
      </Row>
      <Row label="Published">
        {fetchError ? (
          <span className="muted">provenance.json unavailable</span>
        ) : published ? (
          <code>{published.hash}</code>
        ) : (
          <span className="muted">loading…</span>
        )}
      </Row>
      {onChainSeed && (
        <Row label="Master seed">
          <code>{onChainSeed}</code>
        </Row>
      )}
      <Row label="Metadata">
        {IS_DEMO ? (
          <span className="muted">after the mint</span>
        ) : frozen === undefined ? (
          <span className="muted">reading…</span>
        ) : frozen ? (
          <span style={{ color: "var(--accent)" }}>frozen, the base URI can never change</span>
        ) : (
          <span className="muted">not yet frozen</span>
        )}
      </Row>
      {committed && published && (
        <Row label="Check">
          {matches ? (
            <span style={{ color: "var(--accent)" }}>
              match, the published art is the art that was committed to
            </span>
          ) : (
            <span style={{ color: "var(--danger)" }}>
              MISMATCH: the published table doesn't hash to the on-chain commitment
            </span>
          )}
        </Row>
      )}
      {published && (
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {published.algorithm}
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="provenance-row">
      <span className="mono-label">{label}</span>
      <span>{children}</span>
    </div>
  );
}
