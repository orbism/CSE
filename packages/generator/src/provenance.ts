/**
 * The provenance commitment.
 *
 * A Form is a pure function of `(masterSeed, tokenId, nonce)`, and minting takes
 * only token ids, so no two tokens can share a Form — that part needs nothing on
 * chain. What the chain cannot otherwise show is that the art you were sold is
 * the art that was committed to: the nonce lives in `tokens.json`, and the
 * metadata pointer is mutable until it is frozen.
 *
 * So the run publishes one hash over the whole id -> seed table, the deploy puts
 * it in immutable storage, and anyone can recompute it from the collection.
 *
 * The serialisation is deliberately the dullest thing that could work, because a
 * hash nobody can independently reproduce is decoration rather than evidence.
 */

import { keccak256, toHex } from "viem";
import type { Token } from "@cse/core";

/**
 * Exactly how the table is built, carried in the published artefact so the
 * description travels with the number.
 */
export const PROVENANCE_ALGORITHM =
  'keccak256(utf8) of "<tokenId>:<seed>" for every token, ascending by tokenId, ' +
  'joined with "\\n", no trailing newline. tokenId is decimal and unpadded; seed ' +
  "is the 64-character lowercase hex digest as it appears in tokens.json.";

/** The canonical pre-image. Exported so tests and tooling hash the same bytes. */
export function provenanceTable(tokens: { tokenId: number; seed: string }[]): string {
  return [...tokens]
    .sort((a, b) => a.tokenId - b.tokenId)
    .map((t) => `${t.tokenId}:${t.seed}`)
    .join("\n");
}

export function provenanceHash(tokens: { tokenId: number; seed: string }[]): `0x${string}` {
  return keccak256(toHex(provenanceTable(tokens)));
}

export interface Provenance {
  masterSeed: string;
  supply: number;
  hash: `0x${string}`;
  algorithm: string;
  /** Guards against a partial run being committed as if it were the collection. */
  complete: boolean;
}

export function buildProvenance(
  masterSeed: string,
  expectedSupply: number,
  tokens: Token[],
): Provenance {
  return {
    masterSeed,
    supply: tokens.length,
    hash: provenanceHash(tokens),
    algorithm: PROVENANCE_ALGORITHM,
    complete: tokens.length === expectedSupply,
  };
}
