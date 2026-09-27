/**
 * Token derivation: seed -> coefficients -> solution -> traits + drivers.
 *
 * Coefficient ranges are constrained rather than uniform over a wide interval,
 * which is where the natural rarity comes from: extreme |a| or |b| is simply
 * unlikely, and the degenerate cases are injected on purpose because floating
 * point will never land on discriminant = 0 by chance.
 */

import { cx } from "./complex.js";
import { type Rng, rngFromHex, sha256Hex, tokenSeed } from "./hash.js";
import { ARCHETYPES } from "./traits.js";
import {
  type Branch,
  type Cubic,
  type Solution,
  formatCubic,
  fromRoots,
  solve,
} from "./solve.js";
import {
  type Drivers,
  type Traits,
  attributesOf,
  deriveDrivers,
  deriveTraits,
} from "./traits.js";

/**
 * Share of the supply built root-first to guarantee exact repeated roots.
 *
 * This is the one class frequency the collection controls. Random real cubics
 * land on discriminant = 0 about 3% of the time in principle and never in
 * floating point, so the Merged tier has to be injected — and at 512 tokens a
 * 4.5% injection left the four Merged archetypes sharing ~21 tokens, thin
 * enough that trial master seeds regularly dropped one of them to zero. At 0.08
 * the tier holds ~9% of the finished supply, twelve to fifteen tokens per Merged
 * form. It is still the rarest tier by a wide margin.
 */
export const DEGENERATE_RATE = 0.08;
/** Of those, the share that collapses all three roots onto one point. */
export const TRIPLE_RATE = 0.25;

export interface Token {
  tokenId: number;
  seed: string;
  nonce: number;
  cubic: Cubic;
  solution: Solution;
  traits: Traits;
  drivers: Drivers;
  /** True when the coefficients were built from chosen roots (the rare tier). */
  degenerate: boolean;
  equation: string;
}

/**
 * Triangular-ish sampling: the average of two uniforms concentrates mass in the
 * middle of the range, so mid coefficients are common and the extremes — which
 * produce the most violent geometry — stay rare without any explicit weighting.
 */
function centred(rng: Rng, lo: number, hi: number): number {
  const t = (rng.next() + rng.next()) / 2;
  return lo + t * (hi - lo);
}

function sampleGeneric(rng: Rng): Cubic {
  return {
    a: centred(rng, -9, 9),
    b: centred(rng, -14, 14),
    c: centred(rng, -16, 16),
  };
}

/**
 * Build coefficients from chosen roots so the discriminant is exactly zero.
 * A double root gives Symmetry "Transposed"; a triple root gives "Full S3".
 */
function sampleDegenerate(rng: Rng): Cubic {
  const r = Math.round(centred(rng, -4, 4) * 4) / 4;
  if (rng.chance(TRIPLE_RATE)) {
    return fromRoots(cx(r), cx(r), cx(r));
  }
  let s = Math.round(centred(rng, -4, 4) * 4) / 4;
  if (s === r) s = r + 1;
  return fromRoots(cx(r), cx(r), cx(s));
}

export function deriveToken(masterSeed: string, tokenId: number, nonce = 0): Token {
  const seed = tokenSeed(masterSeed, tokenId, nonce);
  const rng = rngFromHex(seed);
  const degenerate = rng.chance(DEGENERATE_RATE);
  const cubic = degenerate ? sampleDegenerate(rng) : sampleGeneric(rng);
  const branch = rng.int(0, 2) as Branch;
  const solution = solve(cubic, branch);
  return {
    tokenId,
    seed,
    nonce,
    cubic,
    solution,
    traits: deriveTraits(solution),
    drivers: deriveDrivers(solution),
    degenerate,
    equation: formatCubic(cubic),
  };
}

/**
 * A Token from coefficients you choose rather than from a seed.
 *
 * The collection's own path is `(masterSeed, id, nonce) -> coefficients`, and
 * nothing may change that. This is the inverse door, for the interactive figures
 * on the maths page: hand it a cubic and it runs the identical solve, traits and
 * drivers, so what those figures draw is the real pipeline rather than a
 * lookalike.
 *
 * `tokenId` is 0 and the seed is a hash of the coefficients — the RNG stream
 * still has to come from somewhere (Cascade draws from it), and deriving it from
 * the inputs keeps the figure reproducible as you drag a slider back and forth.
 */
export function tokenFromCubic(cubic: Cubic, branch: Branch = 0): Token {
  const solution = solve(cubic, branch);
  return {
    tokenId: 0,
    seed: sha256Hex(`lab:${cubic.a}:${cubic.b}:${cubic.c}:${branch}`),
    nonce: 0,
    cubic,
    solution,
    traits: deriveTraits(solution),
    drivers: deriveDrivers(solution),
    degenerate: Math.abs(solution.discriminant) <= 1e-9,
    equation: formatCubic(cubic),
  };
}

/**
 * Structural fingerprint used by the uniqueness gate. Components are scaled so
 * that a change of archetype dominates any amount of continuous drift — two
 * tokens are only "close" if they would actually read the same at thumbnail
 * size.
 */
export function structuralVector(token: Token): number[] {
  const { solution: s, traits: t, drivers: d } = token;
  const pts = d.rootPoints.flat();
  return [
    ARCHETYPES.indexOf(t.structure) * 10,
    ["Separated", "Fractured", "Merged"].indexOf(t.discriminantClass) * 6,
    ["3 Real Distinct", "1 Real 2 Complex", "Double Root", "Triple Root"].indexOf(t.rootState) * 6,
    t.phase * 4,
    ["Identity", "Cyclic ω", "Cyclic ω²", "Transposed", "Full S₃"].indexOf(t.symmetry) * 3,
    d.discEnergy * 3,
    d.pqRatio * 3,
    // Both drive visible composition, so two pieces that differ only in these
    // are genuinely different pieces and the gate has to see it.
    d.energy * 3,
    d.resonance * 3,
    Math.cos(d.phaseAngle) * 2,
    Math.sin(d.phaseAngle) * 2,
    d.scale,
    d.density / 100,
    d.curvature,
    Math.tanh(d.shift / 3),
    Math.tanh(s.p / 10),
    Math.tanh(s.q / 10),
    ...pts,
  ];
}

export function l2(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Everything the metadata and the UI need, without the heavy solution object. */
export function tokenSummary(token: Token) {
  const { solution: s } = token;
  return {
    tokenId: token.tokenId,
    seed: token.seed,
    nonce: token.nonce,
    equation: token.equation,
    depressed: `y³ ${s.p < 0 ? "-" : "+"} ${Math.abs(s.p).toFixed(3)}y ${s.q < 0 ? "-" : "+"} ${Math.abs(s.q).toFixed(3)}`,
    coefficients: { a: s.a, b: s.b, c: s.c },
    p: s.p,
    q: s.q,
    shift: s.shift,
    discriminant: s.discriminant,
    roots: s.roots.map((r) => ({ re: r.re, im: r.im })),
    depressedRoots: s.depressedRoots.map((r) => ({ re: r.re, im: r.im })),
    resolvent: { re: s.A.re, im: s.A.im },
    phase: s.phase,
    phaseAngle: s.phaseAngle,
    permutation: s.permutation,
    parity: s.parity,
    degenerate: token.degenerate,
    traits: {
      structure: token.traits.structure,
      rootState: token.traits.rootState,
      symmetry: token.traits.symmetry,
      discriminantClass: token.traits.discriminantClass,
      discriminantBand: token.traits.discriminantBand,
      phase: token.traits.phase,
      energyBand: token.traits.energyBand,
      feedbackBand: token.traits.feedbackBand,
      palette: token.traits.palette.name,
    },
    attributes: attributesOf(token.traits),
  };
}

export type TokenSummary = ReturnType<typeof tokenSummary>;
