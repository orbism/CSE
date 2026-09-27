/**
 * The operator algebra.
 *
 * Every operator is `(geometry, ctx) -> geometry` over a **non-indexed**
 * position+normal buffer, which is what lets them compose in any order without
 * any of them knowing what came before. That is the whole trick: the archetypes
 * are twenty-two fixed compositions, this is a set of verbs.
 *
 * Non-indexed on purpose. Half of these operators are per-triangle (shatter,
 * punch, extrude-like behaviour), and shared vertices make per-triangle work
 * either wrong or a re-index every step.
 *
 * Every operator must respect the triangle budget. Several multiply the mesh —
 * `tile` by n², `recurse` by up to 3^d — and without a cap a three-operator
 * chain can ask for tens of millions of triangles and take the tab with it.
 */

import * as THREE from "three";

/** Hard ceiling on triangles. Past this the CPU feedback pass stops being live. */
export const MAX_TRIS = 60_000;

export interface OpContext {
  /** Root positions, 3..5 of them, in the same XY plane the collection uses. */
  roots: THREE.Vector3[];
  energy: number;
  curvature: number;
  /** Deterministic; every operator that needs randomness draws from this. */
  rand: () => number;
}

const triCount = (g: THREE.BufferGeometry) => g.getAttribute("position").count / 3;

/** Field strength from the roots — the same inverse-square shape the collection uses. */
export function field(p: THREE.Vector3, roots: THREE.Vector3[]): number {
  let v = 0;
  for (const r of roots) v += 1 / (0.35 + p.distanceToSquared(r));
  return v;
}

/** Concatenate non-indexed position+normal geometries. */
function concat(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = parts.reduce((n, g) => n + g.getAttribute("position").count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let at = 0;
  for (const g of parts) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const n = g.getAttribute("normal") as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, at * 3);
    nor.set(n.array as Float32Array, at * 3);
    at += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Apply a per-vertex map, then rebuild normals so lighting follows the change. */
function mapVertices(
  g: THREE.BufferGeometry,
  fn: (p: THREE.Vector3, normal: THREE.Vector3, i: number) => void,
): THREE.BufferGeometry {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    fn(p, n, i);
    // A single NaN spreads to the bounding sphere and blanks the whole render,
    // so it is cheaper to catch it here than to debug an empty canvas.
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Per-triangle map: receives the three corners and the face normal. */
function mapTriangles(
  g: THREE.BufferGeometry,
  fn: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, normal: THREE.Vector3, t: number) => boolean | void,
): THREE.BufferGeometry {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const tris = pos.count / 3;
  const kept: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    n.copy(ac.subVectors(c, a).cross(ab.subVectors(b, a))).normalize();
    if (!Number.isFinite(n.x)) n.set(0, 1, 0);
    const keep = fn(a, b, c, n, t);
    if (keep === false) continue;
    kept.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
  out.computeVertexNormals();
  g.dispose();
  return out;
}

/** Clone with the transform baked in, so copies stay one flat buffer. */
function transformed(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const copy = g.clone();
  copy.applyMatrix4(m);
  return copy;
}

// ------------------------------------------------------------------ operators

export type Operator = (g: THREE.BufferGeometry, args: number[], ctx: OpContext) => THREE.BufferGeometry;

export const OPERATORS: Record<string, Operator> = {
  /** Push vertices along their normal by the root field. The shared shaping term. */
  warp: (g, [k = 0.6], ctx) =>
    mapVertices(g, (p, n) => {
      p.addScaledVector(n, field(p, ctx.roots) * k * 0.6);
    }),

  /** Rotate about Y in proportion to height. */
  twist: (g, [a = 1], _ctx) =>
    mapVertices(g, (p) => {
      const t = p.y * a * 0.35;
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      const x = p.x * cos - p.z * sin;
      const z = p.x * sin + p.z * cos;
      p.x = x;
      p.z = z;
    }),

  /** Uniform offset along the normal — thickens or erodes. */
  inflate: (g, [k = 0.3]) =>
    mapVertices(g, (p, n) => {
      p.addScaledVector(n, k);
    }),

  /** Break each triangle away along its own face normal. */
  shatter: (g, [k = 0.5], ctx) =>
    mapTriangles(g, (a, b, c, n) => {
      const d = (0.25 + ctx.rand() * 0.75) * k * (0.4 + ctx.energy);
      a.addScaledVector(n, d);
      b.addScaledVector(n, d);
      c.addScaledVector(n, d);
    }),

  /** Flatten into n stacked sheets. */
  laminate: (g, [n = 4, gap = 0.5], ctx) => {
    const count = Math.max(2, Math.min(9, Math.round(n)));
    if (triCount(g) * count > MAX_TRIS) return g;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.Matrix4()
        .makeScale(1, 0.12, 1)
        .setPosition(0, (i - (count - 1) / 2) * gap * (1 + ctx.curvature), 0);
      parts.push(transformed(g, m));
    }
    g.dispose();
    return concat(parts);
  },

  /** Repeat on an n x n lattice in the XZ plane. */
  tile: (g, [n = 3, spread = 1], _ctx) => {
    const count = Math.max(2, Math.min(4, Math.round(n)));
    if (triCount(g) * count * count > MAX_TRIS) return g;
    const parts: THREE.BufferGeometry[] = [];
    const step = 2.4 * spread;
    for (let i = 0; i < count; i++)
      for (let j = 0; j < count; j++) {
        const m = new THREE.Matrix4()
          .makeScale(1 / count, 1 / count, 1 / count)
          .setPosition((i - (count - 1) / 2) * step, 0, (j - (count - 1) / 2) * step);
        parts.push(transformed(g, m));
      }
    g.dispose();
    return concat(parts);
  },

  /** Self-similar copies placed at the roots, to depth d. */
  recurse: (g, [d = 2, ratio = 0.45], ctx) => {
    const depth = Math.max(1, Math.min(3, Math.round(d)));
    const r = Math.max(0.2, Math.min(0.75, ratio));
    let current = g;
    for (let level = 0; level < depth; level++) {
      const scale = r ** (level + 1);
      if (triCount(current) * (1 + ctx.roots.length) > MAX_TRIS) break;
      const parts: THREE.BufferGeometry[] = [current.clone()];
      for (const root of ctx.roots) {
        const m = new THREE.Matrix4()
          .makeScale(scale, scale, scale)
          .setPosition(root.x, root.y, root.z);
        parts.push(transformed(current, m));
      }
      current.dispose();
      current = concat(parts);
    }
    return current;
  },

  /**
   * Remove triangles the roots reach — mass defined by what is missing.
   *
   * Counts survivors first. A threshold low enough to delete every triangle
   * leaves a blank canvas, and an operator that annihilates the form is worse
   * than one that does nothing, so in that case it does nothing.
   */
  punch: (g, [t = 0.6], ctx) => {
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const tris = pos.count / 3;
    const keep = new Uint8Array(tris);
    let survivors = 0;
    const mid = new THREE.Vector3();
    for (let i = 0; i < tris; i++) {
      mid.set(
        (pos.getX(i * 3) + pos.getX(i * 3 + 1) + pos.getX(i * 3 + 2)) / 3,
        (pos.getY(i * 3) + pos.getY(i * 3 + 1) + pos.getY(i * 3 + 2)) / 3,
        (pos.getZ(i * 3) + pos.getZ(i * 3 + 1) + pos.getZ(i * 3 + 2)) / 3,
      );
      if (field(mid, ctx.roots) <= t) {
        keep[i] = 1;
        survivors++;
      }
    }
    if (survivors === 0 || survivors === tris) return g;
    return mapTriangles(g, (_a, _b, _c, _n, i) => keep[i] === 1);
  },

  /**
   * Inversion in the unit sphere: p -> p / |p|^2k.
   *
   * The one operator that reliably produces something nobody predicted. It turns
   * the inside out, sends near-origin geometry to infinity and vice versa, so it
   * needs a floor on |p| and a ceiling on the result or it emits infinities.
   */
  mobius: (g, [k = 0.8]) =>
    mapVertices(g, (p) => {
      const len2 = Math.max(0.05, p.lengthSq());
      const s = 1 / len2 ** Math.max(0.1, k);
      p.multiplyScalar(Math.min(6, s));
    }),

  /** Discard the mesh and lathe its silhouette instead. */
  revolve: (g, [seg = 12], ctx) => {
    const segments = Math.max(3, Math.min(24, Math.round(seg)));
    const pos = g.getAttribute("position") as THREE.BufferAttribute;

    // profile: max radius seen at each height band
    const BANDS = 32;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minY) || maxY - minY < 1e-6) return g;

    const radii = new Float32Array(BANDS);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const band = Math.min(BANDS - 1, Math.floor(((y - minY) / (maxY - minY)) * BANDS));
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (r > radii[band]) radii[band] = r;
    }

    const profile: THREE.Vector2[] = [];
    for (let i = 0; i < BANDS; i++) {
      const y = minY + ((i + 0.5) / BANDS) * (maxY - minY);
      profile.push(new THREE.Vector2(Math.max(0.03, radii[i] * (1 + ctx.curvature * 0.3)), y));
    }
    g.dispose();
    const lathe = new THREE.LatheGeometry(profile, segments);
    // indexed in every three.js version so far, but ask only if it is — the
    // conversion warns when handed a buffer that is already flat
    return lathe.index ? lathe.toNonIndexed() : lathe;
  },

  /** Scatter shrunken copies along a (p,q) torus knot. */
  braid: (g, [p = 3, q = 2], ctx) => {
    const P = Math.max(2, Math.min(7, Math.round(p)));
    const Q = Math.max(2, Math.min(7, Math.round(q)));
    const copies = 14;
    if (triCount(g) * copies > MAX_TRIS) return g;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < copies; i++) {
      const t = (i / copies) * Math.PI * 2;
      const r = 2 + Math.cos(Q * t) * 0.9;
      const m = new THREE.Matrix4()
        .makeScale(0.28, 0.28, 0.28)
        .setPosition(
          Math.cos(P * t) * r,
          Math.sin(Q * t) * (1.2 + ctx.curvature),
          Math.sin(P * t) * r,
        );
      parts.push(transformed(g, m));
    }
    g.dispose();
    return concat(parts);
  },

  /** Slide along X in proportion to height. Cheap, and reads immediately. */
  shear: (g, [k = 0.5]) =>
    mapVertices(g, (p) => {
      p.x += p.y * k * 0.4;
    }),
};
