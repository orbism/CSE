/**
 * Genome -> renderable scene.
 *
 * Mirrors what `scene.ts` does for a Token — lights, auto-framing, depth fog,
 * a GlyphPass — but drives the geometry from the operator chain instead of
 * dispatching to a builder. The camera fit is deliberately a separate copy of
 * the same solve rather than a shared helper: `scene.ts` decides what every
 * minted Form looks like, and the Lab is not a good enough reason to touch it.
 */

import * as THREE from "three";
import { PALETTES, type Palette, rngFromHex, sha256Hex } from "@cse/core";
import { GlyphPass } from "../ascii.js";
import { makeMaterials } from "../materials.js";
import { formGeometry } from "./form.js";
import type { Genome } from "./genome.js";
import { MAX_TRIS, OPERATORS, type OpContext } from "./ops.js";

/**
 * The Lab stays on three.js: its operators lean on three's geometry toolkit,
 * and none of it ships on chain. Same materials and lights as the collection,
 * built from three's classes.
 */
const { addLights, surface } = makeMaterials(THREE);
const threeTarget = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, { samples: 4 });

export interface LabPiece {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pass: GlyphPass;
  body: THREE.Group;
  mesh: THREE.Mesh;
  palette: Palette;
  spin: number;
  /** Vertex positions before any feedback displacement. */
  basePositions: Float32Array;
  /** Radius of the fitted bounding sphere; sets the feedback's length scale. */
  radius: number;
  /** Reported so the UI can say when an operator was skipped for cost. */
  triangles: number;
}

const SPREAD = 3.2;

/**
 * Every operator assumes a non-indexed buffer, but the polyhedron primitives
 * already are one, and three.js warns when asked to convert one of those. Ask
 * only when there is an index to remove.
 */
function flatten(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}

function baseGeometry(name: string, curvature: number): THREE.BufferGeometry {
  switch (name) {
    case "torus":
      return flatten(new THREE.TorusGeometry(1.6, 0.55 + curvature * 0.4, 10, 28));
    case "box":
      return flatten(new THREE.BoxGeometry(2.2, 2.2, 2.2, 3, 3, 3));
    case "plane": {
      const g = flatten(new THREE.PlaneGeometry(4.4, 4.4, 14, 14));
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case "helix": {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const a = t * Math.PI * 6;
        pts.push(new THREE.Vector3(Math.cos(a) * 1.4, (t - 0.5) * 4, Math.sin(a) * 1.4));
      }
      return flatten(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.22, 6, false),
      );
    }
    case "roots":
      // three small solids, one per root — the collection's starting point
      return flatten(new THREE.IcosahedronGeometry(0.9, 1));
    default:
      return flatten(new THREE.IcosahedronGeometry(1.5, 2));
  }
}

/** Roots on the unit disc, scaled out, deterministic from the genome's seed. */
function rootsFor(genome: Genome): THREE.Vector3[] {
  const rng = rngFromHex(sha256Hex(`${genome.seed}:roots:${genome.field.degree}`));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < genome.field.degree; i++) {
    const a = (i / genome.field.degree) * Math.PI * 2 + rng.next() * 0.9;
    const r = 0.35 + rng.next() * 0.65;
    out.push(new THREE.Vector3(Math.cos(a) * r * SPREAD, Math.sin(a) * r * SPREAD, 0));
  }
  return out;
}

export function paletteByName(name: string): Palette {
  return PALETTES.find((p) => p.name === name) ?? PALETTES[0];
}

/**
 * @param master the collection's master seed; only read when the genome starts
 *               from a collection Form, which is derived from it
 */
export function buildLabPiece(genome: Genome, master = "CUBIC-SYMMETRY-ENGINE"): LabPiece {
  const palette = paletteByName(genome.render.palette);
  const roots = rootsFor(genome);
  const rng = rngFromHex(sha256Hex(`${genome.seed}:ops`));

  const ctx: OpContext = {
    roots,
    energy: genome.field.energy,
    curvature: genome.field.curvature,
    rand: () => rng.next(),
  };

  let geo = genome.form ? formGeometry(master, genome.form) : baseGeometry(genome.base, genome.field.curvature);
  for (const step of genome.ops) {
    const op = OPERATORS[step.op];
    if (!op) continue;
    try {
      geo = op(geo, step.args, ctx);
    } catch {
      // An operator that throws on a degenerate mesh should cost that operator,
      // not the whole form — the chain is meant to survive its own extremes.
    }
    if (geo.getAttribute("position").count / 3 > MAX_TRIS) break;
  }
  // A chain can still starve the mesh — `revolve` on a flat profile, `tile` on
  // nothing. Falling back to the base solid beats handing the user a blank
  // canvas and calling it experimental.
  if (geo.getAttribute("position").count === 0) {
    geo.dispose();
    geo = baseGeometry(genome.base, genome.field.curvature);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.bg);
  addLights(scene, palette);

  const mesh = new THREE.Mesh(geo, surface(palette, 3));
  (mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;

  const body = new THREE.Group();
  body.add(mesh);

  // ---- framing: same solve as scene.ts, measured rather than assumed
  const pivot = new THREE.Group();
  const box = new THREE.Box3().setFromObject(body);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) sphere.radius = 1;
  body.position.sub(sphere.center);
  pivot.add(body);
  scene.add(pivot);

  const radius = Math.max(0.5, sphere.radius);
  const fov = 38;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
  const elevation = 0.3;
  const dir = new THREE.Vector3(0, elevation, 1 - elevation * 0.3).normalize();
  const fill = 0.78;

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

  // Without fog, evenly lit surfaces flatten to one glyph.
  scene.fog = new THREE.Fog(new THREE.Color(0x000000), dist - radius * 1.1, dist + radius * 1.6);

  const positions = geo.getAttribute("position") as THREE.BufferAttribute;
  return {
    scene,
    camera,
    pass: new GlyphPass(genome.render.rows, 0, threeTarget),
    body: pivot,
    mesh,
    palette,
    spin: genome.render.spin,
    basePositions: Float32Array.from(positions.array as Float32Array),
    radius,
    triangles: positions.count / 3,
  };
}

export function disposeLabPiece(piece: LabPiece) {
  piece.pass.dispose();
  piece.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m?.dispose();
  });
}
