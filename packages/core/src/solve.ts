/**
 * Cubic solver following the symmetry-first derivation in
 * https://hidden-phenomena.com/articles/cubic
 *
 * Given x^3 + a x^2 + b x + c, substitute y = x + a/3 to reach the depressed
 * cubic y^3 + p y + q, whose roots satisfy the Vieta relations
 *   alpha + beta + gamma = 0
 *   alpha*beta + beta*gamma + gamma*alpha = p
 *   alpha*beta*gamma = -q
 *
 * The article's key object is D = (a-b)(b-g)(g-a): asymmetric under swaps, but
 * D^2 = -4p^3 - 27q^2 is fully symmetric. Combined with the Lagrange resolvent
 * A = alpha + omega*beta + omega^2*gamma, whose cube is expressible in p, q, D,
 * the roots fall out directly.
 */

import {
  type Cx,
  OMEGA,
  OMEGA2,
  abs,
  add,
  arg,
  cbrt,
  clean,
  cx,
  div,
  isReal,
  mul,
  scale,
  sqrt,
  sub,
} from "./complex.js";

/** Threshold below which |discriminant| counts as a repeated root. */
export const DEGENERATE_EPS = 1e-9;

export type RootState = "3 Real Distinct" | "1 Real 2 Complex" | "Double Root" | "Triple Root";

export interface Cubic {
  /** Coefficients of x^3 + a x^2 + b x + c. */
  a: number;
  b: number;
  c: number;
}

/** Which of the three cube roots of A^3 the token adopts as its resolvent. */
export type Branch = 0 | 1 | 2;

/** [1, omega, omega^2] — multiplying A by these walks the three cube roots. */
const OMEGA_POW: [Cx, Cx, Cx] = [{ re: 1, im: 0 }, OMEGA, OMEGA2];

const TAU = 2 * Math.PI;
const normalizeAngle = (t: number) => ((t % TAU) + TAU) % TAU;

export interface Solution extends Cubic {
  /** Depressed cubic y^3 + p y + q, reached via y = x + a/3. */
  p: number;
  q: number;
  /** The shift applied by the depression, a/3. */
  shift: number;
  /** Discriminant of the depressed cubic, D^2 = -4p^3 - 27q^2. */
  discriminant: number;
  /** D itself, the (asymmetric) root-difference product. Complex when disc < 0. */
  D: Cx;
  /** Lagrange resolvent A = alpha + omega*beta + omega^2*gamma, on the chosen branch. */
  A: Cx;
  /** The cube-root branch this token adopted. */
  branch: Branch;
  /** Roots of the depressed cubic, in the article's alpha/beta/gamma order. */
  depressedRoots: [Cx, Cx, Cx];
  /** Roots of the original cubic (depressed roots minus a/3). */
  roots: [Cx, Cx, Cx];
  rootState: RootState;
  /** Number of roots with negligible imaginary part. */
  realCount: number;
  /** arg(A) in [0, 2*pi). Continuous; the branch rotates it by 2*pi/3 steps. */
  phaseAngle: number;
  /** The phase trait — identical to `branch`. */
  phase: Branch;
  /**
   * Indices 0..2 of the depressed roots sorted by argument then magnitude.
   * This is the permutation of {alpha, beta, gamma} the composition reads.
   */
  permutation: [number, number, number];
  /** Parity of `permutation` as an element of S3: 0 = even, 1 = odd. */
  parity: 0 | 1;
}

/** Depress x^3 + a x^2 + b x + c to y^3 + p y + q under y = x + a/3. */
export function depress({ a, b, c }: Cubic): { p: number; q: number; shift: number } {
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;
  return { p, q, shift: a / 3 };
}

/** Expand (x - r1)(x - r2)(x - r3) back into coefficients. Roots must be real or conjugate. */
export function fromRoots(r1: Cx, r2: Cx, r3: Cx): Cubic {
  const e1 = add(add(r1, r2), r3);
  const e2 = add(add(mul(r1, r2), mul(r2, r3)), mul(r3, r1));
  const e3 = mul(mul(r1, r2), r3);
  return { a: -e1.re, b: e2.re, c: -e3.re };
}

function sortPermutation(roots: readonly [Cx, Cx, Cx]): [number, number, number] {
  const idx: number[] = [0, 1, 2];
  idx.sort((i, j) => {
    const ai = arg(roots[i]);
    const aj = arg(roots[j]);
    if (Math.abs(ai - aj) > 1e-9) return ai - aj;
    return abs(roots[i]) - abs(roots[j]);
  });
  return idx as [number, number, number];
}

/** Parity of a permutation of {0,1,2}, counted by inversions. */
function permutationParity(perm: readonly number[]): 0 | 1 {
  let inversions = 0;
  for (let i = 0; i < perm.length; i++)
    for (let j = i + 1; j < perm.length; j++) if (perm[i] > perm[j]) inversions++;
  return (inversions % 2) as 0 | 1;
}

function classify(p: number, q: number, disc: number): RootState {
  if (Math.abs(disc) <= DEGENERATE_EPS) {
    // disc = 0 means a repeated root; p = 0 as well collapses all three onto one
    if (Math.abs(p) <= DEGENERATE_EPS && Math.abs(q) <= DEGENERATE_EPS) return "Triple Root";
    return "Double Root";
  }
  return disc > 0 ? "3 Real Distinct" : "1 Real 2 Complex";
}

/**
 * Solve x^3 + a x^2 + b x + c.
 *
 * `branch` selects which cube root of A^3 becomes the resolvent. All three give
 * the same root *set* — replacing A by omega*A sends alpha -> gamma -> beta —
 * so the branch is precisely the residual symmetry the article describes: the
 * choice that survives after fixing the square and cube roots. It is a genuine
 * degree of freedom the token exercises, not a quantity read off the geometry.
 */
export function solve(cubic: Cubic, branch: Branch = 0): Solution {
  const { p, q, shift } = depress(cubic);
  const discriminant = -4 * p * p * p - 27 * q * q;
  const D = sqrt(cx(discriminant));

  // A^3 = -27q/2 - (3i*sqrt(3)/2) * D
  const A3 = sub(cx(-13.5 * q), mul(cx(0, (3 * Math.sqrt(3)) / 2), D));
  const principal = cbrt(A3);
  let A = mul(OMEGA_POW[branch], principal);

  let depressedRoots: [Cx, Cx, Cx];
  const pureCubeRoot = Math.abs(p) <= DEGENERATE_EPS;
  if (pureCubeRoot) {
    // |A| = sqrt(3|p|), so p = 0 makes A vanish and the alpha = A/3 - p/A form
    // singular. There the depressed cubic is just y^3 = -q, and the resolvent
    // alpha*(1 + omega^2 + omega) is genuinely zero. The branch still matters:
    // it decides which of the three cube roots is labelled alpha.
    const r0 = cx(-Math.cbrt(q));
    const triad: [Cx, Cx, Cx] = [r0, clean(mul(OMEGA, r0)), clean(mul(OMEGA2, r0))];
    depressedRoots = [triad[branch], triad[(branch + 1) % 3], triad[(branch + 2) % 3]];
    A = cx(0, 0);
  } else {
    const pOverA = div(cx(p), A);
    const alpha = sub(scale(A, 1 / 3), pOverA);
    const beta = sub(scale(mul(OMEGA2, A), 1 / 3), mul(OMEGA, pOverA));
    const gamma = sub(scale(mul(OMEGA, A), 1 / 3), mul(OMEGA2, pOverA));
    depressedRoots = [clean(alpha), clean(beta), clean(gamma)];
  }

  const roots = depressedRoots.map((r) => clean(cx(r.re - shift, r.im))) as [Cx, Cx, Cx];
  const realCount = depressedRoots.filter((r) => isReal(r)).length;
  const rootState = classify(p, q, discriminant);

  // continuous angle for the palette and the renderer; the branch rotates it in
  // thirds, so it spans the circle instead of bunching near one value
  const base = pureCubeRoot ? arg(cx(-Math.cbrt(q))) : arg(principal);
  const phaseAngle = normalizeAngle(base + (branch * TAU) / 3);

  const permutation = sortPermutation(depressedRoots);

  return {
    ...cubic,
    p,
    q,
    shift,
    discriminant,
    D,
    A,
    branch,
    depressedRoots,
    roots,
    rootState,
    realCount,
    phaseAngle,
    phase: branch,
    permutation,
    parity: permutationParity(permutation),
  };
}

/** Max |x^3 + a x^2 + b x + c| over the three returned roots — a residual check. */
export function residual(sol: Solution): number {
  const { a, b, c } = sol;
  let worst = 0;
  for (const r of sol.roots) {
    const r2 = mul(r, r);
    const r3 = mul(r2, r);
    const v = add(add(add(r3, scale(r2, a)), scale(r, b)), cx(c));
    worst = Math.max(worst, abs(v));
  }
  return worst;
}

/** Human-readable "x^3 + 6x^2 + 9x + 3" form. */
export function formatCubic({ a, b, c }: Cubic, digits = 3): string {
  const term = (v: number, suffix: string) => {
    const sign = v < 0 ? "- " : "+ ";
    return `${sign}${Math.abs(v).toFixed(digits)}${suffix}`;
  };
  return `x³ ${term(a, "x²")} ${term(b, "x")} ${term(c, "")}`;
}
