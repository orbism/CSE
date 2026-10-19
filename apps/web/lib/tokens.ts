"use client";

import { useEffect, useState } from "react";
import { type Token, type Traits, tokenFromSeed } from "@cse/core";

/**
 * The minted Forms, derived in the browser from the seeds the contract holds.
 * `/api/tokens` is one read of `seedOf` per token behind a short edge cache;
 * everything else (traits, equation, the art) follows from the seed.
 */
export interface TokenRow {
  tokenId: number;
  /** 0x-prefixed, 32 bytes. */
  seed: `0x${string}`;
  traits: Omit<Traits, "palette"> & { palette: string };
  equation: string;
  /** Known only after the sell-out reveal, when the whole set exists to rank. */
  rarityRank?: number;
}

export const rowOf = (token: Token, seed: `0x${string}`): TokenRow => ({
  tokenId: token.tokenId,
  seed,
  traits: { ...token.traits, palette: token.traits.palette.name },
  equation: token.equation,
});

let cache: Promise<TokenRow[]> | null = null;

/** Fetch and derive once per page load; `refresh` forgets the cache so a fresh mint shows up. */
export function loadTokenIndex(refresh = false): Promise<TokenRow[]> {
  if (refresh) cache = null;
  if (!cache) {
    cache = fetch("/api/tokens")
      .then((r) => {
        if (!r.ok) throw new Error(`token index unavailable (${r.status})`);
        return r.json() as Promise<{ tokens: { id: number; seed: `0x${string}` }[] }>;
      })
      .then((b) => b.tokens.map((t) => rowOf(tokenFromSeed(t.seed, t.id), t.seed)))
      .catch((e) => {
        cache = null;
        throw e;
      });
  }
  return cache;
}

export interface TokenIndex {
  rows: TokenRow[] | null;
  byId: Map<number, TokenRow>;
  error: string | null;
}

export function useTokenIndex(): TokenIndex {
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadTokenIndex()
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      live = false;
    };
  }, []);

  const byId = new Map<number, TokenRow>();
  for (const r of rows ?? []) byId.set(r.tokenId, r);
  return { rows, byId, error };
}
