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

import {
  type Token,
  PHASH_THRESHOLD,
  SAME_FORM_THRESHOLD,
  STRUCTURAL_THRESHOLD,
  dHash,
  hamming,
  l2,
  structuralVector,
} from "@cse/core";

// The thresholds and hashes live in @cse/core (uniqueness.ts) now, shared with
// the site's approver and the mint watcher; re-exported for the older tooling.
export { PHASH_BITS, PHASH_THRESHOLD, SAME_FORM_THRESHOLD, STRUCTURAL_THRESHOLD, dHash, hamming } from "@cse/core";

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
