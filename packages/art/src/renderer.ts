/**
 * Render driver. Owns the WebGL context and the 2D glyph canvas, and exposes
 * the capture entry points the generator drives from Playwright.
 */

import * as THREE from "./gl/index.js";
import { type Token, deriveToken } from "@cse/core";
import { GlyphPass } from "./ascii.js";
import { loadGlyphFont } from "./font.js";
import { drawHud } from "./hud-draw.js";
import { type BuildOptions, type Piece, buildPiece, disposePiece } from "./scene.js";

/**
 * Frames of feedback run before a still. Fixed, so the same pose always yields
 * the same image no matter what came before it.
 *
 * Has to clear the slowest trail the axis can produce, not the average one. The
 * trail decays by `persistence²` per frame, and at the top of the Feedback axis
 * that is 0.92² = 0.846 — after ten frames the echo still holds 19% of its
 * settling value, so a Runaway token's still was a snapshot of the trail on its
 * way up rather than at rest, showing markedly less than the piece actually has.
 * Thirty-two frames puts the residual under 0.5% across the whole axis.
 */
const ECHO_SETTLE = 32;

export interface ProjectedAnchor {
  /** Canvas pixel coordinates of the point being annotated. */
  x: number;
  y: number;
  /** 1 in front, falling to 0 as the anchor rotates behind the body. */
  opacity: number;
  label: string;
  detail: string;
  term: string;
}

export interface AnchorProjection {
  anchors: ProjectedAnchor[];
  /** The piece's centre in canvas pixels — labels are placed radially from it. */
  cx: number;
  cy: number;
  /** Projected radius of the piece's bounding sphere, in canvas pixels. */
  radius: number;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** On-screen size in CSS pixels. Capture overrides this per call. */
  size: number;
  /** Anything a CSS url() accepts — a data URI in the pinned bundle, a path on the site. */
  fontUrl: string;
  animate?: boolean;
}

export class Engine {
  private gl: THREE.WebGLRenderer;
  private glCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private piece: Piece | null = null;
  private raf = 0;
  private t0 = 0;
  /** Animation seconds already consumed, banked when the loop is paused. */
  private elapsed = 0;
  /** Manual rotation from dragging, added on top of the animated spin. */
  private dragYaw = 0;
  private dragPitch = 0;
  private options: EngineOptions;

  constructor(options: EngineOptions) {
    this.options = options;
    const ctx = options.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;

    // separate offscreen canvas for WebGL; the visible one holds the glyphs
    this.glCanvas = document.createElement("canvas");
    this.gl = new THREE.WebGLRenderer({
      canvas: this.glCanvas,
      antialias: true,
      preserveDrawingBuffer: false,
    });
    this.gl.setPixelRatio(1);
  }

  static async create(options: EngineOptions): Promise<Engine> {
    await loadGlyphFont(options.fontUrl);
    return new Engine(options);
  }

  get token(): Token | null {
    return this.piece?.token ?? null;
  }

  /** Measured framing for the loaded token — used by the smoke diagnostics. */
  get framing() {
    return this.piece?.framing ?? null;
  }

  load(token: Token, options: BuildOptions = {}) {
    if (this.piece) disposePiece(this.piece);
    this.piece = buildPiece(token, options);
    this.elapsed = 0;
    this.dragYaw = 0;
    this.dragPitch = 0;
    const pass = this.piece.pass;
    this.gl.setSize(pass.cols * 3, pass.rows * 3, false);
    this.resize(this.options.size);
    this.drawFrame(0);
  }

  resize(size: number) {
    this.options.size = size;
    const c = this.options.canvas;
    c.width = size;
    c.height = size;
  }

  private drawFrame(elapsed: number) {
    const piece = this.piece;
    if (!piece) return;
    piece.body.rotation.y = this.dragYaw + elapsed * piece.spin;
    piece.body.rotation.x = this.dragPitch + Math.sin(elapsed * piece.spin * 0.4) * 0.12;
    piece.pass.sample(this.gl, piece.scene, piece.camera);
    piece.pass.paint(this.ctx, this.options.size, piece.palette);
  }

  /**
   * Resume from where the loop was paused rather than from zero.
   *
   * `elapsed` banks the time already played, so pausing and playing again
   * continues the rotation instead of snapping the piece back to its first
   * frame.
   */
  start() {
    if (this.raf) return;
    this.t0 = performance.now();
    const tick = () => {
      this.drawFrame(this.elapsed + (performance.now() - this.t0) / 1000);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    if (!this.raf) return;
    this.elapsed += (performance.now() - this.t0) / 1000;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  /**
   * Turn the piece by hand. Offsets sit on top of the animated spin, so this
   * works whether the loop is running or paused; while paused it is the only
   * thing moving the Form.
   */
  rotateBy(dx: number, dy: number) {
    this.dragYaw += dx;
    // keep the piece from tumbling past vertical
    this.dragPitch = Math.max(-1.2, Math.min(1.2, this.dragPitch + dy));
    if (!this.raf) this.redraw();
  }

  /**
   * Project the HUD anchors into canvas pixel space.
   *
   * `depth` fades an anchor as it swings behind the body: comparing its
   * camera-space distance against the framing distance says which side of the
   * piece it is currently on, which is what stops labels from reading through
   * the geometry.
   */
  projectAnchors(size: number): AnchorProjection {
    const piece = this.piece;
    if (!piece) return { anchors: [], cx: size / 2, cy: size / 2, radius: size * 0.4 };

    const camera = piece.camera;
    camera.updateMatrixWorld();
    piece.body.updateMatrixWorld(true);

    const world = new THREE.Vector3();
    const out: ProjectedAnchor[] = [];

    for (const { node, anchor } of piece.anchors) {
      node.getWorldPosition(world);
      const camSpace = world.clone().applyMatrix4(camera.matrixWorldInverse);
      const distance = -camSpace.z;

      const ndc = world.clone().project(camera);
      if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) continue;

      // 1 at the near side of the piece, 0 once well behind its centre
      const behind = (distance - piece.framing.dist) / Math.max(0.5, piece.framing.radius);
      const opacity = Math.max(0, Math.min(1, 1 - behind * 1.6));

      out.push({
        x: (ndc.x * 0.5 + 0.5) * size,
        y: (-ndc.y * 0.5 + 0.5) * size,
        opacity,
        label: anchor.label,
        detail: anchor.detail,
        term: anchor.term,
      });
    }

    // Centre and on-screen radius of the piece, so the overlay can ring its
    // labels around the silhouette instead of letting each one wander.
    const centre = new THREE.Vector3();
    piece.body.getWorldPosition(centre);
    const centreNdc = centre.clone().project(camera);

    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const edge = centre.clone().addScaledVector(right, piece.framing.radius).project(camera);

    return {
      anchors: out,
      cx: (centreNdc.x * 0.5 + 0.5) * size,
      cy: (-centreNdc.y * 0.5 + 0.5) * size,
      radius: Math.abs(edge.x - centreNdc.x) * 0.5 * size,
    };
  }

  /**
   * Repaint the frame the piece is currently paused on.
   *
   * Capturing mutates the rotation, so after an export the visible canvas would
   * otherwise be left showing whichever frame the encoder asked for last.
   */
  redraw() {
    this.drawFrame(this.elapsed);
  }

  /**
   * Render one deterministic frame at `size` px and return it as a PNG data URL.
   * `atTime` is fixed rather than wall-clock so a token's snapshot is stable
   * across regenerations.
   */
  capture(size: number, atTime = 0, hud = false): string {
    const piece = this.piece;
    if (!piece) throw new Error("no token loaded");
    const prev = this.options.size;
    this.resize(size);
    this.settleEcho(atTime);
    this.drawFrame(atTime);
    if (hud) drawHud(this.ctx, this.projectAnchors(size), size, piece.palette);
    const url = this.options.canvas.toDataURL("image/png");
    this.resize(prev);
    if (!this.raf) this.redraw();
    return url;
  }

  /**
   * Bring the feedback trail to a fixed state before a still.
   *
   * The trail is history, and a token's PNG must be a function of its pose and
   * nothing else — otherwise the cover image depends on how long the tab was
   * open, and two runs of the generator would disagree. Clearing and then
   * running a fixed number of frames at the target pose is deterministic, and it
   * settles to the steady state rather than to an arbitrary point on the way
   * there. At rest that reads as a slight thickening of the lit region; the
   * trail proper only appears in motion.
   */
  private settleEcho(atTime: number) {
    const piece = this.piece;
    if (!piece) return;
    piece.pass.resetEcho();
    // `sample` only, never `paint`. The echo lives on the glyph grid, whose size
    // comes from the token's density and not from the capture size, so painting
    // here would redraw a 3000px canvas ten times per still for no effect on the
    // result — it took a smoke render from 250ms to 4.6s.
    for (let i = 0; i < ECHO_SETTLE; i++) {
      piece.body.rotation.y = this.dragYaw + atTime * piece.spin;
      piece.body.rotation.x = this.dragPitch + Math.sin(atTime * piece.spin * 0.4) * 0.12;
      piece.pass.sample(this.gl, piece.scene, piece.camera);
    }
  }

  /**
   * Walk the trail through one revolution before a loop export.
   *
   * The trail is driven by the pose and the pose is periodic over one turn, so
   * after a full revolution of run-up the state is a function of recent rotation
   * alone — which is what lets the last frame meet the first with the trail
   * still live. Without this the first frames of a GIF have no trail and the
   * last ones do, and the seam is obvious.
   */
  primeLoop(frames: number) {
    const piece = this.piece;
    if (!piece) return;
    piece.pass.resetEcho();
    for (let i = 0; i < frames; i++) {
      piece.body.rotation.y = (i / frames) * Math.PI * 2;
      piece.body.rotation.x = 0;
      piece.pass.sample(this.gl, piece.scene, piece.camera);
    }
  }

  /**
   * One frame of a seamless loop. `t` runs 0..1 over exactly one revolution.
   *
   * The live animation also nods on X at 0.4x the spin rate, which shares no
   * short common period with the Y rotation — sampling that directly would give
   * a GIF whose last frame does not meet its first. Exports therefore rotate on
   * Y only, so t=1 lands exactly back on t=0.
   */
  captureLoopFrame(
    size: number,
    t: number,
    hud = false,
    type: "image/png" | "image/jpeg" = "image/png",
    quality = 0.94,
  ): string {
    const piece = this.piece;
    if (!piece) throw new Error("no token loaded");
    const prev = this.options.size;
    this.resize(size);
    piece.body.rotation.y = t * Math.PI * 2;
    piece.body.rotation.x = 0;
    piece.pass.sample(this.gl, piece.scene, piece.camera);
    piece.pass.paint(this.ctx, size, piece.palette);
    if (hud) drawHud(this.ctx, this.projectAnchors(size), size, piece.palette);
    const url = this.options.canvas.toDataURL(type, quality);
    this.resize(prev);
    return url;
  }

  /** Same, but as raw pixels — avoids a base64 round-trip per frame. */
  captureLoopPixels(size: number, t: number, hud = false): ImageData {
    const piece = this.piece;
    if (!piece) throw new Error("no token loaded");
    const prev = this.options.size;
    this.resize(size);
    piece.body.rotation.y = t * Math.PI * 2;
    piece.body.rotation.x = 0;
    piece.pass.sample(this.gl, piece.scene, piece.camera);
    piece.pass.paint(this.ctx, size, piece.palette);
    if (hud) drawHud(this.ctx, this.projectAnchors(size), size, piece.palette);
    const data = this.ctx.getImageData(0, 0, size, size);
    this.resize(prev);
    return data;
  }

  captureSVG(size: number, atTime = 0): string {
    const piece = this.piece;
    if (!piece) throw new Error("no token loaded");
    this.settleEcho(atTime);
    piece.body.rotation.y = atTime * piece.spin;
    piece.body.rotation.x = Math.sin(atTime * piece.spin * 0.4) * 0.12;
    piece.pass.sample(this.gl, piece.scene, piece.camera);
    return piece.pass.toSVG(size, piece.palette);
  }

  captureText(atTime = 0): string {
    const piece = this.piece;
    if (!piece) throw new Error("no token loaded");
    this.settleEcho(atTime);
    piece.body.rotation.y = atTime * piece.spin;
    piece.pass.sample(this.gl, piece.scene, piece.camera);
    return piece.pass.toText();
  }

  /** Small monochrome grid used by the generator's perceptual-hash gate. */
  fingerprint(atTime = 0): number[] {
    const piece = this.piece;
    if (!piece) throw new Error("no token loaded");
    piece.body.rotation.y = atTime * piece.spin;
    const frame = piece.pass.sample(this.gl, piece.scene, piece.camera);
    // downsample the glyph grid to 16x16 average intensities
    const N = 16;
    const out = new Array(N * N).fill(0);
    const counts = new Array(N * N).fill(0);
    for (let y = 0; y < frame.rows; y++) {
      const oy = Math.min(N - 1, Math.floor((y / frame.rows) * N));
      for (let x = 0; x < frame.cols; x++) {
        const ox = Math.min(N - 1, Math.floor((x / frame.cols) * N));
        out[oy * N + ox] += frame.glyphs[y * frame.cols + x];
        counts[oy * N + ox]++;
      }
    }
    return out.map((v, i) => (counts[i] ? v / counts[i] : 0));
  }

  dispose() {
    this.stop();
    if (this.piece) disposePiece(this.piece);
    this.gl.dispose();
  }
}

/** Convenience for the site's demo box and the standalone bundle. */
export { deriveToken, GlyphPass };
