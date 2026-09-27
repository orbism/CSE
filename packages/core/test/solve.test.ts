import { describe, expect, it } from "vitest";
import {
  DEGENERATE_EPS,
  abs,
  cx,
  depress,
  deriveToken,
  formatCubic,
  fromRoots,
  residual,
  sha256Hex,
  solve,
  structuralVector,
  l2,
  rngFromHex,
  deriveTraits,
  ARCHETYPES,
  PALETTES,
  attributesOf,
  COLLECTION,
} from "../src/index.js";

const MASTER = "CSE-TEST-SEED";
const SUPPLY = COLLECTION.supply;

describe("sha256", () => {
  it("matches the standard vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });
});

describe("depression", () => {
  it("reduces the article's example to y^3 - 3y + 1", () => {
    const { p, q, shift } = depress({ a: 6, b: 9, c: 3 });
    expect(p).toBeCloseTo(-3, 12);
    expect(q).toBeCloseTo(1, 12);
    expect(shift).toBeCloseTo(2, 12);
  });
});

describe("solve", () => {
  it("reproduces the article's trigonometric roots for x^3+6x^2+9x+3", () => {
    const sol = solve({ a: 6, b: 9, c: 3 });
    // depressed roots are 2cos(2pi/9), 2cos(8pi/9), 2cos(4pi/9)
    const expected = [
      2 * Math.cos((2 * Math.PI) / 9),
      2 * Math.cos((8 * Math.PI) / 9),
      2 * Math.cos((4 * Math.PI) / 9),
    ];
    sol.depressedRoots.forEach((r, i) => {
      expect(r.im).toBeCloseTo(0, 10);
      expect(r.re).toBeCloseTo(expected[i], 10);
    });
    expect(sol.discriminant).toBeCloseTo(81, 9);
    expect(sol.rootState).toBe("3 Real Distinct");
    expect(residual(sol)).toBeLessThan(1e-10);
  });

  it("recovers roots that were used to build the coefficients", () => {
    const cases: [number, number, number][] = [
      [1, 2, 3],
      [-5, 0.5, 7.25],
      [0, 0, 0],
      [-2, -2, 11],
    ];
    for (const [r1, r2, r3] of cases) {
      const cubic = fromRoots(cx(r1), cx(r2), cx(r3));
      const sol = solve(cubic);
      const got = sol.roots.map((r) => r.re).sort((x, y) => x - y);
      const want = [r1, r2, r3].sort((x, y) => x - y);
      got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 8));
      expect(residual(sol)).toBeLessThan(1e-8);
    }
  });

  it("classifies one real and two complex roots when the discriminant is negative", () => {
    const sol = solve({ a: 0, b: 0, c: 1 }); // y^3 + 1, disc = -27
    expect(sol.discriminant).toBeCloseTo(-27, 12);
    expect(sol.rootState).toBe("1 Real 2 Complex");
    expect(sol.realCount).toBe(1);
    expect(residual(sol)).toBeLessThan(1e-12);
  });

  it("detects exact double and triple roots", () => {
    const dbl = solve(fromRoots(cx(2), cx(2), cx(-5)));
    expect(Math.abs(dbl.discriminant)).toBeLessThanOrEqual(DEGENERATE_EPS);
    expect(dbl.rootState).toBe("Double Root");

    const tri = solve(fromRoots(cx(3), cx(3), cx(3)));
    expect(tri.rootState).toBe("Triple Root");
    expect(tri.roots.every((r) => Math.abs(r.re - 3) < 1e-9)).toBe(true);
  });

  it("handles the p = 0 branch without dividing by a vanishing resolvent", () => {
    const sol = solve({ a: 0, b: 0, c: -8 }); // y^3 = 8
    expect(sol.roots.some((r) => Math.abs(r.re - 2) < 1e-9 && Math.abs(r.im) < 1e-9)).toBe(true);
    expect(residual(sol)).toBeLessThan(1e-9);
    expect(Number.isFinite(sol.phaseAngle)).toBe(true);
  });

  it("keeps residuals tiny across a large random sweep", () => {
    const rng = rngFromHex(sha256Hex("sweep"));
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const sol = solve({
        a: rng.range(-9, 9),
        b: rng.range(-14, 14),
        c: rng.range(-16, 16),
      });
      worst = Math.max(worst, residual(sol));
      expect(sol.roots.every((r) => Number.isFinite(r.re) && Number.isFinite(r.im))).toBe(true);
    }
    expect(worst).toBeLessThan(1e-6);
  });
});

describe("token derivation", () => {
  it("is deterministic for a given master seed and id", () => {
    const a = deriveToken(MASTER, 42);
    const b = deriveToken(MASTER, 42);
    expect(a.seed).toBe(b.seed);
    expect(a.cubic).toEqual(b.cubic);
    expect(a.traits.structure).toBe(b.traits.structure);
  });

  it("changes completely when the nonce moves", () => {
    const a = deriveToken(MASTER, 42, 0);
    const b = deriveToken(MASTER, 42, 1);
    expect(a.seed).not.toBe(b.seed);
    expect(l2(structuralVector(a), structuralVector(b))).toBeGreaterThan(0);
  });

  it("produces every archetype and every palette across the supply", () => {
    const structures = new Map<string, number>();
    const palettes = new Set<string>();
    const states = new Set<string>();
    for (let i = 1; i <= SUPPLY; i++) {
      const t = deriveToken(MASTER, i);
      structures.set(t.traits.structure, (structures.get(t.traits.structure) ?? 0) + 1);
      palettes.add(t.traits.palette.name);
      states.add(t.traits.rootState);
    }
    expect(structures.size).toBe(ARCHETYPES.length);
    expect(palettes.size).toBe(PALETTES.length);
    expect(states.has("Double Root") || states.has("Triple Root")).toBe(true);

    // Reachable is not the same as present. Every archetype has to clear the
    // generator's coverage floor from the raw derivation, so the coverage gate
    // in the pipeline stays a backstop rather than doing the work.
    const starved = [...structures].filter(([, n]) => n < 4);
    expect(starved).toEqual([]);
  });

  it("injects degenerate cases at roughly the configured rate", () => {
    let degenerate = 0;
    for (let i = 1; i <= SUPPLY; i++) if (deriveToken(MASTER, i).degenerate) degenerate++;
    expect(degenerate / SUPPLY).toBeGreaterThan(0.04);
    expect(degenerate / SUPPLY).toBeLessThan(0.13);
  });

  it("surfaces between 2 and 8 attributes per token", () => {
    let min = 99;
    let max = 0;
    for (let i = 1; i <= SUPPLY; i++) {
      const n = attributesOf(deriveToken(MASTER, i).traits).length;
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
    expect(min).toBeGreaterThanOrEqual(2);
    expect(max).toBeLessThanOrEqual(8);
  });

  it("yields finite drivers for every token in the supply", () => {
    for (let i = 1; i <= SUPPLY; i++) {
      const { drivers } = deriveToken(MASTER, i);
      expect(Number.isFinite(drivers.scale)).toBe(true);
      expect(Number.isFinite(drivers.curvature)).toBe(true);
      expect(drivers.density).toBeGreaterThanOrEqual(80);
      expect(drivers.density).toBeLessThanOrEqual(200);
      for (const [x, y] of drivers.rootPoints) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(abs(cx(x, y))).toBeLessThanOrEqual(1.0000001);
      }
    }
  });
});

describe("formatting", () => {
  it("renders a readable equation", () => {
    expect(formatCubic({ a: 6, b: 9, c: 3 }, 0)).toBe("x³ + 6x² + 9x + 3");
    expect(formatCubic({ a: -1, b: 0, c: -2 }, 0)).toBe("x³ - 1x² + 0x - 2");
  });

  it("derives traits without throwing for extreme coefficients", () => {
    expect(() => deriveTraits(solve({ a: 1e3, b: -1e3, c: 1e3 }))).not.toThrow();
    expect(() => deriveTraits(solve({ a: 0, b: 0, c: 0 }))).not.toThrow();
  });
});
