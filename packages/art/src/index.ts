/**
 * Library entry. Consumed by the site's demo box and token modal; the pinned
 * standalone bundle uses `main.ts` instead.
 */
export { Engine, type EngineOptions, type ProjectedAnchor, type AnchorProjection } from "./renderer.js";
export { GlyphPass, RAMP, type GlyphFrame } from "./ascii.js";
export { buildPiece, disposePiece, type BuildOptions, type Piece } from "./scene.js";
export { BUILDERS, FRAMING, type Anchor, type AnchorTerm } from "./archetypes.js";
export { CELL_ASPECT, GLYPH_FONT, loadGlyphFont } from "./font.js";
export { layoutCallouts, COMPACT_BELOW, type Callout, type Layout } from "./hud-layout.js";

// The Lab. Deliberately a separate module tree: it shares the glyph pass and the
// materials, and shares nothing with the archetypes that define the collection.
export { LabEngine, SETTLE_FRAMES, type LabDrive, type LabEngineOptions } from "./lab/engine.js";
export { buildLabPiece, disposeLabPiece, paletteByName, type LabPiece } from "./lab/build.js";
export { MAX_TRIS, OPERATORS, type OpContext } from "./lab/ops.js";
export {
  BASES,
  DEFAULT_GENOME,
  MAX_OPS,
  OPS,
  OP_INTS,
  OP_RANGES,
  WILD_OPS,
  breed,
  decodeGenome,
  encodeGenome,
  genomeKey,
  normalise,
  randomGenome,
  type BaseName,
  type FormRef,
  type Genome,
  type Op,
  type OpName,
} from "./lab/genome.js";
