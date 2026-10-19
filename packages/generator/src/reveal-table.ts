import { createHash } from "node:crypto";
import { tokenFromSeed } from "@cse/core";
import { rank } from "./metadata.js";
import { packTraits } from "./traits-pack.js";

/**
 * The sell-out reveal, as pure data: every minted Form from its seed, ranked
 * over the whole set, packed into the renderer's trait table. Anyone can rerun
 * this against the chain and get the same bytes.
 */
export function revealTable(seeds: readonly `0x${string}`[]) {
  const tokens = seeds.map((seed, i) => tokenFromSeed(seed, i + 1));
  const ranked = rank(tokens);
  const traits = packTraits(ranked.map((r) => ({ token: r.token, rarityRank: r.rank })));
  return { traits, sha256: createHash("sha256").update(traits).digest("hex") };
}
