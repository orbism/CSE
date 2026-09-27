/**
 * Trait derivation. Every axis is a pure function of the solved cubic — nothing
 * is rolled independently — so the traits describe the mathematics rather than
 * decorating it.
 */

import { abs, sub } from "./complex.js";
import { PALETTES, type Palette } from "./palettes.js";
import { DEGENERATE_EPS, type RootState, type Solution } from "./solve.js";

/**
 * The 22 composition archetypes. Each is a distinct topology, not a reskin.
 *
 * Append only. `structuralVector` reads `ARCHETYPES.indexOf`, so inserting a
 * name in the middle would shift every later archetype's structural distance
 * and change which tokens the uniqueness gate rejects across the whole supply.
 */
export const ARCHETYPES = [
  "Grid",
  "Radial",
  "Tower",
  "Knot",
  "Void",
  "Tessellation",
  "Exploded",
  "Lattice",
  "Spiral",
  "Shell",
  "Cascade",
  "Orbital",
  "Weave",
  "Bloom",
  "Rift",
  "Strata",
  "Labyrinth",
  "Fold",
  "Prism",
  "Arbor",
  "Vessel",
  "Aperture",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export type DiscriminantClass = "Separated" | "Fractured" | "Merged";
export type Symmetry = "Identity" | "Cyclic ω" | "Cyclic ω²" | "Transposed" | "Full S₃";
export type Band = "Faint" | "Low" | "Mid" | "High" | "Extreme";
export type EnergyBand = "Still" | "Charged" | "Violent";
export type FeedbackBand = "None" | "Echo" | "Resonant" | "Runaway";

export interface Traits {
  structure: Archetype;
  rootState: RootState;
  symmetry: Symmetry;
  discriminantClass: DiscriminantClass;
  discriminantBand: Band;
  phase: 0 | 1 | 2;
  palette: Palette;
  /** How far the roots sit from the origin — see `energyOf`. */
  energyBand: EnergyBand;
  /** How close the nearest pair of roots is — see `resonanceOf`. */
  feedbackBand: FeedbackBand;
}

/**
 * Continuous quantities the art layer reads directly. Kept separate from the
 * displayed traits so the renderer can vary smoothly while traits stay discrete.
 */
export interface Drivers {
  /** Global scale, from |a|. */
  scale: number;
  /** Glyph-grid resolution in cells per side, from |b|. */
  density: number;
  /** Curvature / bend applied to primitives, from |c|. */
  curvature: number;
  /** World translation from the depression shift a/3. */
  shift: number;
  /** log-compressed |discriminant|, 0..1. */
  discEnergy: number;
  /** |p| / (|p| + |q|), the balance between the linear and constant terms. */
  pqRatio: number;
  /** arg(A) in [0, 2*pi). */
  phaseAngle: number;
  /** Root positions in the complex plane, normalised to the unit disc. */
  rootPoints: [number, number][];
  /** Largest root modulus before normalisation. */
  rootSpread: number;
  /**
   * How far the roots actually sit from the origin, 0..1.
   *
   * `rootPoints` is normalised to the unit disc, which throws the absolute
   * magnitude away — two solutions with the same triangle of roots at wildly
   * different scales drew identically. This recovers exactly that discarded
   * quantity and hands it back to the composition.
   */
  energy: number;
  /**
   * How close the two nearest roots are, 0..1.
   *
   * The discriminant is the *product* of all three separations, so it says the
   * roots are collectively spread but not whether two of them are on top of each
   * other. This measures the closest pair directly: at 1 the field has a single
   * sharp shared peak, which is the condition under which the render feeds back
   * on itself hardest.
   */
  resonance: number;
}

const BANDS: Band[] = ["Faint", "Low", "Mid", "High", "Extreme"];

function bandOf(energy: number): Band {
  return BANDS[Math.min(BANDS.length - 1, Math.floor(energy * BANDS.length))];
}

/**
 * Cut points for the two new axes, chosen against the measured distributions so
 * every band is actually populated. Equal-width thresholds put 94% of the supply
 * in one Feedback band and left `Runaway` empty, which is not a trait so much as
 * a label nothing carries.
 *
 * These are equal-*mass* breakpoints against a 20k-token derivation sample,
 * aimed at Still/Charged/Violent = 22/43/35 and None/Echo/Resonant/Runaway =
 * 30/28/27/15. The previous cuts held the top of both axes far too thin — 8.2%
 * Runaway, and the extreme corner of the grid all but empty. Regenerate with
 * `pnpm --filter @cse/generator analyse` after any change to the coefficient
 * sampling, `energyOf` or `resonanceOf`.
 */
const ENERGY_BREAKS: [number, number] = [0.332, 0.508];
const FEEDBACK_BREAKS: [number, number, number] = [0.21, 0.394, 0.672];

export function energyBandOf(energy: number): EnergyBand {
  if (energy < ENERGY_BREAKS[0]) return "Still";
  if (energy < ENERGY_BREAKS[1]) return "Charged";
  return "Violent";
}

export function feedbackBandOf(resonance: number): FeedbackBand {
  if (resonance < FEEDBACK_BREAKS[0]) return "None";
  if (resonance < FEEDBACK_BREAKS[1]) return "Echo";
  if (resonance < FEEDBACK_BREAKS[2]) return "Resonant";
  return "Runaway";
}

export function discriminantClass(disc: number): DiscriminantClass {
  if (Math.abs(disc) <= DEGENERATE_EPS) return "Merged";
  return disc > 0 ? "Separated" : "Fractured";
}

/**
 * The article's point is that fixing a square root and a cube root cuts S3 down
 * to exactly the permutations that pin the roots. Parity and phase together are
 * what survives, so the symmetry trait reads both.
 */
export function symmetryOf(sol: Solution): Symmetry {
  if (sol.rootState === "Triple Root") return "Full S₃";
  if (sol.rootState === "Double Root") return "Transposed";
  if (sol.parity === 1) return "Transposed";
  if (sol.phase === 1) return "Cyclic ω";
  if (sol.phase === 2) return "Cyclic ω²";
  return "Identity";
}

/** log-compressed discriminant magnitude in 0..1. */
export function discEnergy(disc: number): number {
  const m = Math.log10(1 + Math.abs(disc));
  return Math.min(1, m / 6);
}

/**
 * Archetype selection. The discriminant class picks a family, then a
 * coefficient-derived quartile and the phase choose within it.
 *
 * Family sizes are proportional to how often each class actually occurs, which
 * is a fact about random real cubics rather than a free choice: measured over
 * the finished supply the split is Separated 36%, Fractured 55%, Merged 9%.
 * Giving all three families an equal share of the archetypes — the obvious
 * design — would leave the Merged forms sharing a few dozen tokens between them
 * while the Fractured forms took two thirds of the collection, and the piece
 * would read as having only a handful of designs.
 *
 * Sizing each family to its class instead keeps all twenty-two forms present
 * and legible, and leaves the genuinely rare tier genuinely rare rather than
 * effectively unreachable.
 *
 * The quartile comes from the curvature driver (|c|) rather than the p:q
 * balance. Measured across the supply, p:q is badly skewed — 43% of tokens land
 * in a single quartile and only 13% in another — which starved one archetype
 * per family. |c| is better behaved and is independent of the phase, so the
 * `+ phase` rotation smooths it the rest of the way.
 */
const FAMILIES: Record<DiscriminantClass, Archetype[]> = {
  // ~36% of the finished supply over eight forms
  Separated: ["Grid", "Lattice", "Tessellation", "Tower", "Strata", "Labyrinth", "Fold", "Prism"],
  // ~55% over ten, so the commonest class does not dominate the look
  Fractured: [
    "Knot",
    "Exploded",
    "Cascade",
    "Spiral",
    "Shell",
    "Orbital",
    "Weave",
    "Rift",
    "Bloom",
    "Arbor",
  ],
  // ~9% over four: the repeated-root tier stays scarce but visible
  Merged: ["Void", "Radial", "Vessel", "Aperture"],
};

/**
 * Quartile boundaries on the curvature driver, per discriminant class.
 *
 * Binning |c| by equal *width* — `floor(curvature * 4)` — looks neutral and is
 * not: |c| is skewed, and skewed differently in each class, because the sign of
 * the discriminant is itself correlated with the constant term. Measured over
 * the supply, equal-width quartiles put 46/31/11/12 percent of the Separated
 * tokens in the four bins, so a third of that family's twelve selection slots
 * were three times rarer than the rest and the archetypes sitting in them were
 * close to unreachable at 512 tokens.
 *
 * These are equal-*mass* boundaries instead: measured breakpoints that put a
 * quarter of each class in each bin. Regenerate them with
 * `pnpm --filter @cse/generator calibrate` after any change to the coefficient
 * sampling.
 */
const CURVATURE_BREAKS: Record<DiscriminantClass, [number, number, number]> = {
  Separated: [0.128, 0.291, 0.515],
  Fractured: [0.261, 0.505, 0.751],
  Merged: [0.021, 0.188, 0.383],
};

/** Which curvature quartile a solution sits in, 0..3, by measured mass. */
export function curvatureQuartile(sol: Solution): 0 | 1 | 2 | 3 {
  const breaks = CURVATURE_BREAKS[discriminantClass(sol.discriminant)];
  const v = curvatureOf(sol);
  if (v < breaks[0]) return 0;
  if (v < breaks[1]) return 1;
  if (v < breaks[2]) return 2;
  return 3;
}

export function archetypeOf(sol: Solution): Archetype {
  const family = FAMILIES[discriminantClass(sol.discriminant)];
  // 4 quartiles x 3 phases = 12 distinct slots, and the sum spans them
  // contiguously, so every family of up to twelve is fully reachable — the
  // largest family here is ten. Adding the phase alone only spans 0..5 and
  // would leave the back of a ten-member family permanently unused.
  return family[(curvatureQuartile(sol) * 3 + sol.phase) % family.length];
}

/** Curvature driver, from |c|. Shared with `deriveDrivers` so the two agree. */
export function curvatureOf(sol: Solution): number {
  return Math.min(1, Math.abs(sol.c) / 12);
}

/**
 * Energy: the absolute scale of the roots, which the unit-disc normalisation
 * discards. `|a|/3` is the depression shift and already drives translation, so
 * this reads the root magnitudes themselves rather than the coefficients.
 */
export function energyOf(sol: Solution): number {
  const spread = Math.max(...sol.depressedRoots.map(abs));
  return Math.min(1, spread / 6);
}

/**
 * Resonance: how close the nearest pair of roots is, on a log scale because the
 * interesting range is the last decade before they touch.
 *
 * Deliberately not a restatement of the discriminant. Δ is `(α−β)(β−γ)(γ−α)`
 * squared — a product, so one tiny separation can be masked by two large ones.
 * A token can have a perfectly ordinary |Δ| and still have two roots almost on
 * top of each other, and that is the case this picks out.
 *
 * Measured two ways, and the stronger wins:
 *
 *  - absolute, the raw gap. A tight pair anywhere in the plane counts.
 *  - relative, the gap as a fraction of how far out the configuration sits.
 *
 * The absolute term alone made this axis an inverse restatement of Energy —
 * measured correlation −0.224, because flinging the roots outward enlarges every
 * separation along with them. Violent tokens were therefore locked out of the
 * upper Feedback bands: `Violent x Runaway` held 0.5% of the supply, two or three
 * tokens, and the pairing that should read as the collection's most extreme state
 * was effectively unreachable.
 *
 * Relative closeness is scale-free, so it is free to co-occur with high energy —
 * and it is the better statement of the idea anyway. Two roots converging is a
 * fact about the shape of the triad, not about how far the triad happens to sit
 * from the origin. `3 *` puts an equilateral triad (sep/scale = √3, the most
 * separated a triad can be) at the bottom of the curve.
 */
export function resonanceOf(sol: Solution): number {
  const [a, b, c] = sol.depressedRoots;
  const sep = Math.min(abs(sub(a, b)), abs(sub(b, c)), abs(sub(c, a)));
  const curve = (x: number) => Math.min(1, Math.max(0, 1 - Math.log10(1 + x) / Math.log10(5)));

  // 0 separation -> 1; ~4 apart -> 0
  const absolute = curve(sep);

  const scale = Math.max(...sol.depressedRoots.map(abs));
  const relative = scale < 1e-9 ? 1 : curve(3 * (sep / scale));

  return Math.max(absolute, relative);
}

export function pqRatio(sol: Solution): number {
  const ap = Math.abs(sol.p);
  const aq = Math.abs(sol.q);
  return ap + aq === 0 ? 0.5 : ap / (ap + aq);
}

export function paletteOf(sol: Solution): Palette {
  // arg(A) sets the hue family; the discriminant band nudges within it, so
  // neighbouring phases never collapse onto the same palette.
  const turn = sol.phaseAngle / (2 * Math.PI);
  const idx = Math.floor(turn * PALETTES.length + discEnergy(sol.discriminant) * 3);
  return PALETTES[((idx % PALETTES.length) + PALETTES.length) % PALETTES.length];
}

export function deriveTraits(sol: Solution): Traits {
  const energy = discEnergy(sol.discriminant);
  return {
    structure: archetypeOf(sol),
    rootState: sol.rootState,
    symmetry: symmetryOf(sol),
    discriminantClass: discriminantClass(sol.discriminant),
    discriminantBand: bandOf(energy),
    phase: sol.phase,
    palette: paletteOf(sol),
    energyBand: energyBandOf(energyOf(sol)),
    feedbackBand: feedbackBandOf(resonanceOf(sol)),
  };
}

export function deriveDrivers(sol: Solution): Drivers {
  const moduli = sol.depressedRoots.map(abs);
  const spread = Math.max(1e-6, ...moduli);
  return {
    scale: 0.6 + Math.min(2.4, Math.abs(sol.a) / 4),
    density: Math.round(80 + Math.min(120, Math.abs(sol.b) * 9)),
    curvature: curvatureOf(sol),
    shift: sol.shift,
    discEnergy: discEnergy(sol.discriminant),
    pqRatio: pqRatio(sol),
    phaseAngle: sol.phaseAngle,
    rootPoints: sol.depressedRoots.map((r) => [r.re / spread, r.im / spread]) as [number, number][],
    rootSpread: spread,
    energy: energyOf(sol),
    resonance: resonanceOf(sol),
  };
}

/**
 * OpenSea-style attributes. Axes sitting at their default value are dropped,
 * which is what makes the surfaced trait count vary between 2 and 8. The full
 * eight-axis set always exists on the Traits object and is what the gallery
 * filters on — this is only the public attribute list.
 */
export function attributesOf(traits: Traits): { trait_type: string; value: string }[] {
  const attrs: { trait_type: string; value: string }[] = [
    { trait_type: "Structure", value: traits.structure },
    { trait_type: "Root State", value: traits.rootState },
  ];
  if (traits.discriminantClass !== "Separated")
    attrs.push({ trait_type: "Discriminant Class", value: traits.discriminantClass });
  if (traits.symmetry !== "Identity")
    attrs.push({ trait_type: "Symmetry", value: traits.symmetry });
  if (traits.phase !== 0) attrs.push({ trait_type: "Phase", value: `ω${traits.phase}` });
  // Energy and Feedback are exceptions to the drop rule: both are always
  // surfaced. They are the two axes that describe how the piece *behaves*
  // rather than how it is built, and dropping them at their commonest value
  // left 38% of the supply showing no Energy and 22% showing no Feedback — a
  // collector could not tell "Charged" from "this token has no Energy axis".
  // Both remaining values are meaningful readings, not absences: "None" is a
  // statement that the roots stay apart, and the axis is worth stating.
  //
  // Costless in rarity terms, because `rarityScore` reads the full eight-axis
  // set from `traitPairs`, never this list.
  attrs.push({ trait_type: "Energy", value: traits.energyBand });
  attrs.push({ trait_type: "Feedback", value: traits.feedbackBand });
  if (traits.discriminantBand !== "Mid")
    attrs.push({ trait_type: "Palette", value: traits.palette.name });
  return attrs;
}
