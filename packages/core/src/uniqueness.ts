/**
 * Uniqueness: the rules a candidate Form has to clear against every minted one.
 *
 * Shared by the site (rolling and approving seeds), the mint watcher (which
 * fingerprints each mint for the index the approver reads) and the generator's
 * tooling, so all three agree on what "too close" means.
 *
 * Two independent gates, because either alone lets duplicates through:
 *  - structural: the derived mathematics, as `structuralVector`. Catches
 *    tokens built the same way even when lighting or pose would hide it.
 *  - perceptual: a 496-bit hash of the rendered 16x16 intensity grid. Catches
 *    tokens whose maths differs but whose rendered form does not.
 */

import type { Token } from "./token.js";
import { l2, structuralVector } from "./token.js";

/**
 * Minimum L2 distance between two tokens' structural vectors. Calibrated on a
 * 512-token pool: the 0.1st percentile sits at 0.457 and exact collisions do
 * occur, so this sits just below that percentile.
 */
export const STRUCTURAL_THRESHOLD = 0.45;

/**
 * Minimum structural distance between two tokens *of the same archetype*. The
 * archetype index is scaled by 10 in the vector, so the global threshold never
 * binds across forms; within a form 1.0 catches roughly the closest 6.5% of
 * pairs, which is the "these two are the same shape" tail.
 */
export const SAME_FORM_THRESHOLD = 1.0;

/** Bits in the combined perceptual hash: 240 gradient + 256 occupancy. */
export const PHASH_BITS = 496;

/**
 * Minimum Hamming distance between two perceptual hashes. The 0.1st percentile
 * of a 260-token sample; every pair under 16 was a genuine look-alike.
 */
export const PHASH_THRESHOLD = 32;

const N = 16;

/**
 * Perceptual hash over the renderer's 16x16 intensity grid: 240 gradient bits
 * (each cell against its right neighbour) plus 256 occupancy bits (each cell
 * against the mean), as a hex string so it survives JSON.
 */
export function dHash(grid: ArrayLike<number>): bigint {
  let bits = 0n;
  let n = 0n;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N - 1; x++) {
      if (grid[y * N + x] > grid[y * N + x + 1]) bits |= 1n << n;
      n++;
    }
  }
  let sum = 0;
  for (let i = 0; i < N * N; i++) sum += grid[i];
  const mean = sum / (N * N);
  for (let i = 0; i < N * N; i++) {
    if (grid[i] > mean) bits |= 1n << n;
    n++;
  }
  return bits;
}

export const hashToHex = (h: bigint) => h.toString(16).padStart(PHASH_BITS / 4, "0");
export const hashFromHex = (s: string) => BigInt(`0x${s}`);

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/**
 * The pose a Form is fingerprinted and covered at: a function of the seed
 * alone, so the site, the watcher and the approver all look at the same frame.
 */
export function capturePose(token: Token): number {
  return (token.solution.phaseAngle * 2.5 + (parseInt(token.seed.slice(0, 2), 16) % 7) * 0.31) % 12;
}

/** What the approver keeps about each minted Form. */
export interface Prior {
  tokenId: number;
  structure: string;
  vector: number[];
  /** Hex perceptual hash; absent until the watcher has rendered the token. */
  hash?: string;
}

export interface Collision {
  reason: "structural" | "perceptual";
  against: number;
  distance: number;
}

export const priorOf = (token: Token, hash?: bigint): Prior => ({
  tokenId: token.tokenId,
  structure: token.traits.structure,
  vector: structuralVector(token),
  ...(hash !== undefined ? { hash: hashToHex(hash) } : {}),
});

/** The first prior a candidate lands too close to, or null when it is clear. */
export function collision(token: Token, hash: bigint | null, priors: Iterable<Prior>): Collision | null {
  const vector = structuralVector(token);
  for (const prior of priors) {
    const d = l2(vector, prior.vector);
    const limit = prior.structure === token.traits.structure ? SAME_FORM_THRESHOLD : STRUCTURAL_THRESHOLD;
    if (d < limit) return { reason: "structural", against: prior.tokenId, distance: d };
    if (hash !== null && prior.hash) {
      const h = hamming(hash, hashFromHex(prior.hash));
      if (h < PHASH_THRESHOLD) return { reason: "perceptual", against: prior.tokenId, distance: h };
    }
  }
  return null;
}
