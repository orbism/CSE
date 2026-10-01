/**
 * A collection Form as the Lab's starting shape.
 *
 * The Form is built by the real archetype builder on the CSE engine — the same
 * geometry the collection renders — then flattened into the single
 * non-indexed triangle mesh every Lab operator expects:
 *
 *   meshes            their triangles, in world space
 *   instanced meshes  one copy per instance
 *   points            a small octahedron per particle (thinned to a budget)
 *   lines, wireframes a thin three-sided strut per edge
 *
 * Points and lines have no surface of their own, and without one an operator
 * has nothing to act on and the glyph pass nothing to shade.
 */

import * as THREE from "three";
import { deriveToken } from "@cse/core";
import * as GL from "../gl/index.js";
import { buildPiece, disposePiece } from "../scene.js";
import type { FormRef } from "./genome.js";

/** Most particles a Form may turn into solids; a Cascade carries 15,600. */
const MAX_PARTICLES = 1500;
const STRUT = 0.025;

export function formGeometry(master: string, ref: FormRef): THREE.BufferGeometry {
  const piece = buildPiece(deriveToken(master, ref.id, ref.nonce));
  piece.scene.updateMatrixWorld();
  const out: number[] = [];
  const a = new GL.Vector3(),
    b = new GL.Vector3(),
    c = new GL.Vector3();
  const m = new GL.Matrix4();

  const vertex = (g: GL.BufferGeometry, i: number, mat: GL.Matrix4, v: GL.Vector3) =>
    v.fromBufferAttribute(g.attributes.position, i).applyMatrix4(mat);
  const tri = (p: GL.Vector3, q: GL.Vector3, r: GL.Vector3) => out.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  const corners = (g: GL.BufferGeometry) =>
    g.index ? Array.from(g.index.array) : Array.from({ length: g.attributes.position.count }, (_, i) => i);

  const triangles = (g: GL.BufferGeometry, mat: GL.Matrix4) => {
    const idx = corners(g);
    for (let i = 0; i + 2 < idx.length; i += 3)
      tri(vertex(g, idx[i], mat, a), vertex(g, idx[i + 1], mat, b), vertex(g, idx[i + 2], mat, c));
  };

  /** A three-sided prism along p..q. */
  const strut = (p: GL.Vector3, q: GL.Vector3) => {
    const dir = q.clone().sub(p);
    if (dir.lengthSq() < 1e-10) return;
    dir.normalize();
    const side = new GL.Vector3(dir.y, -dir.x, 0);
    if (side.lengthSq() < 1e-6) side.set(0, dir.z, -dir.y);
    side.normalize();
    const up = new GL.Vector3().crossVectors(dir, side);
    const ring = (o: GL.Vector3) =>
      [0, 1, 2].map((k) => {
        const t = (k / 3) * Math.PI * 2;
        return o.clone().addScaledVector(side, Math.cos(t) * STRUT).addScaledVector(up, Math.sin(t) * STRUT);
      });
    const r0 = ring(p),
      r1 = ring(q);
    for (let k = 0; k < 3; k++) {
      const n = (k + 1) % 3;
      tri(r0[k], r1[k], r1[n]);
      tri(r0[k], r1[n], r0[n]);
    }
  };

  const edges = (g: GL.BufferGeometry, mat: GL.Matrix4, pairs: [number, number][]) => {
    const seen = new Set<string>();
    for (const [i, j] of pairs) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      strut(vertex(g, i, mat, a).clone(), vertex(g, j, mat, b).clone());
    }
  };

  piece.body.traverse((o) => {
    if (!(o instanceof GL.Drawable) || !o.visible) return;
    const g = o.geometry;
    if (o instanceof GL.Points) {
      const n = g.attributes.position.count;
      const stride = Math.max(1, Math.ceil(n / MAX_PARTICLES));
      const dot = new GL.OctahedronGeometry(o.material.size * 0.5);
      for (let i = 0; i < n; i += stride) {
        vertex(g, i, o.matrixWorld, a);
        triangles(dot, m.makeTranslation(a.x, a.y, a.z));
      }
    } else if (o instanceof GL.LineSegments) {
      const n = g.attributes.position.count;
      edges(g, o.matrixWorld, Array.from({ length: n >> 1 }, (_, k) => [2 * k, 2 * k + 1] as [number, number]));
    } else if (o.material.wireframe) {
      const idx = corners(g);
      const pairs: [number, number][] = [];
      for (let i = 0; i + 2 < idx.length; i += 3)
        pairs.push([idx[i], idx[i + 1]], [idx[i + 1], idx[i + 2]], [idx[i + 2], idx[i]]);
      edges(g, o.matrixWorld, pairs);
    } else if (o instanceof GL.InstancedMesh) {
      for (let i = 0; i < o.count; i++)
        triangles(g, m.multiplyMatrices(o.matrixWorld, new GL.Matrix4().fromArray(o.instanceMatrix.array, i * 16)));
    } else triangles(g, o.matrixWorld);
  });

  disposePiece(piece);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  return geo;
}
