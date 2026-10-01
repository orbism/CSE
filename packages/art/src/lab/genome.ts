/**
 * A Lab form is a program, not a preset.
 *
 * The collection's twenty-two archetypes are hand-authored: each is a builder
 * function, and a token picks one. The Lab inverts that. A form here is a short
 * chain of operators applied to a base solid, and the chain itself is the
 * artefact — it encodes to a string, travels in a URL, mutates, and breeds.
 *
 * Two consequences worth stating, because they are the point:
 *
 *   1. The reachable space is not a list. Twelve operators, chains up to eight
 *      deep, continuous parameters — you cannot enumerate it, and neither can
 *      anyone else. "Get weird" is a walk through it, not a lookup.
 *   2. It does not contain the archetypes. The operators are a different
 *      vocabulary from the builders, so the Lab cannot accidentally re-derive
 *      Knot or Bloom and present it as a discovery.
 */

import { type Rng, rngFromHex, sha256Hex } from "@cse/core";

export const BASES = ["icosa", "torus", "box", "plane", "helix", "roots"] as const;
export type BaseName = (typeof BASES)[number];

export const OPS = [
  "warp",
  "twist",
  "inflate",
  "shatter",
  "laminate",
  "tile",
  "recurse",
  "punch",
  "mobius",
  "revolve",
  "braid",
  "shear",
] as const;
export type OpName = (typeof OPS)[number];

/** Parameter ranges per operator: [min, max] for each argument. */
export const OP_RANGES: Record<OpName, [number, number][]> = {
  warp: [[0, 1.6]],
  twist: [[-3, 3]],
  inflate: [[-0.6, 1.2]],
  shatter: [[0, 1.2]],
  laminate: [
    [2, 9],
    [0.1, 1],
  ],
  tile: [
    [2, 4],
    [0.4, 1.6],
  ],
  recurse: [
    [1, 3],
    [0.25, 0.7],
  ],
  punch: [[0.15, 1.4]],
  mobius: [[0.2, 1.6]],
  revolve: [[3, 24]],
  braid: [
    [2, 7],
    [2, 7],
  ],
  shear: [[-1.2, 1.2]],
};

/**
 * Which arguments must be whole numbers — counts and winding numbers, not the
 * scalars beside them. Indexed per argument rather than per operator: `laminate`
 * takes a sheet count *and* a gap, and rounding the gap to an integer clamped it
 * straight back out of its own range on the next decode.
 */
export const OP_INTS: Partial<Record<OpName, number[]>> = {
  laminate: [0],
  tile: [0],
  recurse: [0],
  revolve: [0],
  braid: [0, 1],
};

/**
 * Operators that reliably destabilise the result rather than merely decorate it.
 * "Get weird" biases toward these; a chain of pure warps is just a wobble.
 */
export const WILD_OPS: OpName[] = ["mobius", "recurse", "shatter", "braid", "revolve"];

/**
 * Longest operator chain. One number, used by generation, breeding and the
 * codec alike — when only the codec enforced it, a freshly rolled ten-op genome
 * lost its tail the first time it went through a URL.
 */
export const MAX_OPS = 8;

export interface Op {
  op: OpName;
  args: number[];
}

/** A collection Form, as the Lab's starting shape: token id and its settled nonce. */
export interface FormRef {
  id: number;
  nonce: number;
}

export interface Genome {
  /** Hex; seeds the deterministic Rng every operator draws from. */
  seed: string;
  base: BaseName;
  /** When set, the chain starts from this collection Form instead of `base`. */
  form?: FormRef;
  ops: Op[];
  field: {
    /** Number of roots. 4 and 5 are outside the collection's cubic vocabulary. */
    degree: 3 | 4 | 5;
    energy: number;
    curvature: number;
  };
  render: {
    /** Glyph rows. The collection runs 80..200; the Lab allows far coarser. */
    rows: number;
    palette: string;
    spin: number;
    /** 0 disables the feedback loop entirely. */
    feedback: number;
  };
}

export const DEFAULT_GENOME: Genome = {
  seed: "a1b2c3d4",
  base: "icosa",
  ops: [
    { op: "warp", args: [0.6] },
    { op: "twist", args: [1.1] },
  ],
  field: { degree: 3, energy: 0.5, curvature: 0.4 },
  render: { rows: 120, palette: "PHOSPHOR", spin: 0.12, feedback: 0 },
};

// ---------------------------------------------------------------- generation

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function randomArgs(rng: Rng, op: OpName, temperature = 0): number[] {
  const ints = OP_INTS[op] ?? [];
  return OP_RANGES[op].map(([lo, hi], i) => {
    const t = rng.next();
    // temperature pushes values toward the ends of their range, where the
    // interesting failures live
    const pushed =
      temperature > 0 ? (t < 0.5 ? t * (1 - temperature) : 1 - (1 - t) * (1 - temperature)) : t;
    const v = lo + pushed * (hi - lo);
    return ints.includes(i) ? Math.round(v) : Number(v.toFixed(3));
  });
}

/**
 * @param temperature 0 = tame, 1 = actively trying to break it. Rising
 *        temperature lengthens the chain, favours the wild operators and pushes
 *        parameters to their extremes, so pressing the button repeatedly travels
 *        somewhere new rather than resampling the same neighbourhood.
 */
export function randomGenome(seedHex: string, temperature = 0): Genome {
  const rng = rngFromHex(sha256Hex(seedHex));
  const t = clamp(temperature, 0, 1);

  const chainLen = Math.min(MAX_OPS, Math.round(2 + t * 5 + rng.next() * 2));
  const ops: Op[] = [];
  for (let i = 0; i < chainLen; i++) {
    const wild = rng.chance(0.25 + t * 0.5);
    const op = wild ? rng.pick(WILD_OPS) : rng.pick(OPS);
    ops.push({ op, args: randomArgs(rng, op, t) });
  }

  return {
    seed: seedHex,
    base: rng.pick(BASES),
    ops,
    field: {
      // degree 4 and 5 only appear once things are already weird
      degree: (rng.chance(t * 0.7) ? rng.pick([4, 5]) : 3) as 3 | 4 | 5,
      // clamped to the same 0..1 the codec enforces, or a hot roll encodes a
      // value that decodes to something else
      energy: Number(clamp(0.2 + rng.next() * (0.5 + t * 0.5), 0, 1).toFixed(3)),
      curvature: Number(clamp(rng.next() * (0.5 + t * 0.5), 0, 1).toFixed(3)),
    },
    render: {
      rows: Math.round(60 + rng.next() * (t > 0.5 ? 160 : 90)),
      palette: rng.pick([
        "PHOSPHOR",
        "AMBER",
        "VT-CYAN",
        "MAGENTA-BURN",
        "IRON",
        "OXBLOOD",
        "ULTRAVIOLET",
        "BONE",
        "SIGNAL",
      ]),
      spin: Number((0.04 + rng.next() * 0.18).toFixed(3)),
      feedback: Number((t * rng.next()).toFixed(3)),
    },
  };
}

/** Splice two chains and jitter one parameter. Where good accidents get kept. */
export function breed(a: Genome, b: Genome, seedHex: string): Genome {
  const rng = rngFromHex(sha256Hex(seedHex));
  const cutA = Math.floor(rng.next() * (a.ops.length + 1));
  const cutB = Math.floor(rng.next() * (b.ops.length + 1));
  const ops = [...a.ops.slice(0, cutA), ...b.ops.slice(cutB)].slice(0, MAX_OPS);
  if (ops.length === 0) ops.push({ op: rng.pick(OPS), args: [] });

  const parent = rng.chance(0.5) ? a : b;
  const child: Genome = {
    seed: seedHex,
    // a loaded Form travels with the base it replaced
    base: parent.base,
    ...(parent.form ? { form: { ...parent.form } } : {}),
    ops: ops.map((o) => ({ op: o.op, args: [...o.args] })),
    field: rng.chance(0.5) ? { ...a.field } : { ...b.field },
    render: { ...(rng.chance(0.5) ? a.render : b.render) },
  };

  // one mutation, so siblings differ
  const i = Math.floor(rng.next() * child.ops.length);
  const target = child.ops[i];
  const ranges = OP_RANGES[target.op];
  if (ranges.length) {
    const k = Math.floor(rng.next() * ranges.length);
    const [lo, hi] = ranges[k];
    const args = [...target.args];
    args[k] = Number(clamp(lo + rng.next() * (hi - lo), lo, hi).toFixed(3));
    child.ops[i] = { op: target.op, args };
  }
  return child;
}

/** Fill in any missing arguments so a hand-edited genome still builds. */
export function normalise(g: Genome): Genome {
  const rng = rngFromHex(sha256Hex(g.seed || "0"));
  return {
    ...g,
    ops: g.ops.slice(0, MAX_OPS).map((o) => {
      const ranges = OP_RANGES[o.op] ?? [];
      const ints = OP_INTS[o.op] ?? [];
      const args = ranges.map(([lo, hi], i) => {
        const raw = Number.isFinite(o.args?.[i]) ? o.args[i] : lo + rng.next() * (hi - lo);
        const v = clamp(raw, lo, hi);
        return ints.includes(i) ? Math.round(v) : Number(v.toFixed(3));
      });
      return { op: o.op, args };
    }),
  };
}

// ------------------------------------------------------------------- codec

/**
 * Compact, URL-safe, and readable enough to reason about:
 *
 *   seed_base_rows_palette_spin_feedback_degree_energy_curvature~op:a,b~op:a
 *
 * A chain started from a collection Form writes `f<id>n<nonce>` where the base
 * goes (`f122n0`), so older links decode exactly as before.
 *
 * Deliberately not JSON+base64: a genotype people are meant to share, tweak by
 * hand and recognise should be legible in the address bar.
 *
 * Fields are separated by `_`, not `.`, because half of them are decimals and
 * splitting on `.` tore `0.186` into two fields — every shared link silently
 * decoded to a different form than it encoded.
 */
const SEP = "_";

export function encodeGenome(g: Genome): string {
  const head = [
    g.seed,
    g.form ? `f${g.form.id}n${g.form.nonce}` : g.base,
    g.render.rows,
    g.render.palette,
    g.render.spin,
    g.render.feedback,
    g.field.degree,
    g.field.energy,
    g.field.curvature,
  ].join(SEP);
  const tail = g.ops.map((o) => `${o.op}:${o.args.join(",")}`).join("~");
  return tail ? `${head}~${tail}` : head;
}

export function decodeGenome(s: string): Genome | null {
  try {
    const [head, ...opParts] = s.split("~");
    const f = head.split(SEP);
    if (f.length < 9) return null;
    const base = BASES.includes(f[1] as BaseName) ? (f[1] as BaseName) : "icosa";
    const fm = /^f(\d+)n(\d+)$/.exec(f[1]);
    const degree = ([3, 4, 5].includes(Number(f[6])) ? Number(f[6]) : 3) as 3 | 4 | 5;

    const ops: Op[] = [];
    for (const part of opParts) {
      const [name, argStr] = part.split(":");
      if (!OPS.includes(name as OpName)) continue;
      ops.push({
        op: name as OpName,
        args: (argStr ?? "")
          .split(",")
          .filter((x) => x !== "")
          .map(Number)
          .filter(Number.isFinite),
      });
    }

    return normalise({
      seed: f[0] || "0",
      base,
      ...(fm ? { form: { id: Number(fm[1]), nonce: Number(fm[2]) } } : {}),
      ops,
      field: {
        degree,
        energy: clamp(Number(f[7]) || 0, 0, 1),
        curvature: clamp(Number(f[8]) || 0, 0, 1),
      },
      render: {
        rows: clamp(Math.round(Number(f[2]) || 120), 24, 240),
        palette: f[3] || "PHOSPHOR",
        spin: clamp(Number(f[4]) || 0.1, -0.6, 0.6),
        feedback: clamp(Number(f[5]) || 0, 0, 1),
      },
    });
  } catch {
    return null;
  }
}

/** Stable identity for "have I served this one already". */
export function genomeKey(g: Genome): string {
  return sha256Hex(encodeGenome(g)).slice(0, 16);
}
