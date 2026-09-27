/**
 * Pairwise structural-distance probe for the uniqueness gate.
 *
 *   pnpm --filter @cse/generator distances [supply]
 *
 * Derivation only, so it measures the *candidate* pool the gate sees rather
 * than the accepted set. Prints the low tail of the distance distribution and
 * the rejection rate each candidate threshold implies against a full index —
 * which is the number that decides whether a run can finish, not the distance.
 */

import "./env.js";
import { deriveToken, l2, structuralVector } from "@cse/core";

const N = Number(process.argv[2] ?? 512);
const seed = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";

const vectors: number[][] = [];
const forms: string[] = [];
for (let id = 1; id <= N; id++) {
  const t = deriveToken(seed, id);
  vectors.push(structuralVector(t));
  forms.push(t.traits.structure);
}

const dists: number[] = [];
const same: number[] = [];
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    const d = l2(vectors[i], vectors[j]);
    dists.push(d);
    if (forms[i] === forms[j]) same.push(d);
  }
}
dists.sort((a, b) => a - b);
same.sort((a, b) => a - b);

const q = (p: number) => dists[Math.min(dists.length - 1, Math.floor(p * dists.length))];

console.log(`${N} tokens, ${dists.length} pairs\n`);
console.log("distance percentiles");
for (const p of [0, 0.0001, 0.001, 0.005, 0.01, 0.05, 0.5]) {
  console.log(`  p${(p * 100).toFixed(2).padStart(6)}  ${q(p).toFixed(3)}`);
}

// The pairs that actually produce the "these two look the same" complaint. A
// cross-archetype pair is separated by 10 per index step and can never be close;
// the global percentiles above are dominated by those and say almost nothing.
const sq = (p: number) => same[Math.min(same.length - 1, Math.floor(p * same.length))];
const perForm = Math.round(N / 22);
console.log(`\nsame-archetype pairs only: ${same.length} (~${perForm} tokens per form)`);
for (const p of [0, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5]) {
  console.log(`  p${(p * 100).toFixed(1).padStart(5)}  ${sq(p).toFixed(3)}`);
}
console.log(
  `  share of same-form pairs under the current 0.45: ` +
    `${((same.filter((d) => d < 0.45).length / same.length) * 100).toFixed(2)}%`,
);

console.log("\nthreshold -> share of pairs below -> implied rejection rate vs a full index");
for (const t of [0.35, 0.45, 0.55, 0.7, 0.9, 1.2, 1.6, 2.0]) {
  const below = dists.filter((d) => d < t).length / dists.length;
  // a candidate is rejected if it collides with any one of N-1 priors
  const reject = 1 - (1 - below) ** (N - 1);
  console.log(
    `  ${t.toFixed(2)}   ${(below * 100).toFixed(3).padStart(7)}%   ${(reject * 100).toFixed(1).padStart(5)}%`,
  );
}
