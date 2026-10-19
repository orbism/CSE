"use client";

import { type Prior, type Token, collision, priorOf, tokenFromSeed } from "@cse/core";
import type { TokenRow } from "./tokens";

/** 32 random bytes from the browser's CSPRNG, as the contract's bytes32. */
export function randomSeed(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The minted Forms as the approver sees them, minus the fingerprints (those stay server-side). */
export const priorsOf = (rows: TokenRow[]): Prior[] => rows.map((r) => priorOf(tokenFromSeed(r.seed, r.tokenId)));

/**
 * Roll until a seed clears the structural gate locally. The perceptual gate
 * needs a render, so the caller asks the approver about the survivor; a few
 * dozen tries is far more than the ~40% rejection rate against a full set needs.
 */
export function rollClear(priors: Prior[], tries = 64): { seed: `0x${string}`; token: Token } {
  let seed = randomSeed();
  let token = tokenFromSeed(seed);
  for (let i = 0; i < tries && collision(token, null, priors); i++) {
    seed = randomSeed();
    token = tokenFromSeed(seed);
  }
  return { seed, token };
}

export interface Approval {
  deadline: bigint;
  signature: `0x${string}`;
}

/**
 * Ask the approver. `hash` is the candidate's perceptual fingerprint from the
 * live engine. Returns null when the seed is too close to a minted Form.
 */
export async function approve(
  seed: `0x${string}`,
  minter: `0x${string}`,
  hash: string | null,
  dryRun: boolean,
): Promise<Approval | true | null> {
  const res = await fetch("/api/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed, minter, hash: hash ?? undefined, dryRun }),
  });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `approver ${res.status}`);
  if (dryRun) return true;
  const body = (await res.json()) as { deadline: string; signature: `0x${string}` };
  return { deadline: BigInt(body.deadline), signature: body.signature };
}
