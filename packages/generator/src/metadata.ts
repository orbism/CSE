/**
 * Metadata assembly and rarity ranking.
 *
 * Rarity is measured, not assigned: trait frequencies are counted across the
 * finished supply and each token scored by the sum of the inverse frequencies
 * of the traits it carries. Constrained coefficient sampling and the reserved
 * degenerate cases are what actually make some traits scarce.
 */

import { type Token, type TokenSummary, attributesOf, tokenSummary } from "@cse/core";

export interface Metadata {
  name: string;
  description: string;
  image: string;
  animation_url: string;
  external_url?: string;
  attributes: { trait_type: string; value: string | number }[];
  /** Everything needed to re-derive and verify the piece from scratch. */
  cse: TokenSummary & { rarityScore: number; rarityRank: number };
}

const DESCRIPTION =
  "One cubic equation, rendered as form. The three roots become the primary " +
  "bodies, the discriminant decides whether they separate, fracture or merge, " +
  "and the cube-root branch rotates the whole triad by a third of a turn. " +
  "Everything you see is derived from the algebra — nothing is decoration.";

/** Trait axes counted for rarity. Uses the full six, not the trimmed attribute list. */
function traitPairs(token: Token): [string, string][] {
  const t = token.traits;
  return [
    ["Structure", t.structure],
    ["Root State", t.rootState],
    ["Symmetry", t.symmetry],
    ["Discriminant Class", t.discriminantClass],
    ["Discriminant Band", t.discriminantBand],
    ["Phase", `ω${t.phase}`],
    ["Energy", t.energyBand],
    ["Feedback", t.feedbackBand],
    ["Palette", t.palette.name],
  ];
}

export type TraitCounts = Record<string, Record<string, number>>;

export function countTraits(tokens: Token[]): TraitCounts {
  const counts: TraitCounts = {};
  for (const token of tokens) {
    for (const [axis, value] of traitPairs(token)) {
      (counts[axis] ??= {})[value] = (counts[axis]?.[value] ?? 0) + 1;
    }
  }
  return counts;
}

/** Sum of inverse trait frequencies — the standard open-rarity style score. */
export function rarityScore(token: Token, counts: TraitCounts, total: number): number {
  let score = 0;
  for (const [axis, value] of traitPairs(token)) {
    const n = counts[axis]?.[value] ?? 1;
    score += total / n;
  }
  return score;
}

export interface Ranked {
  token: Token;
  score: number;
  rank: number;
}

export function rank(tokens: Token[]): Ranked[] {
  const counts = countTraits(tokens);
  const scored = tokens.map((token) => ({
    token,
    score: rarityScore(token, counts, tokens.length),
  }));
  // rank 1 is rarest; ties broken by token id so the ordering is deterministic
  const order = [...scored].sort((a, b) =>
    b.score - a.score || a.token.tokenId - b.token.tokenId,
  );
  const rankById = new Map<number, number>();
  order.forEach((s, i) => rankById.set(s.token.tokenId, i + 1));
  return scored.map((s) => ({ ...s, rank: rankById.get(s.token.tokenId)! }));
}

export interface UriConfig {
  /** CID of the directory holding <id>.png */
  imagesCID: string;
  /** CID of the directory holding the art bundle's index.html */
  artCID: string;
  masterSeed: string;
  externalUrl?: string;
  /** ipfs:// for production; an http gateway for the localhost loop. */
  scheme?: string;
}

export function buildMetadata(ranked: Ranked, cfg: UriConfig): Metadata {
  const { token, score, rank: rarityRank } = ranked;
  const scheme = cfg.scheme ?? "ipfs://";
  const id = token.tokenId;
  const summary = tokenSummary(token);

  const params = new URLSearchParams({
    tokenId: String(id),
    master: cfg.masterSeed,
    nonce: String(token.nonce),
  });

  return {
    name: `Cubic Symmetry Engine #${String(id).padStart(4, "0")}`,
    description: DESCRIPTION,
    image: `${scheme}${cfg.imagesCID}/${id}.png`,
    animation_url: `${scheme}${cfg.artCID}/index.html?${params.toString()}`,
    ...(cfg.externalUrl ? { external_url: `${cfg.externalUrl}/#/token/${id}` } : {}),
    attributes: [
      ...attributesOf(token.traits),
      { trait_type: "Rarity Rank", value: rarityRank },
    ],
    cse: { ...summary, rarityScore: Number(score.toFixed(4)), rarityRank },
  };
}
