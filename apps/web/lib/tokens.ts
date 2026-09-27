"use client";

import { useEffect, useState } from "react";
import { tokensIndexUrl } from "./config";

export interface TokenRow {
  tokenId: number;
  seed: string;
  /**
   * The rejection nonce the generator settled on. Critical: a token that failed
   * a uniqueness gate was re-derived under a bumped nonce, so deriving it at
   * nonce 0 produces different art than was actually minted.
   */
  nonce?: number;
  equation: string;
  discriminant: number;
  degenerate: boolean;
  rarityRank: number;
  traits: {
    structure: string;
    rootState: string;
    symmetry: string;
    discriminantClass: string;
    discriminantBand: string;
    energyBand: string;
    feedbackBand: string;
    phase: number;
    palette: string;
  };
}

let cache: Promise<TokenRow[]> | null = null;

/** Fetch the generator's token index once per page load. */
export function loadTokenIndex(): Promise<TokenRow[]> {
  if (!cache) {
    cache = fetch(tokensIndexUrl())
      .then((r) => {
        if (!r.ok) throw new Error(`token index unavailable (${r.status})`);
        return r.json();
      })
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

/** The nonce a token was published with, defaulting to 0 when unknown. */
export function nonceFor(index: TokenIndex, tokenId: number): number {
  return index.byId.get(tokenId)?.nonce ?? 0;
}
