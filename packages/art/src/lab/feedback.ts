/**
 * The feedback step, as a pure function.
 *
 * Extracted from the engine so it can be tested without a GPU. This is the part
 * of the Lab most able to ruin everything — an accumulator with gain and no
 * bound reaches infinity in a couple of seconds, and a single non-finite vertex
 * poisons the bounding sphere and blanks the canvas — so it is worth being able
 * to assert its behaviour directly rather than by squinting at a render.
 *
 * The loop it implements: frame N's glyph grid displaces frame N+1's vertices
 * along their normals. Because the grid holds glyph *indices* (0..11), not
 * luminance, the displacement is quantised, and the surface terraces into bands
 * rather than smearing the way continuous video feedback does.
 */

/** Ceiling on accumulated displacement, as a fraction of the piece's radius. */
export const MAX_DISPLACEMENT = 0.35;
/** Pulls the accumulator toward zero each step so gain cannot run away. */
export const DECAY = 0.86;
/** Glyph ramp length - 1; the grid's top index. */
const RAMP_TOP = 11;

export interface FeedbackGrid {
  cols: number;
  rows: number;
  glyphs: Uint8Array;
}

export interface FeedbackStep {
  /** Un-displaced vertex positions, xyz triples. */
  base: Float32Array;
  normals: Float32Array;
  /** Mutated in place: per-vertex displacement along the normal. */
  accum: Float32Array;
  /** Written in place: base + normal * accum. */
  out: Float32Array;
  grid: FeedbackGrid;
  /** Row-major 4x4, world -> clip, column-major as three.js stores it. */
  mvp: ArrayLike<number>;
  /** Displacement per unit of glyph range. */
  gain: number;
  /** Absolute clamp, in world units. */
  limit: number;
}

/**
 * One step. Returns the number of vertices whose contribution was discarded for
 * being non-finite, which should always be zero and is worth asserting.
 */
export function stepFeedback(s: FeedbackStep): number {
  const { base, normals, accum, out, grid, mvp, gain, limit } = s;
  const count = accum.length;
  let rejected = 0;

  for (let i = 0; i < count; i++) {
    const x = base[i * 3];
    const y = base[i * 3 + 1];
    const z = base[i * 3 + 2];

    // A NaN already in the base mesh must not become a NaN in the output, or
    // one bad vertex takes the whole render with it.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      out[i * 3] = 0;
      out[i * 3 + 1] = 0;
      out[i * 3 + 2] = 0;
      accum[i] = 0;
      rejected++;
      continue;
    }

    // world -> clip -> NDC. three.js matrices are column-major.
    let d = 0;
    const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (Number.isFinite(cw) && Math.abs(cw) > 1e-6) {
      const cx = (mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / cw;
      const cy = (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / cw;
      const gx = ((cx + 1) / 2) * grid.cols;
      const gy = ((1 - cy) / 2) * grid.rows;
      if (gx >= 0 && gy >= 0 && gx < grid.cols && gy < grid.rows) {
        const g = grid.glyphs[(gy | 0) * grid.cols + (gx | 0)] ?? 0;
        // dark cells pull the surface in, bright cells push it out
        d = (g / RAMP_TOP - 0.5) * gain;
      }
    }

    const next = accum[i] * DECAY + d;
    accum[i] = Number.isFinite(next) ? Math.max(-limit, Math.min(limit, next)) : 0;

    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const k = accum[i];
    out[i * 3] = x + (Number.isFinite(nx) ? nx * k : 0);
    out[i * 3 + 1] = y + (Number.isFinite(ny) ? ny * k : 0);
    out[i * 3 + 2] = z + (Number.isFinite(nz) ? nz * k : 0);
  }

  return rejected;
}
