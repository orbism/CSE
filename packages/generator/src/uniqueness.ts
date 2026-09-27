/**
 * Uniqueness enforcement.
 *
 * Two independent gates, because either alone lets duplicates through:
 *
 *  - the structural gate compares the derived mathematics. It catches tokens
 *    that would be built the same way even if lighting or pose hid it.
 *  - the perceptual gate compares what the piece actually looks like. It
 *    catches tokens whose maths differs but whose rendered form does not —
 *    which is the case that matters for the thumbnail-legibility rule.
 *
 * A token failing either gate is re-derived under a bumped nonce.
 */

import { type Token, l2, structuralVector } from "@cse/core";

/**
 * Minimum L2 distance between two tokens' structural vectors.
 *
 * Calibrated against the measured pairwise distribution over the full supply:
 * the 0.1st percentile sits at 0.457 and exact collisions do occur (two
 * degenerate tokens can be built from the same quantised roots), so this sits
 * just below the 0.1st percentile — above the duplicate floor, without
 * rejecting merely-similar pieces.
 *
 * A threshold is not free. It has to be read as a rejection *rate*, not just as
 * a distance: 0.151% of pairs fall below 0.55, which sounds negligible but means
 * a candidate compared against a full 511-token index is rejected 54% of the
 * time. Combined with the perceptual gate that left the tail of the run
 * unsatisfiable, and a token near the end exhausted all 24 nonces. At 0.45 the
 * rate is 38%, which the attempt budget absorbs comfortably.
 */
export const STRUCTURAL_THRESHOLD = 0.45;

/**
 * Minimum structural distance between two tokens *of the same archetype*.
 *
 * One global threshold conflates two regimes that are nowhere near each other.
 * `structuralVector` scales the archetype index by 10, so any two tokens of
 * different forms start at least 10 apart and a 0.45 cut can never bind on them.
 * It only ever bites on same-form pairs — and there it was set far too low to
 * matter. Measured over a 512-token candidate pool: same-form pairs have a
 * median distance of 6.19, but 5% of them sit under 0.88 and 10% under 1.29,
 * while 0.45 caught just 1.29%. Some 380 near-identical same-form pairs were
 * passing the gate, which is exactly the "these two are the same shape" case.
 *
 * 1.0 catches roughly the closest 6.5% of same-form pairs. Against the ~23
 * priors a form holds at 512 supply that implies a ~77% rejection rate, which
 * looks alarming and is not: pass 1 rejects on the 16x16 fingerprint, not on a
 * 3000px render, and a re-roll usually lands the candidate in a different form
 * altogether. With `maxAttempts` at 64 the chance of exhausting a token is
 * ~3e-8. The expensive render pass still runs exactly once per accepted token.
 */
export const SAME_FORM_THRESHOLD = 1.0;

/** Bits in the combined perceptual hash: 240 gradient + 256 occupancy. */
export const PHASH_BITS = 496;
/**
 * Minimum Hamming distance between two combined hashes.
 *
 * Measured over a 260-token sample (see calibrate.ts): the median pair sits at
 * 113, the 0.1st percentile at 16 and the 0.5th at 30. Every one of the twelve
 * closest pairs is 10 or below and is a genuine look-alike within one archetype,
 * so the duplicate tail ends well before 16.
 *
 * The threshold sits at that 0.1st percentile rather than further out, because
 * what matters at run time is the implied rejection rate against a full index.
 * 0.086% of pairs fall below 16, which rejects ~36% of candidates once 511
 * tokens are on file. At 28 it is 0.45% of pairs and ~90% of candidates — with
 * 24 nonce attempts per token that tail is not satisfiable, and a real run
 * exhausted on token #503. A wider margin does not buy more distinctness here;
 * it just makes the last tokens of the supply unreachable.
 */
export const PHASH_THRESHOLD = 32;

const N = 16;

/**
 * Perceptual hash over the 16x16 intensity grid the renderer returns.
 *
 * Two complementary halves, because neither alone is sufficient for this art:
 *
 *  - gradient (dHash): each cell against its right neighbour, 15 per row over
 *    16 rows = 240 bits. Captures internal structure, ignores brightness.
 *  - occupancy: each cell against the grid mean, 256 bits. Captures the
 *    silhouette, which is what actually distinguishes sparse compositions —
 *    a gradient hash alone ties everywhere on an empty background.
 *
 * An earlier version stopped at 64 bits, which covered only the top four rows
 * of the grid. Those rows are nearly always empty sky, so almost every token
 * hashed identically and the gate rejected three quarters of the supply.
 */
export function dHash(grid: number[]): bigint {
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

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - 1n;
    count++;
  }
  return count;
}

export interface Accepted {
  token: Token;
  vector: number[];
  hash: bigint;
}

export interface ClosePair {
  a: number;
  b: number;
  structural: number;
  perceptual: number;
  /** The shared archetype, when both tokens are the same form. */
  form: string | null;
}

export type RejectReason = "structural" | "perceptual";

export interface Rejection {
  tokenId: number;
  nonce: number;
  reason: RejectReason;
  /** The already-accepted token it collided with. */
  against: number;
  distance: number;
}

export class UniquenessIndex {
  private readonly accepted: Accepted[] = [];
  readonly rejections: Rejection[] = [];

  get size(): number {
    return this.accepted.length;
  }

  /**
   * Check a candidate against everything accepted so far. Returns null when the
   * candidate is unique, or the rejection that blocked it.
   */
  check(token: Token, hash: bigint): Rejection | null {
    const vector = structuralVector(token);

    for (const prior of this.accepted) {
      const d = l2(vector, prior.vector);
      const limit =
        prior.token.traits.structure === token.traits.structure
          ? SAME_FORM_THRESHOLD
          : STRUCTURAL_THRESHOLD;
      if (d < limit) {
        return {
          tokenId: token.tokenId,
          nonce: token.nonce,
          reason: "structural",
          against: prior.token.tokenId,
          distance: d,
        };
      }
    }

    for (const prior of this.accepted) {
      const d = hamming(hash, prior.hash);
      if (d < PHASH_THRESHOLD) {
        return {
          tokenId: token.tokenId,
          nonce: token.nonce,
          reason: "perceptual",
          against: prior.token.tokenId,
          distance: d,
        };
      }
    }

    return null;
  }

  accept(token: Token, hash: bigint) {
    this.accepted.push({ token, vector: structuralVector(token), hash });
  }

  record(rejection: Rejection) {
    this.rejections.push(rejection);
  }

  /**
   * Closest surviving pairs, for the run report.
   *
   * Three separate minima, because one number cannot answer the question. The
   * structural minimum and the perceptual minimum are almost never the same
   * pair: two tokens can be built from very different mathematics and still
   * rasterise to nearly the same silhouette, which is precisely the case the
   * perceptual gate exists to catch.
   *
   * Reporting only the structural minimum and printing *that pair's* hamming —
   * as this did — says nothing about whether any pair looks alike. It reports
   * the look-alike distance of an arbitrary pair that happened to win a
   * different contest.
   */
  closestPairs(): {
    structural: ClosePair | null;
    sameForm: ClosePair | null;
    perceptual: ClosePair | null;
  } {
    let structural: ClosePair | null = null;
    let sameForm: ClosePair | null = null;
    let perceptual: ClosePair | null = null;

    for (let i = 0; i < this.accepted.length; i++) {
      for (let j = i + 1; j < this.accepted.length; j++) {
        const x = this.accepted[i];
        const y = this.accepted[j];
        const pair: ClosePair = {
          a: x.token.tokenId,
          b: y.token.tokenId,
          structural: l2(x.vector, y.vector),
          perceptual: hamming(x.hash, y.hash),
          form: x.token.traits.structure === y.token.traits.structure ? x.token.traits.structure : null,
        };
        if (!structural || pair.structural < structural.structural) structural = pair;
        if (pair.form && (!sameForm || pair.structural < sameForm.structural)) sameForm = pair;
        if (!perceptual || pair.perceptual < perceptual.perceptual) perceptual = pair;
      }
    }
    return { structural, sameForm, perceptual };
  }
}
