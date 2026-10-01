/**
 * The glyph pass.
 *
 * Renders the WebGL scene into an offscreen target sized to the cell grid
 * (supersampled), reads it back, and paints one character per cell onto a 2D
 * canvas. Deliberately not three's DOM `AsciiEffect`, which emits a table of
 * <span>s and cannot be rasterised to a 3000px PNG.
 */

import type { Palette } from "@cse/core";
import { WebGLRenderTarget } from "./gl/index.js";
import { CELL_ASPECT, GLYPH_FONT } from "./font.js";

/**
 * Dim -> bright. Ends on the block-element characters so the brightest regions
 * read as solid fill rather than dense punctuation.
 */
export const RAMP = [" ", ".", ":", "-", "=", "+", "*", "#", "%", "▒", "▓", "█"] as const;

/** Supersampling factor per cell. Enough to antialias edges into the ramp. */
const SS = 3;

/** An offscreen colour target the pass renders into and reads back. */
export interface GlyphTarget {
  dispose(): void;
}

/**
 * What the pass needs from a renderer. Both the CSE engine and three.js
 * satisfy it, so the collection and the Lab share one pass.
 */
export interface GlyphRenderer {
  getRenderTarget(): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRenderTarget(target: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(scene: any, camera: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readRenderTargetPixels(target: any, x: number, y: number, w: number, h: number, out: Uint8Array): void;
}

/** Makes the pass's render target: 4x multisampled, `w` x `h` pixels. */
export type TargetFactory = (w: number, h: number) => GlyphTarget;

const engineTarget: TargetFactory = (w, h) => new WebGLRenderTarget(w, h, { samples: 4 });

export interface GlyphFrame {
  cols: number;
  rows: number;
  /** Row-major glyph indices into RAMP. */
  glyphs: Uint8Array;
  /** Row-major ink indices; 5 = accent. */
  inks: Uint8Array;
}

export class GlyphPass {
  readonly cols: number;
  readonly rows: number;
  private target: GlyphTarget;
  private buffer: Uint8Array;
  private frame: GlyphFrame;
  private luma: Float32Array;
  private chroma: Float32Array;
  private hist: Uint32Array;
  /** Previous frame's post-exposure value per cell, for the feedback term. */
  private echo: Float32Array;
  private feedback: number;
  /** Per-frame decay of the trail, scaled by `feedback`. See `sample`. */
  private persistence: number;

  /**
   * @param feedback 0..1. How much of the previous frame's brightness carries
   *        into this one, from the token's `resonance` driver.
   *
   *        Every ASCII renderer, including this one until now, is a one-way
   *        pipeline: geometry in, characters out, nothing downstream. This
   *        closes the loop — the grid the pass produced last frame biases the
   *        luminance it measures this frame, so bright cells leave a decaying
   *        trail as the piece turns and the form is partly drawn by its own
   *        afterimage. Quantised to twelve levels on the way round, so it
   *        terraces into bands rather than smearing.
   *
   *        Applied before auto-exposure on purpose: after it, the trail would
   *        drag the white point and the piece would pump.
   */
  constructor(rows: number, feedback = 0, makeTarget: TargetFactory = engineTarget) {
    this.feedback = Math.max(0, Math.min(1, feedback));
    this.persistence = 0.8 + this.feedback * 0.12;
    this.rows = rows;
    this.cols = Math.round(rows / CELL_ASPECT);
    this.target = makeTarget(this.cols * SS, this.rows * SS);
    this.buffer = new Uint8Array(this.cols * SS * this.rows * SS * 4);
    const cells = this.cols * this.rows;
    this.frame = {
      cols: this.cols,
      rows: this.rows,
      glyphs: new Uint8Array(cells),
      inks: new Uint8Array(cells),
    };
    this.luma = new Float32Array(cells);
    this.chroma = new Float32Array(cells);
    this.echo = new Float32Array(cells);
    this.hist = new Uint32Array(256);
  }

  dispose() {
    this.target.dispose();
  }

  /** Render the scene and reduce it to a grid of glyph + ink indices. */
  sample(
    renderer: GlyphRenderer,
    scene: unknown,
    camera: unknown,
  ): GlyphFrame {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(
      this.target,
      0,
      0,
      this.cols * SS,
      this.rows * SS,
      this.buffer,
    );
    renderer.setRenderTarget(prev);

    const { cols, rows, buffer, luma, chroma } = this;
    const stride = cols * SS * 4;
    const inv = 1 / (SS * SS);
    const cells = cols * rows;

    for (let y = 0; y < rows; y++) {
      // readRenderTargetPixels returns bottom-up; flip so row 0 is the top
      const srcY = rows - 1 - y;
      for (let x = 0; x < cols; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < SS; sy++) {
          let o = (srcY * SS + sy) * stride + x * SS * 4;
          for (let sx = 0; sx < SS; sx++) {
            r += buffer[o];
            g += buffer[o + 1];
            b += buffer[o + 2];
            o += 4;
          }
        }
        r *= inv;
        g *= inv;
        b *= inv;
        const i = y * cols + x;
        // Rec. 601 luma, which tracks perceived brightness better than a mean
        luma[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const maxc = Math.max(r, g, b);
        const minc = Math.min(r, g, b);
        chroma[i] = maxc === 0 ? 0 : (maxc - minc) / maxc;
      }
    }

    // The feedback term, before exposure. `echo` holds the previous frame's
    // quantised glyph level; adding a decayed share of it to this frame's
    // luminance is what leaves the trail.
    if (this.feedback > 0) {
      // Super-linear in the driver, so the top of the axis separates from the
      // middle instead of reading as slightly brighter.
      //
      // The ceiling is the constraint here, and it is tighter than it looks. A
      // fully lit cell settles at `echo = persistence`, so its own contribution
      // back into luma is `persistence * k` — at 0.85 that is 0.78, which drives
      // every lit cell straight through the clamp and turns the piece into solid
      // slabs with no glyph texture left. The trail has to come from *duration*,
      // which `persistence` provides, not from gain.
      const k = Math.pow(this.feedback, 0.8) * 0.6;
      for (let i = 0; i < cells; i++) luma[i] = Math.min(1, luma[i] + this.echo[i] * k);
    }

    // Auto-exposure. Scenes differ enormously in how much of the frame they
    // light — an Orbital is mostly empty, a Tessellation fills it — so without
    // normalising, sparse pieces collapse to a few blown-out blobs and dense
    // ones clip. The histogram covers only cells that actually carry light:
    // including the black background would let it dominate the percentile and
    // push the white point far too high on sparse compositions.
    const BUCKETS = 256;
    const FLOOR = 0.012;
    const hist = this.hist.fill(0);
    let lit = 0;
    for (let i = 0; i < cells; i++) {
      if (luma[i] <= FLOOR) continue;
      hist[Math.min(BUCKETS - 1, (luma[i] * BUCKETS) | 0)]++;
      lit++;
    }
    let white = BUCKETS - 1;
    if (lit > 0) {
      const target = lit * 0.92;
      let acc = 0;
      for (let b = 0; b < BUCKETS; b++) {
        acc += hist[b];
        if (acc >= target) {
          white = b;
          break;
        }
      }
    }
    const gain = 1 / Math.max(0.06, (white + 1) / BUCKETS);

    for (let i = 0; i < cells; i++) {
      // slight lift so faint structure reaches the first visible glyph
      const v = Math.min(1, Math.pow(luma[i] * gain, 0.85));
      const glyph = Math.min(RAMP.length - 1, Math.floor(v * RAMP.length));
      this.frame.glyphs[i] = glyph;
      this.frame.inks[i] =
        chroma[i] > 0.45 && v > 0.18 ? 5 : Math.min(4, Math.floor(v * 5.999));
      // Carry the *quantised* level, not the raw value — the twelve steps are
      // what make the trail band instead of blur. Decayed so it dies out over a
      // bounded number of frames rather than accumulating without bound.
      //
      // How many frames is itself a function of the driver: at a fixed 0.82 the
      // trail died in about a dozen frames whatever the token, so a Runaway
      // piece differed from an Echo one only in brightness and never in the
      // length of what it dragged behind it. `this.persistence` stretches that
      // to roughly thirty at the top of the axis, which is the difference
      // between a glow and a trail.
      if (this.feedback > 0) {
        this.echo[i] =
          Math.max(this.echo[i] * this.persistence, glyph / (RAMP.length - 1)) * this.persistence;
      }
    }
    return this.frame;
  }

  /**
   * Clear the trail. Called before a still capture so a PNG is a function of the
   * pose alone rather than of how long the tab happened to be open.
   */
  resetEcho() {
    this.echo.fill(0);
  }

  /** Paint the sampled grid onto a 2D context at `size` x `size` pixels. */
  paint(ctx: CanvasRenderingContext2D, size: number, palette: Palette) {
    const { cols, rows, frame } = this;
    const cellW = size / cols;
    const cellH = size / rows;

    ctx.save();
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, size, size);
    ctx.font = `${cellH}px "${GLYPH_FONT}", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const inks = [...palette.ink, palette.accent];
    // batch by ink so the canvas state changes 6 times instead of once per cell
    for (let ink = 0; ink < inks.length; ink++) {
      ctx.fillStyle = inks[ink];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (frame.inks[i] !== ink) continue;
          const gi = frame.glyphs[i];
          if (gi === 0) continue;
          ctx.fillText(RAMP[gi], (x + 0.5) * cellW, (y + 0.55) * cellH);
        }
      }
    }
    ctx.restore();
  }

  /**
   * Serialise the current grid as an SVG of <text> rows — the vector master.
   * One <text> per row keeps the file small and the glyph grid exactly intact.
   */
  toSVG(size: number, palette: Palette): string {
    const { cols, rows, frame } = this;
    const cellW = size / cols;
    const cellH = size / rows;
    const inks = [...palette.ink, palette.accent];
    const lines: string[] = [];

    for (let y = 0; y < rows; y++) {
      // split each row into runs of constant ink so colour survives per-glyph
      let runStart = 0;
      let runInk = frame.inks[y * cols];
      const flush = (end: number) => {
        let text = "";
        for (let x = runStart; x < end; x++) text += RAMP[frame.glyphs[y * cols + x]];
        if (text.trim() === "") return;
        lines.push(
          `<text x="${(runStart * cellW).toFixed(2)}" y="${((y + 0.75) * cellH).toFixed(2)}" fill="${inks[runInk]}" xml:space="preserve">${escapeXml(text)}</text>`,
        );
      };
      for (let x = 1; x <= cols; x++) {
        if (x === cols || frame.inks[y * cols + x] !== runInk) {
          flush(x);
          runStart = x;
          if (x < cols) runInk = frame.inks[y * cols + x];
        }
      }
    }

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
      `<rect width="${size}" height="${size}" fill="${palette.bg}"/>`,
      `<g font-family="JetBrains Mono, monospace" font-size="${cellH.toFixed(2)}" letter-spacing="0">`,
      ...lines,
      `</g></svg>`,
    ].join("\n");
  }

  /** Plain-text dump of the grid — the ANSI master, useful for diffing. */
  toText(): string {
    const out: string[] = [];
    for (let y = 0; y < this.rows; y++) {
      let line = "";
      for (let x = 0; x < this.cols; x++) line += RAMP[this.frame.glyphs[y * this.cols + x]];
      out.push(line.replace(/\s+$/, ""));
    }
    return out.join("\n");
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}
