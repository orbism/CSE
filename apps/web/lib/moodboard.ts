import {
  ARCHETYPES,
  type Archetype,
  type EnergyBand,
  type FeedbackBand,
  PALETTES,
  type Token,
  deriveToken,
} from "@cse/core";
import type { Genome } from "@cse/art";

/**
 * A fixed, derived sample of the collection's range for the moodboard.
 *
 * Nothing is hand-picked or stored: the board is a deterministic walk through
 * seeds off a dedicated master seed, so it is the same on every load, costs no
 * assets, and tracks the trait code exactly. Three cuts across the supply:
 * every Structure, every Energy × Feedback pairing, every Palette.
 */
const MASTER = "CSE-MOODBOARD";
/** Candidates kept per bucket; the pick is made within these. */
const POOL = 24;
const LIMIT = 8000;

export const ENERGY_BANDS: EnergyBand[] = ["Still", "Charged", "Violent"];
export const FEEDBACK_BANDS: FeedbackBand[] = ["None", "Echo", "Resonant", "Runaway"];

export interface Sample {
  token: Token;
  genome: Genome;
  label: string;
  sub: string;
}

export interface Board {
  structures: Sample[];
  bands: Sample[];
  palettes: Sample[];
}

/** How much the piece moves: both axes that describe behaviour rather than build. */
const heat = (t: Token) => t.drivers.energy + t.drivers.resonance;

/**
 * A Form as a Lab genome, so the board runs on the Lab engine.
 *
 * The collection's renderer spins a fixed body and echoes the glyphs; only the
 * Lab closes the loop back into geometry, which is what makes the surface
 * react rather than merely turn. Same starting shape, palette and density as
 * the Lab's own "load a Form", with the feedback gain taken from the token's
 * resonance so the Feedback axis is visible as motion, and the collection's
 * spin rate so Energy still sets the pace.
 */
export function genomeOf(t: Token): Genome {
  const { drivers: d, traits } = t;
  return {
    seed: t.seed.slice(0, 8),
    base: "roots",
    form: { id: 0, seed: t.seed },
    ops: [],
    field: { degree: 3, energy: d.energy, curvature: d.curvature },
    render: {
      rows: Math.max(24, Math.min(240, d.density)),
      palette: traits.palette.name,
      spin: (traits.phase === 1 ? -1 : 1) * (0.06 + d.pqRatio * 0.08 + d.energy * 0.09),
      feedback: 0.15 + 0.75 * d.resonance,
    },
  };
}

const sample = (token: Token, label: string, sub: string): Sample => ({ token, genome: genomeOf(token), label, sub });

function push<K>(map: Map<K, Token[]>, key: K, t: Token) {
  const list = map.get(key) ?? [];
  if (list.length < POOL) map.set(key, [...list, t]);
}

/** First candidate whose structure the section has not shown yet, else the first. */
function fresh(list: Token[], used: Set<Archetype>): Token {
  const pick = list.find((t) => !used.has(t.traits.structure)) ?? list[0];
  used.add(pick.traits.structure);
  return pick;
}

let board: Board | null = null;

export function buildBoard(): Board {
  if (board) return board;

  const byStructure = new Map<Archetype, Token[]>();
  const byPair = new Map<string, Token[]>();
  const byPalette = new Map<string, Token[]>();
  const full = () =>
    byStructure.size === ARCHETYPES.length &&
    byPair.size === ENERGY_BANDS.length * FEEDBACK_BANDS.length &&
    byPalette.size === PALETTES.length &&
    [...byStructure.values(), ...byPair.values(), ...byPalette.values()].every((l) => l.length === POOL);

  for (let i = 1; i <= LIMIT && !full(); i++) {
    const t = deriveToken(MASTER, i);
    push(byStructure, t.traits.structure, t);
    push(byPair, `${t.traits.energyBand}/${t.traits.feedbackBand}`, t);
    push(byPalette, t.traits.palette.name, t);
  }

  // Structures: the liveliest instance of each, so every form is seen moving.
  const structures = ARCHETYPES.flatMap((name) => {
    const list = byStructure.get(name);
    if (!list) return [];
    const t = list.reduce((a, b) => (heat(b) > heat(a) ? b : a));
    return [sample(t, name, `${t.traits.energyBand} · ${t.traits.feedbackBand}`)];
  });

  const used = new Set<Archetype>();
  const bands = ENERGY_BANDS.flatMap((e) =>
    FEEDBACK_BANDS.flatMap((f) => {
      const list = byPair.get(`${e}/${f}`);
      if (!list) return [];
      const t = fresh(list, used);
      return [sample(t, `${e} · ${f}`, t.traits.structure)];
    }),
  );

  used.clear();
  const palettes = PALETTES.flatMap((p) => {
    const list = byPalette.get(p.name);
    if (!list) return [];
    const t = fresh(list, used);
    return [sample(t, p.name, t.traits.structure)];
  });

  board = { structures, bands, palettes };
  return board;
}

/** File stem for a sample's downloads. */
export const sampleName = (t: Token) => `cse-${t.traits.structure.toLowerCase()}-${t.seed.slice(0, 8)}`;
