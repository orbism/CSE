/**
 * Threshold calibration.
 *
 * Three measured distributions, so the constants that gate a run are set from
 * data rather than guessed. Run after any change to the renderer or to the
 * coefficient sampling.
 *
 *   1. curvature quartiles  -> CURVATURE_BREAKS in core/traits.ts
 *   2. structural distances -> STRUCTURAL_THRESHOLD
 *   3. perceptual distances -> PHASH_THRESHOLD
 *
 * The first two are pure maths and run instantly over the whole supply. Only
 * the third needs the renderer, and it samples.
 *
 * Read every threshold as a rejection *rate*, not as a distance. A cut that
 * excludes a few tenths of a percent of all pairs sounds negligible and is not:
 * a candidate is compared against every token already on file, so 0.45% of pairs
 * means ~90% of candidates rejected once the index is full, and no nonce budget
 * survives that. Each section below prints the implied rate.
 */

// side effect: loads the repo-root .env before any config is read
import "./env.js";
import {
  COLLECTION,
  type DiscriminantClass,
  curvatureOf,
  deriveToken,
  discriminantClass,
  l2,
  structuralVector,
} from "@cse/core";
import { capturePose, fingerprint, openRenderer, selectToken } from "./render.js";
import { PHASH_BITS, dHash, hamming } from "./uniqueness.js";

const MASTER = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";
const SAMPLE = Number(process.argv[2] ?? 200);
const SUPPLY = COLLECTION.supply;

/** Share of candidates a threshold rejects once the whole supply is on file. */
const rejectRate = (pairsBelow: number, totalPairs: number) =>
  `${((1 - (1 - pairsBelow / totalPairs) ** (SUPPLY - 1)) * 100).toFixed(0)}%`;

// ---- 1. curvature quartiles, per discriminant class -------------------------
// Equal-width bins on |c| are badly skewed and skewed differently in each class,
// which starves the archetypes sitting in the thin slots. These are the equal-
// mass breakpoints to paste into CURVATURE_BREAKS.
{
  const byClass: Record<string, number[]> = { Separated: [], Fractured: [], Merged: [] };
  for (let id = 1; id <= SUPPLY; id++) {
    const sol = deriveToken(MASTER, id).solution;
    byClass[discriminantClass(sol.discriminant)].push(curvatureOf(sol));
  }
  console.log("curvature quartile breakpoints (equal mass), for CURVATURE_BREAKS:");
  for (const cls of ["Separated", "Fractured", "Merged"] as DiscriminantClass[]) {
    const v = byClass[cls].sort((a, b) => a - b);
    if (!v.length) continue;
    const at = (p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
    const breaks = [at(0.25), at(0.5), at(0.75)].map((x) => Number(x.toFixed(3)));
    // how equal-width binning would have split the same tokens, for comparison
    const width = [0, 0, 0, 0];
    for (const x of v) width[Math.min(3, Math.floor(x * 4))]++;
    console.log(
      `  ${cls.padEnd(10)} [${breaks.join(", ")}]   ` +
        `n=${String(v.length).padStart(3)}   ` +
        `equal-width would be ${width.map((n) => `${Math.round((100 * n) / v.length)}%`).join("/")}`,
    );
  }
}

// ---- 2. structural distances ------------------------------------------------
{
  const vecs: number[][] = [];
  for (let id = 1; id <= SUPPLY; id++) vecs.push(structuralVector(deriveToken(MASTER, id)));
  const ds: number[] = [];
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++) ds.push(l2(vecs[i], vecs[j]));
  ds.sort((a, b) => a - b);
  const at = (p: number) => ds[Math.floor(ds.length * p)];
  console.log(`\nstructural: ${ds.length} pairs over ${SUPPLY} tokens`);
  console.log(
    `min ${ds[0].toFixed(3)}  p0.1% ${at(0.001).toFixed(3)}  p0.5% ${at(0.005).toFixed(3)}  ` +
      `p1% ${at(0.01).toFixed(3)}  median ${at(0.5).toFixed(3)}`,
  );
  console.log("rejection rate against a full index, for STRUCTURAL_THRESHOLD:");
  for (const t of [0.3, 0.4, 0.45, 0.55, 0.7]) {
    const n = ds.filter((d) => d < t).length;
    console.log(
      `  ${t.toFixed(2)}: ${String(n).padStart(5)} pairs (${((100 * n) / ds.length).toFixed(3)}%)` +
        `  => ~${rejectRate(n, ds.length)} of candidates rejected`,
    );
  }
}

// ---- 3. perceptual distances ------------------------------------------------

const r = await openRenderer(MASTER);
const hashes: { id: number; hash: bigint; structure: string }[] = [];

for (let id = 1; id <= SAMPLE; id++) {
  const token = deriveToken(MASTER, id);
  await selectToken(r.page, MASTER, id, 0);
  const grid = await fingerprint(r.page, capturePose(token.solution.phaseAngle, id));
  hashes.push({ id, hash: dHash(grid), structure: token.traits.structure });
  if (id % 25 === 0) process.stdout.write(`  ${id}/${SAMPLE}\n`);
}
await r.close();

const ds: number[] = [];
const pairs: [number, number, number][] = [];
for (let i = 0; i < hashes.length; i++) {
  for (let j = i + 1; j < hashes.length; j++) {
    const d = hamming(hashes[i].hash, hashes[j].hash);
    ds.push(d);
    pairs.push([d, hashes[i].id, hashes[j].id]);
  }
}
ds.sort((a, b) => a - b);
pairs.sort((a, b) => a[0] - b[0]);

const pct = (p: number) => ds[Math.min(ds.length - 1, Math.floor(ds.length * p))];
console.log(`\nsample ${SAMPLE}, ${ds.length} pairs, ${PHASH_BITS}-bit hash`);
console.log(
  `min ${ds[0]}  p0.1% ${pct(0.001)}  p0.5% ${pct(0.005)}  p1% ${pct(0.01)}  ` +
    `p5% ${pct(0.05)}  median ${pct(0.5)}  max ${ds[ds.length - 1]}`,
);
console.log("\nclosest pairs:");
for (const [d, a, b] of pairs.slice(0, 12)) {
  const sa = hashes.find((h) => h.id === a)!.structure;
  const sb = hashes.find((h) => h.id === b)!.structure;
  console.log(`  ${String(d).padStart(4)}  #${a} (${sa})  vs  #${b} (${sb})`);
}
console.log("\nrejection rate against a full index, for PHASH_THRESHOLD:");
for (const t of [16, 24, 28, 32, 40, 48, 64]) {
  const n = ds.filter((d) => d < t).length;
  console.log(
    `  ${String(t).padStart(3)}: ${String(n).padStart(5)} pairs (${((n / ds.length) * 100).toFixed(3)}%)` +
      `  => ~${rejectRate(n, ds.length)} of candidates rejected`,
  );
}
