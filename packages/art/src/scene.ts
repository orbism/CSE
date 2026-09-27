/**
 * Scene assembly: turn a derived Token into a renderable three.js world plus a
 * configured glyph pass. Everything here is a pure function of the token, so
 * the demo box on the site and the pinned bundle produce identical output.
 */

import * as THREE from "three";
import { type Palette, type Token, rngFromHex } from "@cse/core";
import { BUILDERS, FRAMING, type Anchor, type BuildContext } from "./archetypes.js";
import { GlyphPass } from "./ascii.js";
import { addLights } from "./materials.js";

export interface Piece {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pass: GlyphPass;
  /** Root group; the render loop spins this. */
  body: THREE.Group;
  token: Token;
  /** Radians per second, signed by the phase. */
  spin: number;
  /** The palette this piece renders in — the token's own unless overridden. */
  palette: Palette;
  /**
   * HUD annotations, as Object3Ds parented into the body so their world
   * positions follow the rotation. Projected to screen space by the viewer.
   */
  anchors: { node: THREE.Object3D; anchor: Anchor }[];
  /** Measured framing, surfaced for diagnostics. */
  framing: { radius: number; dist: number; margin: number; extent: number[] };
}

export interface BuildOptions {
  /**
   * Render in this palette instead of the token's own.
   *
   * Used for the documentation stills, where every form is shown side by side
   * need one shared colour so the difference between them reads as shape rather
   * than hue. It deliberately takes a Palette object rather than an index into
   * PALETTES: adding an entry to that array would shift `paletteOf`, which
   * indexes it modulo its length, and silently recolour the entire collection.
   */
  palette?: Palette;
}

export function buildPiece(token: Token, options: BuildOptions = {}): Piece {
  const { traits, drivers, solution } = token;
  const palette = options.palette ?? traits.palette;
  const rng = rngFromHex(token.seed);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.bg);
  addLights(scene, palette);

  // Roots live in the complex plane; the phase rotates the whole omega-triad
  // by a third of a turn, which is the visual signature of the cube-root branch.
  //
  // Energy re-introduces the scale that `rootPoints` normalised away. Every
  // builder places its bodies from these positions, so this is the one lever
  // that reaches all twenty-two forms: a Still token draws its roots in tight,
  // a Violent one flings them out. The camera auto-fits either way.
  //
  // The camera auto-fit is exactly why the response has to be this wide. Scaling
  // the whole composition uniformly is invisible — the fit cancels it. What
  // reads is the separation *relative to* the body sizes, which are fixed, so
  // only a large multiple registers as a different piece. The previous
  // `0.72 + e * 0.62` spanned 2.30 to 4.29, a 1.9x range across the entire
  // collection and a mere 1.26x across the whole of the Violent band: the top
  // of the axis looked like the middle of it. This spans 1.76 to 6.40, and the
  // exponent puts most of that growth in the upper half where the bands the
  // trait actually names live.
  const spread = 3.2 * (0.55 + Math.pow(drivers.energy, 1.25) * 1.45);
  const turn = (traits.phase * Math.PI * 2) / 3;
  const roots = drivers.rootPoints.map(([re, im]) => {
    const x = re * spread;
    const y = im * spread;
    return new THREE.Vector3(
      x * Math.cos(turn) - y * Math.sin(turn),
      x * Math.sin(turn) + y * Math.cos(turn),
      0,
    );
  });

  const anchors: Anchor[] = [];
  const ctx: BuildContext = {
    rng,
    annotate: (at, label, detail, term) => anchors.push({ at: at.clone(), label, detail, term }),
    palette,
    roots,
    rootIsReal: solution.depressedRoots.map((r) => Math.abs(r.im) < 1e-9),
    rootValues: solution.depressedRoots.map((r) =>
      Math.abs(r.im) < 1e-9
        ? r.re.toFixed(3)
        : `${r.re.toFixed(3)} ${r.im < 0 ? "−" : "+"} ${Math.abs(r.im).toFixed(3)}i`,
    ),
    discEnergy: drivers.discEnergy,
    discriminantClass: traits.discriminantClass,
    curvature: drivers.curvature,
    scale: drivers.scale,
    shift: drivers.shift,
    pqRatio: drivers.pqRatio,
    phase: traits.phase,
    phaseAngleSpin: drivers.phaseAngle,
  };

  const body = BUILDERS[traits.structure](ctx);
  scene.add(body);


  // Auto-framing. The archetypes differ by more than an order of
  // magnitude in extent, and the coefficients push that further, so a per-
  // archetype distance constant cannot keep them all inside the frame. Measure
  // the built geometry instead and fit it.
  const pivot = new THREE.Group();
  const box = new THREE.Box3().setFromObject(body);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  body.position.sub(sphere.center);
  pivot.add(body);
  scene.remove(body);
  scene.add(pivot);

  // The depression's a/3 shift becomes a real translation, expressed relative
  // to the piece's own size so it reads the same at every extent.
  const radius = Math.max(0.5, sphere.radius);
  pivot.position.x += Math.tanh(drivers.shift / 4) * radius * 0.35;

  const framing = FRAMING[traits.structure];
  const fov = 38;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
  const dir = new THREE.Vector3(0, framing.elevation, 1 - framing.elevation * 0.3).normalize();

  // `scale` no longer zooms the geometry — it decides how tightly the piece is
  // framed, which is the same compositional signal without the overflow risk.
  const fill = 0.72 + Math.min(0.24, drivers.scale * 0.1);

  // Fit to the projected bounding box, not the bounding sphere: the sphere
  // badly over-estimates flat or elongated forms (a Grid, a Tower), which left
  // every piece marooned in the middle of the frame. Solving for the actual
  // NDC extent is a contraction, so a few iterations converge.
  const corners: THREE.Vector3[] = [];
  const local = box.clone().translate(sphere.center.clone().negate());
  for (const x of [local.min.x, local.max.x])
    for (const y of [local.min.y, local.max.y])
      for (const z of [local.min.z, local.max.z]) corners.push(new THREE.Vector3(x, y, z));

  let dist = radius / Math.sin((fov * Math.PI) / 360);
  for (let iter = 0; iter < 8; iter++) {
    camera.position.copy(dir).multiplyScalar(dist);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    let extent = 0;
    for (const c of corners) {
      const ndc = c.clone().project(camera);
      extent = Math.max(extent, Math.abs(ndc.x), Math.abs(ndc.y));
    }
    if (!Number.isFinite(extent) || extent <= 1e-6) break;
    const next = dist * (extent / fill);
    if (Math.abs(next - dist) < dist * 1e-3) {
      dist = next;
      break;
    }
    dist = next;
  }
  camera.position.copy(dir).multiplyScalar(dist);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  // Depth fog is what gives the glyph ramp something to shade with: without it
  // evenly lit surfaces flatten into large blocks of the same character.
  scene.fog = new THREE.Fog(new THREE.Color(0x000000), dist - radius * 1.1, dist + radius * 1.6);



  // Two callouts on the same feature read as a mistake: several builders
  // annotate a root that rootMarkers has already labelled. Keep whichever says
  // more — the archetype-specific text — and drop the bare duplicate.
  const merged: Anchor[] = [];
  const near = Math.max(0.35, sphere.radius * 0.09);
  for (const a of anchors) {
    const clash = merged.findIndex((b) => b.at.distanceTo(a.at) < near);
    if (clash === -1) {
      merged.push(a);
    } else if (a.detail.length > merged[clash].detail.length) {
      merged[clash] = a;
    }
  }

  // Attach the anchors to the body so they rotate with the geometry. Empty
  // Object3Ds: they exist only to be projected, never rendered.
  const anchorNodes = merged.map((anchor) => {
    const node = new THREE.Object3D();
    node.position.copy(anchor.at);
    body.add(node);
    return { node, anchor };
  });

  const pass = new GlyphPass(drivers.density, drivers.resonance);

  return {
    scene,
    camera,
    pass,
    body: pivot,
    token,
    palette,
    anchors: anchorNodes,
    framing: { radius, dist, margin: fill, extent: box.getSize(new THREE.Vector3()).toArray() },
    // Energy drives the rate as well as the geometry — a Violent token should
    // not turn at a Still token's pace. It also feeds the trail: the echo is a
    // function of how far the form moves between frames, so a faster piece
    // smears further at the same feedback setting.
    spin:
      (traits.phase === 1 ? -1 : 1) *
      (0.06 + drivers.pqRatio * 0.08 + drivers.energy * 0.09),
  };
}

export function disposePiece(piece: Piece) {
  piece.pass.dispose();
  piece.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}
