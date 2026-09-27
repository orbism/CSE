/**
 * The twenty-two composition archetypes.
 *
 * Each builder returns a Group with a genuinely different topology — a grid is
 * a heightfield, a knot is a braid, a cascade is a particle stream. They are not
 * one scene with twenty-two skins, because the collection rule is that traits
 * drive major composition and every token has to stay identifiable at thumbnail
 * size.
 *
 * Shared inputs across all of them:
 *   roots      three world positions from the roots in the complex plane
 *   discEnergy log |discriminant|, drives fracture / separation magnitude
 *   curvature  from |c|, bends and twists primitives
 *   scale      from |a|
 *   shift      the depression's a/3, applied as a global translation
 */

import * as THREE from "three";
import type { Archetype, Palette, Rng } from "@cse/core";
import { accent, dots, surface, wire } from "./materials.js";

/** Which part of the equation an annotation is attributing work to. */
export type AnchorTerm = "root" | "discriminant" | "phase" | "shift" | "coefficient";

export interface Anchor {
  /** Position in the body's local space; travels with the rotation. */
  at: THREE.Vector3;
  /** Short tag, e.g. "α" or "Δ". */
  label: string;
  /** One line saying what this part of the equation is doing here. */
  detail: string;
  term: AnchorTerm;
}

export interface BuildContext {
  rng: Rng;
  /**
   * Attach an explanation to a point on the geometry.
   *
   * Builders call this for the feature the equation most visibly drives in that
   * form. Deliberately not called everywhere: pointing at an arbitrary particle
   * and claiming it is "where |c| acts" would be decoration pretending to be
   * derivation.
   */
  annotate: (at: THREE.Vector3, label: string, detail: string, term: AnchorTerm) => void;
  palette: Palette;
  /** Root positions in world space, already rotated by the phase. */
  roots: THREE.Vector3[];
  /** True when the root is real (imaginary part negligible). */
  rootIsReal: boolean[];
  /** Printable value of each root, for annotation text. */
  rootValues: string[];
  discEnergy: number;
  discriminantClass: "Separated" | "Fractured" | "Merged";
  curvature: number;
  scale: number;
  shift: number;
  pqRatio: number;
  phase: 0 | 1 | 2;
  /** arg(A) in radians — a continuous companion to the discrete phase. */
  phaseAngleSpin: number;
}

type Builder = (ctx: BuildContext) => THREE.Group;

/** Field strength at a point from the three roots — the shared shaping term. */
function rootField(p: THREE.Vector3, roots: THREE.Vector3[]): number {
  let v = 0;
  for (const r of roots) v += 1 / (0.35 + p.distanceToSquared(r));
  return v;
}

const ROOT_NAMES = ["α", "β", "γ"];

/**
 * Marks each root with a small bright body so the accent ink has something to
 * find — and annotates it.
 *
 * The labelling lives here rather than being added to every Form centrally,
 * because only the Forms that actually draw their roots have anything at those
 * coordinates. Orbital and Spiral build around the roots without placing
 * geometry on them, so a root callout there pointed at empty space.
 */
function rootMarkers(ctx: BuildContext, radius: number): THREE.Group {
  const g = new THREE.Group();
  const mat = accent(ctx.palette);
  for (let i = 0; i < ctx.roots.length; i++) {
    const geo = ctx.rootIsReal[i]
      ? new THREE.OctahedronGeometry(radius)
      : new THREE.IcosahedronGeometry(radius * 0.8, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(ctx.roots[i]);
    g.add(m);
    ctx.annotate(
      ctx.roots[i].clone(),
      ROOT_NAMES[i],
      `root ${ROOT_NAMES[i]} = ${ctx.rootValues[i]}`,
      "root",
    );
  }
  return g;
}

/**
 * The discriminant operator: how the three bodies relate to one another.
 * Separated pushes them apart, Fractured shatters them, Merged fuses them.
 */
function applyDiscriminant(group: THREE.Group, ctx: BuildContext) {
  const k = 0.25 + ctx.discEnergy * 1.5;
  switch (ctx.discriminantClass) {
    case "Separated":
      group.children.forEach((c, i) => {
        const dir = c.position.clone().normalize();
        if (dir.lengthSq() > 0) c.position.addScaledVector(dir, k * (0.4 + i * 0.12));
      });
      break;
    case "Fractured":
      group.children.forEach((c, i) => {
        const a = (i * 2.399963) % (Math.PI * 2);
        c.position.x += Math.cos(a) * k * 0.7;
        c.position.y += Math.sin(a) * k * 0.7;
        c.rotation.z += (i % 2 ? 1 : -1) * ctx.discEnergy * 0.9;
      });
      break;
    case "Merged":
      group.children.forEach((c) => c.position.multiplyScalar(0.28));
      break;
  }
}

// ---------------------------------------------------------------- 1. Grid

const grid: Builder = (ctx) => {
  const g = new THREE.Group();
  const n = 22;
  const span = 7;
  const geo = new THREE.BoxGeometry(span / n * 0.78, 1, span / n * 0.78);
  const mat = surface(ctx.palette, 3);
  const mesh = new THREE.InstancedMesh(geo, mat, n * n);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let x = 0; x < n; x++) {
    for (let z = 0; z < n; z++) {
      const px = (x / (n - 1) - 0.5) * span;
      const pz = (z / (n - 1) - 0.5) * span;
      const p = new THREE.Vector3(px, 0, pz);
      const h = 0.15 + rootField(p, ctx.roots) * (1.2 + ctx.discEnergy * 3);
      m.makeTranslation(px, h / 2, pz);
      m.scale(new THREE.Vector3(1, h, 1));
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  g.add(mesh);
  g.add(rootMarkers(ctx, 0.22));
  g.position.y = -1.2;
  {
    // tallest column: where the three roots pull hardest
    let best = new THREE.Vector3();
    let peak = -1;
    for (let x = 0; x < n; x++)
      for (let z = 0; z < n; z++) {
        const p = new THREE.Vector3((x / (n - 1) - 0.5) * span, 0, (z / (n - 1) - 0.5) * span);
        const f = rootField(p, ctx.roots);
        if (f > peak) { peak = f; best = p; }
      }
    ctx.annotate(
      best.clone().setY(0.15 + peak * (1.2 + ctx.discEnergy * 3) - 1.2),
      "|Δ|",
      "column height = combined pull of all three roots, scaled by the discriminant",
      "discriminant",
    );
  }
  return g;
};

// -------------------------------------------------------------- 2. Radial

const radial: Builder = (ctx) => {
  const g = new THREE.Group();
  const rings = 7 + Math.floor(ctx.pqRatio * 6);
  for (let r = 1; r <= rings; r++) {
    const radius = (r / rings) * 4.2;
    const spokes = 6 + r * 3;
    const ring = new THREE.Group();
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2 + r * ctx.curvature;
      const p = new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      const len = 0.25 + rootField(p, ctx.roots) * 1.6;
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, len, 0.09),
        surface(ctx.palette, 1 + (r % 4)),
      );
      bar.position.copy(p).setY(len / 2);
      ring.add(bar);
    }
    ring.rotation.y = r * 0.13 * (ctx.phase + 1);
    g.add(ring);
  }
  g.add(rootMarkers(ctx, 0.26));
  ctx.annotate(
    new THREE.Vector3(3.2, 0.9, 0.6),
    "ω",
    `rings rotate by the phase, one third of a turn per branch (ω${ctx.phase})`,
    "phase",
  );
  g.position.y = -0.8;
  return g;
};

// --------------------------------------------------------------- 3. Tower

const tower: Builder = (ctx) => {
  const g = new THREE.Group();
  const floors = 26;
  ctx.roots.forEach((root, ri) => {
    const column = new THREE.Group();
    for (let f = 0; f < floors; f++) {
      const t = f / floors;
      const w = (1.5 - t * 0.9) * (0.6 + Math.abs(root.x) * 0.25);
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.16, w),
        surface(ctx.palette, 1 + ((f + ri) % 4)),
      );
      slab.position.y = f * 0.3;
      slab.rotation.y = t * Math.PI * (1 + ctx.curvature * 3) + (ri * Math.PI * 2) / 3;
      column.add(slab);
    }
    column.position.set(root.x * 1.1, -3.2, root.y * 1.1);
    column.userData.rootIndex = ri;
    g.add(column);
  });

  // Annotate after the discriminant operator, which displaces every column —
  // recording the position beforehand left the callouts hanging in the gap the
  // columns had moved out of.
  applyDiscriminant(g, ctx);
  for (const column of g.children) {
    const ri = column.userData.rootIndex as number | undefined;
    if (ri === undefined) continue;
    ctx.annotate(
      column.position.clone().add(new THREE.Vector3(0, (floors - 2) * 0.3, 0)),
      ["α", "β", "γ"][ri],
      `one column per root, standing where ${["α", "β", "γ"][ri]} falls in the complex plane`,
      "root",
    );
  }
  return g;
};

// ---------------------------------------------------------------- 4. Knot

const knot: Builder = (ctx) => {
  const g = new THREE.Group();
  ctx.roots.forEach((root, i) => {
    const p = 2 + ((i + ctx.phase) % 3);
    const q = 3 + ((i + 1) % 3);
    const geo = new THREE.TorusKnotGeometry(
      1.1 + root.length() * 0.35,
      0.16 + ctx.curvature * 0.24,
      140,
      12,
      p,
      q,
    );
    const mesh = new THREE.Mesh(geo, surface(ctx.palette, 2 + (i % 3)));
    mesh.position.copy(root).multiplyScalar(0.75);
    mesh.rotation.set(i * 1.1, i * 0.7 + ctx.phase, i * 0.4);
    if (i === 0) {
      ctx.annotate(
        mesh.position.clone().add(new THREE.Vector3(0, 1.1 + root.length() * 0.35, 0)),
        "ω",
        `winding numbers (${p},${q}) come from the cube-root branch and the root index`,
        "phase",
      );
    }
    g.add(mesh);
  });
  applyDiscriminant(g, ctx);
  g.add(rootMarkers(ctx, 0.18));
  return g;
};

// ---------------------------------------------------------------- 5. Void

const voidForm: Builder = (ctx) => {
  const g = new THREE.Group();
  // An open cage of latitude rings — mass implied by its absence. Solid torus
  // rings rather than LineLoops: a 1px GL line all but disappears once the
  // render is downsampled into the glyph grid.
  const shells = 3;
  for (let s = 0; s < shells; s++) {
    const radius = 3.4 - s * 0.75;
    const rings = 11 + s * 3;
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      const lat = (t - 0.5) * Math.PI;
      const rr = Math.cos(lat) * radius;
      if (rr < 0.12) continue;
      const y = Math.sin(lat) * radius;
      // punch holes where the roots are: nearby rings are simply omitted
      if (rootField(new THREE.Vector3(0, y, 0), ctx.roots) > 0.6 + s * 0.25) continue;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(rr, 0.055 + s * 0.012, 6, 84),
        surface(ctx.palette, 2 + (s % 3)),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    }
  }
  ctx.annotate(
    ctx.roots[0].clone(),
    "α",
    "rings are omitted where a root sits — the roots are the holes, not the mass",
    "root",
  );
  g.add(rootMarkers(ctx, 0.34));
  return g;
};

// -------------------------------------------------------- 6. Tessellation

const tessellation: Builder = (ctx) => {
  const g = new THREE.Group();
  const cols = 13;
  const rows = 15;
  const size = 0.3;
  const mat = surface(ctx.palette, 3);
  const geo = new THREE.CylinderGeometry(size * 0.92, size * 0.92, 1, 6);
  const mesh = new THREE.InstancedMesh(geo, mat, cols * rows);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) * size * 1.74 + (r % 2 ? size * 0.87 : 0);
      const z = (r - rows / 2) * size * 1.5;
      const p = new THREE.Vector3(x, 0, z);
      const h = 0.1 + rootField(p, ctx.roots) * (1.6 + ctx.discEnergy * 2.5);
      m.makeTranslation(x, h / 2, z);
      m.scale(new THREE.Vector3(1, h, 1));
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  g.add(mesh);
  ctx.annotate(
    ctx.roots[0].clone().setY(1.4),
    "α",
    "tiles extrude by the root field, so each peak marks a solution",
    "root",
  );
  g.rotation.x = -0.18;
  g.position.y = -1;
  return g;
};

// ------------------------------------------------------------ 7. Exploded

const exploded: Builder = (ctx) => {
  const g = new THREE.Group();

  // This is the most common archetype in the supply, so its internal variation
  // matters more than any other.
  //
  // Note the archetype invariant: `archetypeOf` picks the family *from* the
  // discriminant class, so every Exploded token is Fractured. Branching on the
  // class here would be dead code — the variation has to come from the
  // quantities that actually differ inside the family, which are the p:q
  // balance, the discriminant magnitude, the phase and the root geometry.
  const sources = [
    () => new THREE.IcosahedronGeometry(2.1, 3),
    () => new THREE.BoxGeometry(3.0, 3.0, 3.0, 8, 8, 8),
    () => new THREE.TorusGeometry(1.9, 0.72, 12, 44),
    () => new THREE.ConeGeometry(2.0, 3.6, 28, 10),
  ];
  // Selected on arg(A), not on the p:q balance and not on |c|. |c| already
  // decides the archetype, so it is fixed within a quartile here and would pick
  // the same solid every time; p:q is measurably skewed (43% of the supply in
  // one quartile). arg(A) splits 26/22/32/20 across the supply and is
  // independent of both.
  const turn = (ctx.phaseAngleSpin / (Math.PI * 2)) % 1;
  const src = sources[Math.min(3, Math.floor(turn * 4))]();

  const shards = [
    (s: number) => new THREE.TetrahedronGeometry(s),
    (s: number) => new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5),
    (s: number) => new THREE.OctahedronGeometry(s),
  ];
  const shardSize = 0.12 + ctx.curvature * 0.15;
  const shardGeo = shards[ctx.phase % shards.length](shardSize);

  // Anisotropic pre-stretch from the root spread. Combined with the four source
  // solids this is what carries the variation: the silhouette differs before a
  // single shard moves. Displacement is then kept small on purpose — a large
  // push along the normals re-inflates every solid back into the same sphere,
  // and a directional cleave large enough to be visible flattened every piece
  // into the same slabs. The source shape has to survive the explosion.
  //
  // The stretch keys off the conjugate spread — the imaginary extent of the
  // complex pair. For a Fractured token the normalised roots always sit near
  // 1, -1/2 ± yi, so that y is the one part of the root geometry that genuinely
  // varies (0 to 1 across the supply); the real parts are effectively constant
  // and produced no variation at all.
  const conj = Math.max(...ctx.roots.map((r) => Math.abs(r.y))) / 3.2;
  const stretch = new THREE.Vector3(
    1 + (1 - conj) * 0.55,
    1 + conj * 0.9,
    1 - Math.min(0.45, ctx.discEnergy * 0.45),
  );

  const pos = src.getAttribute("position");
  const count = Math.floor(pos.count / 3);
  const mesh = new THREE.InstancedMesh(shardGeo, surface(ctx.palette, 3), count);

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const farthest = new THREE.Vector3();
  let farthestD = -1;
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();

  for (let t = 0; t < count; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    v.copy(a).add(b).add(c).divideScalar(3);
    // face normal, so displacement follows the source solid's own surface and
    // does not collapse every shape into the same sphere
    normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
    if (!Number.isFinite(normal.x)) normal.copy(v).normalize();

    // each shard belongs to its nearest root
    let nearest = 0;
    let bestD = Infinity;
    for (let r = 0; r < 3; r++) {
      const d = v.distanceToSquared(ctx.roots[r]);
      if (d < bestD) {
        bestD = d;
        nearest = r;
      }
    }
    const root = ctx.roots[nearest];

    v.multiply(stretch);
    // separation along the surface normal, enough to read as fragmentation
    v.addScaledVector(normal, 0.2 + ctx.discEnergy * 0.85);
    // Only a whisper of drift toward the claiming root. The three roots sit at
    // 120 degrees, so any real pull collapsed every piece into three columns.
    v.lerp(root, 0.04);

    const spin = t * 0.37 + ctx.phaseAngleSpin + nearest * 2.094;
    q.setFromAxisAngle(normal, spin);
    // shards thrown further break up smaller, which reads as real fragmentation
    scl.setScalar(0.5 + 1.2 / (1 + v.length() * 0.22));
    if (v.lengthSq() > farthestD) {
      farthestD = v.lengthSq();
      farthest.copy(v);
    }
    m.compose(v, q, scl);
    mesh.setMatrixAt(t, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  g.add(mesh);
  ctx.annotate(
    // an actual shard, captured during the scatter loop
    farthest.clone(),
    "Δ",
    `shards separate along their own normals by |Δ| — energy ${ctx.discEnergy.toFixed(2)}`,
    "discriminant",
  );
  g.add(rootMarkers(ctx, 0.3));
  src.dispose();
  return g;
};

// ------------------------------------------------------------- 8. Lattice

const lattice: Builder = (ctx) => {
  const g = new THREE.Group();
  const n = 8;
  const span = 5.4;
  const at = (x: number, y: number, z: number) => {
    const p = new THREE.Vector3(
      (x / (n - 1) - 0.5) * span,
      (y / (n - 1) - 0.5) * span,
      (z / (n - 1) - 0.5) * span,
    );
    // nodes drift toward the roots, warping the cube
    for (const r of ctx.roots) {
      const d = p.distanceTo(r);
      p.addScaledVector(r.clone().sub(p).normalize(), 0.55 / (1 + d * d));
    }
    return p;
  };
  const pts: number[] = [];
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++) {
        const a = at(x, y, z);
        if (x + 1 < n) pts.push(a.x, a.y, a.z, ...at(x + 1, y, z).toArray());
        if (y + 1 < n) pts.push(a.x, a.y, a.z, ...at(x, y + 1, z).toArray());
        if (z + 1 < n) pts.push(a.x, a.y, a.z, ...at(x, y, z + 1).toArray());
      }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, wire(ctx.palette, 3, 0.85)));
  ctx.annotate(
    ctx.roots[1].clone(),
    "β",
    "every lattice node drifts toward the nearest root, warping the cell structure",
    "root",
  );
  g.add(rootMarkers(ctx, 0.24));
  return g;
};

// -------------------------------------------------------------- 9. Spiral

const spiral: Builder = (ctx) => {
  const g = new THREE.Group();
  ctx.roots.forEach((root, i) => {
    const turns = 4 + i + Math.floor(ctx.pqRatio * 4);
    const pts: THREE.Vector3[] = [];
    const steps = 420;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const a = t * Math.PI * 2 * turns + (i * Math.PI * 2) / 3 + ctx.phase;
      const rad = 0.35 + t * (2.4 + root.length() * 0.6);
      pts.push(
        new THREE.Vector3(
          Math.cos(a) * rad,
          (t - 0.5) * (4.2 + ctx.curvature * 3),
          Math.sin(a) * rad,
        ),
      );
    }
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, 0.075 + i * 0.02, 8, false),
      surface(ctx.palette, 2 + (i % 3)),
    );
    tube.position.copy(root).multiplyScalar(0.35);
    if (i === 0) {
      ctx.annotate(
        // a point taken from the helix itself, three quarters of the way up
        pts[Math.floor(pts.length * 0.75)].clone().add(root.clone().multiplyScalar(0.35)),
        "p:q",
        `${turns} turns from the p:q balance; pitch from |c|`,
        "coefficient",
      );
    }
    g.add(tube);
  });
  applyDiscriminant(g, ctx);
  return g;
};

// --------------------------------------------------------------- 10. Shell

const shell: Builder = (ctx) => {
  const g = new THREE.Group();
  const layers = 5;
  for (let l = 0; l < layers; l++) {
    const radius = 0.9 + l * 0.62;
    // outer shells get more subdivision so their wireframes stay dense enough
    // to survive the glyph grid instead of thinning out to nothing
    const geo = new THREE.IcosahedronGeometry(radius, l === 0 ? 3 : 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(ctx.palette.ink[Math.min(4, 1 + l)]),
        emissive: new THREE.Color(ctx.palette.ink[Math.max(0, l - 1)]),
        emissiveIntensity: 0.3,
        wireframe: l > 0,
        transparent: l > 0,
        opacity: l === 0 ? 1 : 0.85 - l * 0.12,
        flatShading: true,
      }),
    );
    mesh.rotation.set(l * 0.4, l * 0.7 + ctx.phase * 0.5, l * 0.2);
    // each shell drifts toward its corresponding root
    const r = ctx.roots[l % 3];
    mesh.position.copy(r).multiplyScalar(0.18 * (1 + ctx.discEnergy));
    if (l === layers - 1) {
      ctx.annotate(
        mesh.position.clone().add(new THREE.Vector3(radius * 0.82, radius * 0.4, radius * 0.3)),
        "Δ",
        "shells decentre toward their root, further apart the larger |Δ| grows",
        "discriminant",
      );
    }
    g.add(mesh);
  }
  g.add(rootMarkers(ctx, 0.2));
  return g;
};

// ------------------------------------------------------------- 11. Cascade

const cascade: Builder = (ctx) => {
  const g = new THREE.Group();
  for (let s = 0; s < 3; s++) {
    const count = 5200;
    const arr = new Float32Array(count * 3);
    // roots live in the XY plane; a stream falls from above each one, spread
    // across Z so the three do not collapse into a single sheet
    const root = ctx.roots[s];
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const p = new THREE.Vector3(
        root.x + (ctx.rng.next() - 0.5) * 1.5,
        4.2 - t * 8.6,
        root.y * 0.8 + (ctx.rng.next() - 0.5) * 1.5,
      );
      // deflected by every root as it falls, so the streams braid rather than
      // collapsing into one column
      for (const r of ctx.roots) {
        const d = p.distanceTo(r);
        p.addScaledVector(p.clone().sub(r).normalize(), (0.55 * ctx.discEnergy) / (1 + d * d));
      }
      p.x += Math.sin(t * 11 + s * 2.1) * ctx.curvature * 1.8;
      p.z += Math.cos(t * 9 + s * 1.7) * ctx.curvature * 1.4;
      arr.set([p.x, p.y, p.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    if (s === 0) {
      ctx.annotate(
        new THREE.Vector3(root.x, 4.2, root.y * 0.8),
        "source",
        "each stream falls from a root, then every root deflects it on the way down",
        "root",
      );
    }
    g.add(new THREE.Points(geo, dots(ctx.palette, 2 + (s % 3), 0.16)));
  }
  g.add(rootMarkers(ctx, 0.26));
  return g;
};

// ------------------------------------------------------------- 12. Orbital

const orbital: Builder = (ctx) => {
  const g = new THREE.Group();
  ctx.roots.forEach((root, i) => {
    const a = 1.5 + root.length() * 0.9;
    const b = a * (0.45 + ctx.pqRatio * 0.5);
    // Solid tube along the ellipse rather than a LineLoop: GL lines are a
    // single pixel wide and are lost in the downsample to the glyph grid.
    const curve = new THREE.EllipseCurve(0, 0, a, b, 0, Math.PI * 2, false, 0);
    const pts = curve.getPoints(200).map((v) => new THREE.Vector3(v.x, v.y, 0));
    const orbit = new THREE.Group();
    orbit.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 220, 0.055, 6, true),
        surface(ctx.palette, 2 + (i % 3)),
      ),
    );
    const body = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.26 + i * 0.07, 2),
      surface(ctx.palette, 3),
    );
    body.position.set(a, 0, 0);
    if (i === 0) {
      ctx.annotate(
        new THREE.Vector3(a, 0, 0),
        "|α|",
        `semi-major axis = root modulus (${a.toFixed(2)}); eccentricity from p:q`,
        "root",
      );
    }
    orbit.add(body);
    orbit.rotation.set(
      (i * Math.PI) / 3 + ctx.curvature,
      (i * Math.PI * 2) / 3 + (ctx.phase * Math.PI * 2) / 3,
      i * 0.4,
    );
    g.add(orbit);
  });
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.45 + ctx.discEnergy * 0.4, 2),
    surface(ctx.palette, 3, { emissive: 0.6 }),
  );
  g.add(core);
  return g;
};


// --------------------------------------------------------------- 13. Weave

const weave: Builder = (ctx) => {
  const g = new THREE.Group();
  // Interlaced bands on two axes, lifted alternately so they read as woven
  // rather than as a flat grid. Band count follows the root spread.
  const n = 7 + Math.floor(ctx.pqRatio * 5);
  const span = 6.4;
  let nearestBand: THREE.Mesh | null = null;
  let nearestD = Infinity;
  const thick = 0.16 + ctx.curvature * 0.1;
  const gap = span / n;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const over = i % 2 === 0;
    const lift = (over ? 1 : -1) * (0.22 + ctx.discEnergy * 0.4);

    const warp = new THREE.Mesh(
      new THREE.BoxGeometry(span, thick, gap * 0.62),
      surface(ctx.palette, 2 + (i % 3)),
    );
    warp.position.set(0, lift, t * span);
    const dz = Math.abs(t * span - ctx.roots[0].y);
    if (dz < nearestD) {
      nearestD = dz;
      nearestBand = warp;
    }
    warp.rotation.z = Math.sin(i * 0.9 + ctx.phaseAngleSpin) * ctx.curvature * 0.25;
    g.add(warp);

    const weft = new THREE.Mesh(
      new THREE.BoxGeometry(gap * 0.62, thick, span),
      surface(ctx.palette, 1 + (i % 4)),
    );
    weft.position.set(t * span, -lift, 0);
    weft.rotation.x = Math.cos(i * 0.7 + ctx.phaseAngleSpin) * ctx.curvature * 0.25;
    g.add(weft);
  }

  // the roots pull the whole cloth out of plane
  const lift = (p: THREE.Vector3) => rootField(p, ctx.roots) * 0.8;
  g.children.forEach((c) => {
    c.position.y += lift(c.position);
  });
  // Read the band's own position rather than recomputing the field at the
  // callout point: each band was lifted by the field sampled at its centre, so
  // any other sample puts the dot above or below the band it is labelling.
  if (nearestBand) {
    ctx.annotate(
      nearestBand.position.clone().setX(ctx.roots[0].x).add(new THREE.Vector3(0, 0.22, 0)),
      "lift",
      "the cloth is pushed out of plane by the root field beneath it",
      "root",
    );
  }
  g.add(rootMarkers(ctx, 0.24));
  return g;
};

// --------------------------------------------------------------- 14. Bloom

const bloom: Builder = (ctx) => {
  const g = new THREE.Group();
  // Petals on three whorls, one per root, each opening by how far its root sits
  // from the origin. Threefold by construction, which is the point.
  ctx.roots.forEach((root, ri) => {
    const petals = 7 + Math.floor(root.length() * 2.5);
    const whorl = new THREE.Group();
    const open = 0.35 + Math.min(1.1, root.length() * 0.4);

    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + ri * 0.4 + ctx.phaseAngleSpin;
      const len = 1.5 + (ri * 0.5) + Math.sin(i * 1.7) * 0.35;
      const petal = new THREE.Mesh(
        new THREE.ConeGeometry(0.2 + ctx.curvature * 0.16, len, 5, 3, true),
        surface(ctx.palette, 2 + ((i + ri) % 3)),
      );
      // lay each petal outward and tilt it open
      petal.position.set(Math.cos(a) * len * 0.42, 0, Math.sin(a) * len * 0.42);
      petal.rotation.set(Math.PI / 2 - open, 0, -a);
      whorl.add(petal);
    }
    whorl.position.copy(root).multiplyScalar(0.3);
    whorl.rotation.y = (ri * Math.PI * 2) / 3;
    whorl.scale.setScalar(1 - ri * 0.18);
    {
      // out on the petal ring, not in the empty space above the whorl centre
      const theta = (ri * Math.PI * 2) / 3 + ctx.phaseAngleSpin;
      const reach = (1.5 + ri * 0.5) * 0.42 * (1 - ri * 0.18);
      ctx.annotate(
        whorl.position
          .clone()
          .add(new THREE.Vector3(Math.cos(theta) * reach, 0.1, Math.sin(theta) * reach)),
        ["α", "β", "γ"][ri],
        `whorl ${ri + 1} of 3: ${petals} petals, opening by |${["α", "β", "γ"][ri]}| = ${root.length().toFixed(2)}`,
        "root",
      );
    }
    g.add(whorl);
  });

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.42 + ctx.discEnergy * 0.3, 2),
    surface(ctx.palette, 4),
  );
  g.add(core);
  return g;
};

// ---------------------------------------------------------------- 15. Rift

const rift: Builder = (ctx) => {
  const g = new THREE.Group();
  // A stack of plates split by a fault line. The two sides slide past each other
  // by the discriminant, so a violent token tears wide open.
  const plates = 13;
  const slip = 0.25 + ctx.discEnergy * 2.4;
  const axis = ctx.roots[0].clone().sub(ctx.roots[2]).setZ(0);
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
  axis.normalize();

  for (let i = 0; i < plates; i++) {
    const t = i / (plates - 1) - 0.5;
    const w = 5.2 - Math.abs(t) * 2.2;
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(w / 2, 0.34 + ctx.curvature * 0.2, 3.0 - Math.abs(t) * 1.1),
        surface(ctx.palette, 1 + ((i + (side > 0 ? 1 : 0)) % 4)),
      );
      // open the fault, then shear the halves along it in opposite directions
      plate.position.set((side * w) / 4, t * 4.4, 0);
      plate.position.addScaledVector(axis, side * slip * 0.5);
      plate.position.y += side * Math.sin(i * 0.8) * ctx.discEnergy * 0.5;
      plate.rotation.y = side * ctx.curvature * 0.3;
      plate.rotation.z = side * 0.04 * i;
      g.add(plate);
    }
  }
  ctx.annotate(
    // on the lip of the upper plate, off the spin axis so it travels with it
    axis.clone().multiplyScalar(slip * 0.5).setY(1.6).setZ(1.2),
    "Δ",
    `the fault runs along the axis between two roots; the halves slip by |Δ| (${slip.toFixed(2)})`,
    "discriminant",
  );
  ctx.annotate(
    axis.clone().multiplyScalar(2.6),
    "α−γ",
    "fault direction is the vector between the outer two roots",
    "root",
  );
  g.add(rootMarkers(ctx, 0.26));
  return g;
};

// -------------------------------------------------------------- 16. Strata

const strata: Builder = (ctx) => {
  const g = new THREE.Group();
  // Horizontal beds of differing thickness, offset and eroded. Reads as
  // sedimentary section: quiet, wide, and unlike anything else in the set.
  const beds = 16;
  let y = -3.2;
  for (let i = 0; i < beds; i++) {
    const thick = 0.16 + (0.42 * (1 + Math.sin(i * 2.1 + ctx.phaseAngleSpin))) / 2;
    const w = 5.6 - Math.abs(i - beds / 2) * 0.16;
    const bed = new THREE.Group();

    // each bed is broken into blocks so erosion reads at the glyph scale
    const blocks = 5 + (i % 3);
    for (let b = 0; b < blocks; b++) {
      const bw = w / blocks;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(bw * 0.96, thick, 2.6 - (i % 4) * 0.22),
        surface(ctx.palette, 1 + (i % 4)),
      );
      const px = (b - (blocks - 1) / 2) * bw;
      block.position.set(px, 0, 0);
      // the roots erode the beds: blocks near a root drop away
      const field = rootField(new THREE.Vector3(px, y, 0), ctx.roots);
      block.position.y -= field * ctx.discEnergy * 1.4;
      block.scale.y = Math.max(0.2, 1 - field * 0.5);
      bed.add(block);
    }
    bed.position.y = y;
    bed.position.x = Math.sin(i * 0.7) * ctx.curvature * 1.1;
    bed.rotation.y = Math.sin(i * 0.35) * 0.08;
    if (i === Math.floor(beds / 2)) {
      ctx.annotate(
        new THREE.Vector3(ctx.roots[0].x, y, 0),
        "erosion",
        "beds are eroded away where a root passes through them",
        "root",
      );
    }
    g.add(bed);
    y += thick + 0.1;
  }
  g.add(rootMarkers(ctx, 0.22));
  return g;
};

// ----------------------------------------------------------- 17. Labyrinth

const labyrinth: Builder = (ctx) => {
  const g = new THREE.Group();
  // A maze carved into a plane: corridors on a lattice, routed by a depth-first
  // walk whose turn order is set by the p:q balance and the phase. The three
  // roots are walls — cells inside their field are never carved — so the maze
  // has to route around them and the roots read as the obstacles it solves.
  const n = 13 + Math.floor(ctx.pqRatio * 5);
  const span = 7.2;
  const at = (x: number, z: number) =>
    new THREE.Vector3((x / (n - 1) - 0.5) * span, 0, (z / (n - 1) - 0.5) * span);
  const cell = (x: number, z: number) => x * n + z;

  const wall = new Array<boolean>(n * n).fill(false);
  for (let x = 0; x < n; x++)
    for (let z = 0; z < n; z++) if (rootField(at(x, z), ctx.roots) > 0.85) wall[cell(x, z)] = true;

  // Start from the first free cell so a root sitting on the corner cannot
  // strand the walk before it begins.
  let start = 0;
  while (start < n * n && wall[start]) start++;
  if (start >= n * n) return g;

  const seen = new Array<boolean>(n * n).fill(false);
  const edges: [number, number, number, number][] = [];
  const stack: [number, number][] = [[Math.floor(start / n), start % n]];
  seen[start] = true;
  const DIRS: [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  // A fixed turn order would carve the same comb every time; rotating it per
  // cell by the drivers is what makes one token's maze differ from another's.
  const bias = 1 + Math.floor(ctx.pqRatio * 3);
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const turn = (x * bias + z * 2 + ctx.phase) % 4;
    let moved = false;
    for (let k = 0; k < 4; k++) {
      const [dx, dz] = DIRS[(k + turn) % 4];
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      if (wall[cell(nx, nz)] || seen[cell(nx, nz)]) continue;
      seen[cell(nx, nz)] = true;
      edges.push([x, z, nx, nz]);
      stack.push([nx, nz]);
      moved = true;
      break;
    }
    if (!moved) stack.pop();
  }

  // Corridors are solid bars, not lines: a 1px GL line vanishes in the glyph
  // downsample, and at this lattice pitch the maze would read as an empty plate.
  const pitch = span / (n - 1);
  const bore = pitch * 0.42;
  const lift = (p: THREE.Vector3) => rootField(p, ctx.roots) * 0.55;
  for (const [x, z, nx, nz] of edges) {
    const a = at(x, z);
    const b = at(nx, nz);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const along = nx !== x;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(along ? pitch + bore : bore, bore, along ? bore : pitch + bore),
      surface(ctx.palette, 1 + ((x + z) % 4)),
    );
    bar.position.copy(mid).setY(lift(mid) + Math.sin(mid.x * 0.7 + ctx.phaseAngleSpin) * ctx.curvature * 0.3);
    g.add(bar);
  }

  ctx.annotate(
    ctx.roots[0].clone().setY(0.5),
    "wall",
    "cells inside a root's field are never carved — the maze routes around all three",
    "root",
  );
  g.add(rootMarkers(ctx, 0.3));
  return g;
};

// ----------------------------------------------------------------- 18. Fold

const fold: Builder = (ctx) => {
  const g = new THREE.Group();
  // One continuous sheet of alternating mountain and valley creases. Not Weave
  // (separate interlaced bands) and not Strata (solid beds): a single surface,
  // and the only thing in the set that reads as folded rather than assembled.
  const creases = 9 + Math.floor(ctx.pqRatio * 10);
  const nx = creases * 2 + 1;
  const nz = 26;
  const spanX = 7;
  const spanZ = 6;
  const amp = 0.55 + ctx.curvature * 1.5;

  const pos: number[] = [];
  const index: number[] = [];
  let flattest = new THREE.Vector3();
  let flattestOpen = 2;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = (i / (nx - 1) - 0.5) * spanX;
      const z = (j / (nz - 1) - 0.5) * spanZ;
      // the roots pull the pleating open: the closer the field, the shallower
      // the fold, so the sheet relaxes flat where a root sits under it
      const open = 1 - Math.min(0.85, rootField(new THREE.Vector3(x, 0, z), ctx.roots) * 0.4);
      const y =
        (i % 2 === 0 ? 1 : -1) * amp * open + Math.sin(z * 0.5 + ctx.phaseAngleSpin) * 0.18;
      if (open < flattestOpen) {
        flattestOpen = open;
        flattest = new THREE.Vector3(x, y, z);
      }
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < nx - 1; i++)
    for (let j = 0; j < nz - 1; j++) {
      const a = i * nz + j;
      index.push(a, a + nz, a + 1, a + 1, a + nz, a + nz + 1);
    }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // An open sheet has no inside; without DoubleSide half the pleats render as
  // holes from any angle that sees their backs.
  const mat = surface(ctx.palette, 3);
  mat.side = THREE.DoubleSide;
  g.add(new THREE.Mesh(geo, mat));

  ctx.annotate(
    flattest.clone(),
    "relax",
    "the pleating flattens where the root field is strongest",
    "root",
  );
  g.add(rootMarkers(ctx, 0.24));
  return g;
};

// ---------------------------------------------------------------- 19. Prism

const prism: Builder = (ctx) => {
  const g = new THREE.Group();
  // Hex columns grown from each root and packed base to base, terminating at
  // different lengths — basalt, not debris. Exploded scatters shards off a
  // broken solid; these stay packed and point somewhere.
  // Slim and long: at a 10:1 aspect the columns stay individually readable in
  // the glyph grid. Fatter ones packed this tightly merge into a single slab and
  // the form loses its whole point.
  const rad = 0.14 + ctx.curvature * 0.06;
  const pitch = rad * 2.3;
  const up = new THREE.Vector3(0, 1, 0);

  ctx.roots.forEach((root, ri) => {
    const cluster = new THREE.Group();
    const reach = 1.7 + root.length() * 1.05;
    const R = 3;
    for (let q = -R; q <= R; q++) {
      for (let r = -R; r <= R; r++) {
        if (Math.abs(q + r) > R) continue;
        const hexDist = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
        // the columns terminate at very different heights, which is what reads
        // as a grown crystal face rather than a cut block
        const len =
          reach *
          (1 - hexDist * 0.1) *
          (0.5 + 0.5 * Math.abs(Math.sin(q * 2.1 + r * 1.7 + ri * 1.3 + ctx.phaseAngleSpin)));
        if (len < 0.25) continue;
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(rad, rad, len, 6),
          surface(ctx.palette, 1 + ((q + r + ri + 8) % 4)),
        );
        col.position.set(pitch * (q + r / 2) * 1.732, len / 2, pitch * 1.5 * r);
        cluster.add(col);
      }
    }
    // The bundle grows away from the origin along its own root, splayed further
    // the more violent the discriminant.
    const axis = root.clone();
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    axis.normalize().lerp(up, 0.35 - ctx.discEnergy * 0.3).normalize();
    cluster.quaternion.setFromUnitVectors(up, axis);
    cluster.position.copy(root).multiplyScalar(0.55);
    if (ri === 0) {
      ctx.annotate(
        cluster.position.clone().addScaledVector(axis, reach),
        "|α|",
        `column length grows with the root modulus |α| = ${root.length().toFixed(2)}`,
        "root",
      );
    }
    g.add(cluster);
  });

  g.add(rootMarkers(ctx, 0.22));
  return g;
};

// ---------------------------------------------------------------- 20. Arbor

const arbor: Builder = (ctx) => {
  const g = new THREE.Group();
  // The only recursive form in the set. A trunk splits into three limbs, one
  // aimed at each root, and every limb keeps subdividing on the same rule.
  const maxDepth = 4 + (ctx.discEnergy > 0.55 ? 1 : 0);
  const ratio = 0.58 + ctx.pqRatio * 0.2;
  const spread = 0.32 + ctx.curvature * 0.8;
  const up = new THREE.Vector3(0, 1, 0);

  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(rad * ratio, rad, len, 6),
      surface(ctx.palette, 1 + (depth % 4)),
    );
    seg.position.copy(from).addScaledVector(dir, len / 2);
    seg.quaternion.setFromUnitVectors(up, dir);
    g.add(seg);

    const tip = from.clone().addScaledVector(dir, len);
    if (depth >= maxDepth) return;

    const children = depth < 2 ? 3 : 2;
    for (let i = 0; i < children; i++) {
      const a = (i / children) * Math.PI * 2 + depth * 1.1 + ctx.phaseAngleSpin;
      const perp = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      perp.addScaledVector(dir, -perp.dot(dir));
      // a limb pointing straight up leaves no perpendicular to rotate about
      if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0).addScaledVector(dir, -dir.x);
      perp.normalize();
      const next = dir
        .clone()
        .multiplyScalar(Math.cos(spread))
        .addScaledVector(perp, Math.sin(spread))
        .normalize();
      grow(tip, next, len * ratio, rad * ratio, depth + 1);
    }
  };

  const base = new THREE.Vector3(0, -3.4, 0);
  const trunk = 1.9;
  const tip = base.clone().addScaledVector(up, trunk);
  g.add(
    (() => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.26, trunk, 6),
        surface(ctx.palette, 2),
      );
      m.position.copy(base).addScaledVector(up, trunk / 2);
      return m;
    })(),
  );
  // The three primary limbs are not on the generic rule: each one is aimed at
  // its own root, which is what ties the branching to the equation rather than
  // to a pleasing angle.
  ctx.roots.forEach((root, ri) => {
    const dir = root.clone().sub(tip);
    if (dir.lengthSq() < 1e-6) dir.copy(up);
    dir.normalize();
    // keep it growing upward as well as outward, or a low root drags a limb
    // straight into the floor
    dir.addScaledVector(up, 0.55).normalize();
    grow(tip, dir, 1.55, 0.16, 1);
    if (ri === 0) {
      ctx.annotate(
        tip.clone().addScaledVector(dir, 1.55),
        "α",
        "one primary limb per root: each is aimed at where its root falls",
        "root",
      );
    }
  });
  ctx.annotate(
    tip.clone(),
    "p:q",
    `each generation is ${ratio.toFixed(2)}x its parent, the ratio taken from p:q`,
    "coefficient",
  );
  g.add(rootMarkers(ctx, 0.2));
  return g;
};

// --------------------------------------------------------------- 21. Vessel

/*
 * Vessel and Aperture are the two Merged forms, and both are written against a
 * constraint the other twenty do not have: the discriminant is exactly zero
 * across this whole family, so `discEnergy` is a constant here and cannot drive
 * anything. |c|, p:q and arg(A) do the work instead.
 *
 * Neither calls `applyDiscriminant` either — its Merged branch collapses every
 * child toward the origin, which would crush a lathe profile into its own axis
 * and stack the iris blades on top of each other.
 */

const vessel: Builder = (ctx) => {
  const g = new THREE.Group();
  // A solid of revolution — the only lathe form in the set. The profile is the
  // three root moduli read as radii up the axis, so a triple root turns the
  // whole vessel symmetric and a double root leaves one shoulder proud.
  const moduli = ctx.roots.map((r) => r.length());
  const height = 5.4;
  const steps = 96;
  const rings = 3 + Math.floor(ctx.pqRatio * 5);

  // Named stations up the axis rather than three blended lobes. Lobes made a
  // lumpy solid whose widest point was usually the rim, which reads as a
  // mushroom; a foot / belly / waist / neck / mouth sequence is what makes the
  // silhouette legible as something turned. The roots set the radii, so the
  // shape is still entirely theirs — a triple root, where all three moduli
  // collapse to zero, gives the plainest vessel in the collection.
  const stations: [number, number][] = [
    [0, 0.12 + moduli[0] * 0.04],
    [0.07, 0.42 + moduli[0] * 0.13],
    [0.36, 0.95 + moduli[0] * 0.44],
    [0.62, 0.72 + moduli[1] * 0.3],
    [0.83, 0.34 + moduli[1] * 0.16],
    [1, 0.5 + moduli[2] * 0.26],
  ];

  const profile: THREE.Vector2[] = [];
  let widest = 0;
  let widestY = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let k = 0;
    while (k < stations.length - 2 && t > stations[k + 1][0]) k++;
    const [t0, r0] = stations[k];
    const [t1, r1] = stations[k + 1];
    const u = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    // smoothstep between stations: linear segments leave visible kinks that the
    // glyph pass turns into hard bands across the body
    let r = r0 + (r1 - r0) * (u * u * (3 - 2 * u));
    // Throwing rings. Without a hard minimum these vanish on a low-|c| token and
    // the body loses the horizontal banding that makes it read as turned rather
    // than as an undifferentiated blob.
    r += Math.sin(t * Math.PI * rings) * (0.08 + ctx.curvature * 0.24);
    r = Math.max(0.05, r);
    if (r > widest) {
      widest = r;
      widestY = (t - 0.5) * height;
    }
    profile.push(new THREE.Vector2(r, (t - 0.5) * height));
  }

  const mat = surface(ctx.palette, 3);
  // The profile never quite reaches the axis, so the lathe is open at both
  // ends and the inside is visible down the mouth.
  mat.side = THREE.DoubleSide;
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 44), mat);
  body.rotation.y = ctx.phaseAngleSpin;
  g.add(body);

  ctx.annotate(
    new THREE.Vector3(widest, widestY, 0),
    "|α|",
    `the profile is the three root moduli read as radii up the axis (widest ${widest.toFixed(2)})`,
    "root",
  );
  g.add(rootMarkers(ctx, 0.26));
  return g;
};

// ------------------------------------------------------------- 22. Aperture

const aperture: Builder = (ctx) => {
  const g = new THREE.Group();
  // Three stages of overlapping iris blades, closing onto the point the roots
  // have collapsed to. The opening comes from |c|, not |Δ| — see the note above
  // Vessel: |Δ| is zero everywhere in this family.
  const blades = 7 + Math.floor(ctx.pqRatio * 6);
  const stages = 3;
  const open = 0.2 + ctx.curvature * 0.62;

  for (let s = 0; s < stages; s++) {
    const rim = 3.1 - s * 0.62;
    const hole = rim * open;
    // The stages have to stand well clear of each other. Closer than this and
    // the three rings silhouette into one solid disc from any elevation that
    // also shows the hole.
    const y = (s - 1) * 1.7;
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2 + (s * Math.PI) / blades + ctx.phaseAngleSpin;
      const len = rim - hole;
      const blade = new THREE.Mesh(
        // narrow enough that neighbouring blades overlap without fusing into a
        // continuous plate — the gaps are what say "iris"
        new THREE.BoxGeometry(len, 0.09, rim * 0.3),
        surface(ctx.palette, 1 + ((i + s) % 4)),
      );
      const mid = hole + len / 2;
      blade.position.set(Math.cos(a) * mid, y, Math.sin(a) * mid);
      // the tangential skew is what makes the blades overlap into an iris
      // instead of sitting apart like spokes
      blade.rotation.y = -a + 0.62;
      g.add(blade);
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(rim, 0.075, 6, 72),
      surface(ctx.palette, 2 + (s % 3)),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }

  ctx.annotate(
    new THREE.Vector3(3.1 * open, 1.7, 0),
    "|c|",
    `the iris stands ${(open * 100).toFixed(0)}% open, set by |c| alone — |Δ| is zero in this family`,
    "coefficient",
  );
  g.add(rootMarkers(ctx, 0.22));
  return g;
};

export const BUILDERS: Record<Archetype, Builder> = {
  Grid: grid,
  Radial: radial,
  Tower: tower,
  Knot: knot,
  Void: voidForm,
  Tessellation: tessellation,
  Exploded: exploded,
  Lattice: lattice,
  Spiral: spiral,
  Shell: shell,
  Cascade: cascade,
  Orbital: orbital,
  Weave: weave,
  Bloom: bloom,
  Rift: rift,
  Strata: strata,
  Labyrinth: labyrinth,
  Fold: fold,
  Prism: prism,
  Arbor: arbor,
  Vessel: vessel,
  Aperture: aperture,
};

/** Camera framing per archetype — some forms are tall, some wide, some deep. */
export const FRAMING: Record<Archetype, { distance: number; elevation: number }> = {
  Grid: { distance: 11, elevation: 0.55 },
  Radial: { distance: 11, elevation: 0.5 },
  Tower: { distance: 14, elevation: 0.18 },
  Knot: { distance: 9.5, elevation: 0.3 },
  Void: { distance: 11.5, elevation: 0.22 },
  Tessellation: { distance: 11, elevation: 0.62 },
  Exploded: { distance: 11, elevation: 0.25 },
  Lattice: { distance: 11, elevation: 0.32 },
  Spiral: { distance: 12, elevation: 0.2 },
  Shell: { distance: 10.5, elevation: 0.26 },
  Cascade: { distance: 12.5, elevation: 0.12 },
  Orbital: { distance: 10, elevation: 0.34 },
  Weave: { distance: 11, elevation: 0.5 },
  Bloom: { distance: 10.5, elevation: 0.3 },
  Rift: { distance: 12, elevation: 0.22 },
  Strata: { distance: 12, elevation: 0.16 },
  Labyrinth: { distance: 11, elevation: 0.62 },
  Fold: { distance: 11, elevation: 0.44 },
  Prism: { distance: 11, elevation: 0.28 },
  Arbor: { distance: 12.5, elevation: 0.2 },
  Vessel: { distance: 12, elevation: 0.16 },
  // high enough to look down the axis: an iris seen edge-on is just three discs
  Aperture: { distance: 10.5, elevation: 0.62 },
};
