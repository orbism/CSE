/**
 * The Lab's render driver, and the one thing here that is genuinely unusual.
 *
 * ## Glyph-space feedback
 *
 * Every ASCII renderer in the wild — including this project's own `Engine` — is
 * a one-way pipeline: render 3D, measure luminance, choose characters, done. The
 * glyph grid is the last stage, and nothing downstream of it exists.
 *
 * `GlyphPass.sample()` already *returns* that grid. So frame N's characters can
 * displace frame N+1's vertices: the form is partly sculpted by its own
 * rendering. Image -> geometry -> image, closing a loop that is normally open.
 *
 * Self-referential rendering is not new — video feedback dates to the Rutt/Etra
 * synthesiser in 1973, and warping each iteration by the last is a known move.
 * Two things here are not that:
 *
 *   - the feedback passes through a **12-level quantiser**. The grid is glyph
 *     indices, not pixels. Quantised displacement terraces and contours instead
 *     of smearing, and the bands migrate as the form turns.
 *   - it feeds back into **3D geometry**, not into an image buffer, so the
 *     result is lit and shaded as a solid rather than smeared as a picture.
 *
 * It is also unstable, which is the point and also the hazard: an accumulator
 * with gain and no bound reaches NaN in a few seconds, and one NaN vertex takes
 * the bounding sphere and blanks the canvas. Hence the decay and the clamp
 * below, which are load-bearing rather than defensive.
 */

import * as THREE from "three";
import type { GlyphFrame } from "../ascii.js";
import { loadGlyphFont } from "../font.js";
import type { Genome } from "./genome.js";
import { type LabPiece, buildLabPiece, disposeLabPiece } from "./build.js";
import { MAX_DISPLACEMENT as LIMIT_FRACTION, stepFeedback } from "./feedback.js";

export interface LabEngineOptions {
  canvas: HTMLCanvasElement;
  size: number;
  fontUrl: string;
}

/**
 * Frames of feedback run before the first visible paint.
 *
 * Fixed, so a shared genotype settles to the same state everywhere rather than
 * to wherever the viewer's frame rate happened to get to.
 */
export const SETTLE_FRAMES = 24;

export { MAX_DISPLACEMENT, DECAY } from "./feedback.js";

/**
 * Live, per-frame modulation from outside (the Lab's audio input). Offsets on
 * top of the genome, never written back to it, so a share link is unaffected.
 *
 *   pulse     uniform scale offset (0.2 = 20% bigger; negative contracts). The
 *             genome's `energy` is baked into the geometry and too costly to
 *             rebuild per frame; this is its live analog.
 *   squash    squash-and-stretch: widens x/z and flattens y by this fraction.
 *   feedback  added to the genome's feedback gain, clamped to 1.
 *   spin      extra rad/s, integrated so changes never jump the pose.
 *   roll      radians of tilt about the view axis.
 *   glitch    0..1, horizontal raster tear of the painted grid.
 *   flash     0..1, colour inversion over the frame.
 */
export interface LabDrive {
  pulse: number;
  squash: number;
  feedback: number;
  spin: number;
  roll: number;
  glitch: number;
  flash: number;
}

const NEUTRAL: LabDrive = { pulse: 0, squash: 0, feedback: 0, spin: 0, roll: 0, glitch: 0, flash: 0 };

export class LabEngine {
  private gl: THREE.WebGLRenderer;
  private ctx: CanvasRenderingContext2D;
  private piece: LabPiece | null = null;
  private raf = 0;
  private t0 = 0;
  private elapsed = 0;
  private dragYaw = 0;
  private dragPitch = 0;
  private options: LabEngineOptions;

  /** Per-vertex accumulated displacement along the normal. */
  private accum: Float32Array | null = null;
  private lastFrame: GlyphFrame | null = null;
  private feedback = 0;

  private drive: (() => LabDrive) | null = null;
  private live: LabDrive = NEUTRAL;
  /** Integrated extra rotation from `live.spin`. */
  private spinPhase = 0;
  /** Glitch tears persist across frames and slide back as the level decays. */
  private tears: { y: number; h: number; dir: number }[] = [];
  private tearLevel = 0;

  constructor(options: LabEngineOptions) {
    this.options = options;
    const ctx = options.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    const glCanvas = document.createElement("canvas");
    this.gl = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
    this.gl.setPixelRatio(1);
  }

  static async create(options: LabEngineOptions): Promise<LabEngine> {
    await loadGlyphFont(options.fontUrl);
    return new LabEngine(options);
  }

  get triangles(): number {
    return this.piece?.triangles ?? 0;
  }

  load(genome: Genome) {
    if (this.piece) disposeLabPiece(this.piece);
    this.piece = buildLabPiece(genome);
    this.elapsed = 0;
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.spinPhase = 0;
    this.feedback = genome.render.feedback;
    this.lastFrame = null;
    this.accum = new Float32Array(this.piece.basePositions.length / 3);

    this.gl.setSize(this.piece.pass.cols * 3, this.piece.pass.rows * 3, false);
    this.resize(this.options.size);

    // Settle before the first paint so the opening frame is the same everywhere.
    if (this.feedback > 0) for (let i = 0; i < SETTLE_FRAMES; i++) this.drawFrame(0);
    this.drawFrame(0);
  }

  resize(size: number) {
    this.options.size = size;
    this.options.canvas.width = size;
    this.options.canvas.height = size;
  }

  /** Run the field to its settled state at the current pose. */
  settle(frames = SETTLE_FRAMES) {
    if (!this.piece || this.feedback <= 0) return;
    for (let i = 0; i < frames; i++) this.drawFrame(0);
  }

  /**
   * Walk the feedback field through one full revolution before a loop export.
   *
   * The first version froze the field for export instead. That made the loop
   * close, but it also meant the GIF showed a *static* displacement merely
   * rotating — so the one setting the Lab has and the collection does not was
   * the one thing the export threw away.
   *
   * Live feedback closes on its own, given a run-up. The field is driven by the
   * glyph grid, the grid is a function of the pose, and the pose is periodic
   * over one revolution; with `DECAY` at 0.86 the accumulator forgets a step in
   * roughly seven frames, far inside one turn. So after a full revolution of
   * warm-up the state is a function of recent rotation alone, which is exactly
   * the condition for frame N to meet frame 0.
   *
   * Call with the same frame count the export will use — the orbit it settles
   * into depends on the step size.
   */
  primeLoop(frames: number) {
    const piece = this.piece;
    if (!piece || this.feedback <= 0) return;
    const dir = this.loopDirection();
    for (let i = 0; i < frames; i++) {
      piece.body.rotation.y = this.dragYaw + (i / frames) * Math.PI * 2 * dir;
      piece.body.rotation.x = this.dragPitch;
      this.applyFeedback();
      this.lastFrame = piece.pass.sample(this.gl, piece.scene, piece.camera);
    }
  }

  /** Which way a loop turns. Rate comes from the export length; sign is the genome's. */
  private loopDirection(): number {
    return (this.piece?.spin ?? 0) < 0 ? -1 : 1;
  }

  private applyFeedback() {
    const piece = this.piece;
    const frame = this.lastFrame;
    const feedback = Math.min(1, this.feedback + this.live.feedback);
    if (!piece || !frame || !this.accum || feedback <= 0) return;

    const geo = piece.mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const nor = geo.getAttribute("normal") as THREE.BufferAttribute;

    // world -> clip for the current pose, computed once for the whole mesh
    piece.body.updateMatrixWorld(true);
    const mvp = new THREE.Matrix4()
      .multiplyMatrices(piece.camera.projectionMatrix, piece.camera.matrixWorldInverse)
      .multiply(piece.mesh.matrixWorld);

    stepFeedback({
      base: piece.basePositions,
      normals: nor.array as Float32Array,
      accum: this.accum,
      out: pos.array as Float32Array,
      grid: frame,
      mvp: mvp.elements,
      gain: feedback * piece.radius * 0.16,
      limit: LIMIT_FRACTION * piece.radius,
    });
    pos.needsUpdate = true;
  }

  private drawFrame(elapsed: number) {
    const piece = this.piece;
    if (!piece) return;
    piece.body.rotation.y = this.dragYaw + elapsed * piece.spin + this.spinPhase;
    piece.body.rotation.x = this.dragPitch;
    const { pulse, squash, roll } = this.live;
    const k = Math.max(0.4, 1 + pulse);
    piece.body.scale.set(k * (1 + squash), k * (1 - squash), k * (1 + squash));
    piece.body.rotation.z = roll;
    this.applyFeedback();
    this.lastFrame = piece.pass.sample(this.gl, piece.scene, piece.camera);
    piece.pass.paint(this.ctx, this.options.size, piece.palette);
    this.postFx();
  }

  /** Demoscene raster tear and strobe, on the painted 2D canvas. Live drive only. */
  private postFx() {
    const { glitch, flash } = this.live;
    const size = this.options.size;
    const ctx = this.ctx;
    if (glitch > 0.02) {
      // New tears only on a fresh rise; otherwise the same ones ease back.
      if (glitch > this.tearLevel + 0.12 || this.tears.length === 0) {
        this.tears = Array.from({ length: 2 + Math.round(glitch * 8) }, () => ({
          y: Math.random(),
          h: 0.01 + Math.random() * 0.05,
          dir: Math.random() * 2 - 1,
        }));
        this.tearLevel = glitch;
      } else this.tearLevel = Math.min(this.tearLevel, glitch);
      for (const t of this.tears) {
        const y = t.y * size;
        const h = t.h * size;
        ctx.drawImage(this.options.canvas, 0, y, size, h, t.dir * size * 0.14 * glitch, y, size, h);
      }
    } else if (this.tears.length) {
      this.tears = [];
      this.tearLevel = 0;
    }
    if (flash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "difference";
      ctx.globalAlpha = Math.min(1, flash);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.restore();
    }
  }

  start() {
    if (this.raf) return;
    this.t0 = performance.now();
    let last = this.t0;
    const tick = () => {
      const now = performance.now();
      if (this.drive) {
        this.live = this.drive();
        this.spinPhase += Math.min(0.1, (now - last) / 1000) * this.live.spin * this.loopDirection();
      }
      last = now;
      this.drawFrame(this.elapsed + (now - this.t0) / 1000);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (!this.raf) return;
    this.elapsed += (performance.now() - this.t0) / 1000;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    // Stills and exports are taken stopped; they should show the genome, not a beat.
    this.live = NEUTRAL;
  }

  /** Attach a per-frame modulation source, or detach with null. Read only while running. */
  setDrive(fn: (() => LabDrive) | null) {
    this.drive = fn;
    if (!fn) this.live = NEUTRAL;
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  rotateBy(dx: number, dy: number) {
    this.dragYaw += dx;
    this.dragPitch = Math.max(-1.2, Math.min(1.2, this.dragPitch + dy));
    if (!this.raf) this.drawFrame(this.elapsed);
  }

  /** Repaint at the current pose without advancing time. */
  redraw() {
    this.drawFrame(this.elapsed);
  }

  /**
   * Still capture at an arbitrary size.
   *
   * The unused `_atTime` and `_hud` parameters exist so this matches the shape
   * the site's PNG exporter expects; the Lab has no HUD and no wall-clock pose.
   */
  capture(size: number, _atTime = 0, _hud = false): string {
    const piece = this.piece;
    if (!piece) return "";
    const previous = this.options.size;
    this.resize(size);
    this.drawFrame(this.elapsed);
    const url = this.options.canvas.toDataURL("image/png");
    this.resize(previous);
    this.drawFrame(this.elapsed);
    return url;
  }

  /**
   * One frame of a loop, at `turn` in [0,1) of a full revolution.
   *
   * Rotation is set directly rather than derived from a clock, so the frames are
   * a function of `turn` alone. The feedback field keeps evolving — see
   * `primeLoop`, which is what makes that still close.
   */
  captureLoopPixels(size: number, turn: number, _hud = false): ImageData {
    const piece = this.piece;
    if (!piece) throw new Error("nothing loaded");
    const previous = this.options.size;
    this.resize(size);
    piece.body.rotation.y = this.dragYaw + turn * Math.PI * 2 * this.loopDirection();
    piece.body.rotation.x = this.dragPitch;
    this.applyFeedback();
    this.lastFrame = piece.pass.sample(this.gl, piece.scene, piece.camera);
    piece.pass.paint(this.ctx, size, piece.palette);
    const data = this.ctx.getImageData(0, 0, size, size);
    this.resize(previous);
    return data;
  }

  dispose() {
    this.stop();
    if (this.piece) disposeLabPiece(this.piece);
    this.piece = null;
    this.gl.dispose();
  }
}
