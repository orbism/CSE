/**
 * Distribution probe for the Energy / Feedback axes.
 *
 *   pnpm --filter @cse/generator analyse
 *
 * Derivation only — no rendering — so it can sample far more than the supply
 * and give the band cut points a stable target to be calibrated against.
 */

import "./env.js";
import { deriveToken, energyOf, resonanceOf, energyBandOf, feedbackBandOf } from "@cse/core";

const N = Number(process.argv[2] ?? 5000);
const seed = process.env.CSE_MASTER_SEED ?? "CUBIC-SYMMETRY-ENGINE";

const energies: number[] = [];
const resonances: number[] = [];
const joint = new Map<string, number>();

for (let id = 1; id <= N; id++) {
  const t = deriveToken(seed, id);
  const e = energyOf(t.solution);
  const r = resonanceOf(t.solution);
  energies.push(e);
  resonances.push(r);
  const key = `${energyBandOf(e)} | ${feedbackBandOf(r)}`;
  joint.set(key, (joint.get(key) ?? 0) + 1);
}

const pct = (n: number) => `${((n / N) * 100).toFixed(1)}%`;
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

function describe(label: string, xs: number[]) {
  console.log(`\n${label}`);
  console.log(
    `  min ${q(xs, 0).toFixed(3)}  p10 ${q(xs, 0.1).toFixed(3)}  p50 ${q(xs, 0.5).toFixed(3)}` +
      `  p90 ${q(xs, 0.9).toFixed(3)}  p99 ${q(xs, 0.99).toFixed(3)}  max ${q(xs, 1).toFixed(3)}`,
  );
  console.log(`  mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)}`);
  console.log(`  saturated at 1.0: ${pct(xs.filter((x) => x >= 0.999).length)}`);
}

describe("energy (root magnitude)", energies);
describe("resonance (closest pair)", resonances);

// Pearson correlation — the co-occurrence question is whether these two are
// structurally opposed, not just rare together.
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const me = mean(energies);
const mr = mean(resonances);
let cov = 0;
let ve = 0;
let vr = 0;
for (let i = 0; i < N; i++) {
  const de = energies[i] - me;
  const dr = resonances[i] - mr;
  cov += de * dr;
  ve += de * de;
  vr += dr * dr;
}
console.log(`\ncorrelation(energy, resonance) = ${(cov / Math.sqrt(ve * vr)).toFixed(3)}`);

console.log("\nbands");
const eb = new Map<string, number>();
const fb = new Map<string, number>();
for (const e of energies) eb.set(energyBandOf(e), (eb.get(energyBandOf(e)) ?? 0) + 1);
for (const r of resonances) fb.set(feedbackBandOf(r), (fb.get(feedbackBandOf(r)) ?? 0) + 1);
for (const b of ["Still", "Charged", "Violent"]) console.log(`  Energy ${b.padEnd(9)} ${pct(eb.get(b) ?? 0)}`);
for (const b of ["None", "Echo", "Resonant", "Runaway"]) console.log(`  Feedback ${b.padEnd(9)} ${pct(fb.get(b) ?? 0)}`);

// Cut points that would hit a chosen mass per band, so the bands can be aimed
// at a target distribution instead of at round numbers.
const ENERGY_TARGET = [0.22, 0.43, 0.35]; // Still, Charged, Violent
const FEEDBACK_TARGET = [0.3, 0.28, 0.27, 0.15]; // None, Echo, Resonant, Runaway

function breaksFor(xs: number[], target: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < target.length - 1; i++) {
    acc += target[i];
    out.push(Number(q(xs, acc).toFixed(3)));
  }
  return out;
}

console.log(
  `\nsuggested ENERGY_BREAKS   ${JSON.stringify(breaksFor(energies, ENERGY_TARGET))}` +
    `  for ${ENERGY_TARGET.map((t) => `${(t * 100) | 0}%`).join("/")}`,
);
console.log(
  `suggested FEEDBACK_BREAKS ${JSON.stringify(breaksFor(resonances, FEEDBACK_TARGET))}` +
    `  for ${FEEDBACK_TARGET.map((t) => `${(t * 100) | 0}%`).join("/")}`,
);

console.log("\njoint (energy x feedback)");
for (const e of ["Still", "Charged", "Violent"]) {
  const row = ["None", "Echo", "Resonant", "Runaway"]
    .map((f) => `${f} ${pct(joint.get(`${e} | ${f}`) ?? 0).padStart(6)}`)
    .join("  ");
  console.log(`  ${e.padEnd(8)} ${row}`);
}
