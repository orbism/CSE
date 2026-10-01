/**
 * Parametric shape generators and curves, ported from three.js r169 (MIT).
 *
 * Vertex order, index order and winding are three's exactly — bounding boxes
 * (and so the camera framing) and back-face culling both depend on them. Normals
 * and UVs are dropped: the engine shades flat from screen-space derivatives.
 */

import { Matrix4, Vector2, Vector3 } from "./math.js";
import { BufferGeometry, Float32BufferAttribute } from "./scene.js";

/** three passes 2π as a default argument, so it multiplies as one constant: a * (π * 2). */
const PI2 = Math.PI * 2;

function finish(g: BufferGeometry, vertices: number[], indices?: number[]) {
  if (indices) g.setIndex(indices);
  g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
}

// ------------------------------------------------------------------- box

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1, ws = 1, hs = 1, ds = 1) {
    super();
    const indices: number[] = [];
    const vertices: number[] = [];
    let n = 0;
    type Axis = "x" | "y" | "z";
    const plane = (u: Axis, v: Axis, w: Axis, udir: number, vdir: number, W: number, H: number, D: number, gx: number, gy: number) => {
      const sw = W / gx,
        sh = H / gy;
      const v3 = new Vector3();
      let count = 0;
      for (let iy = 0; iy <= gy; iy++) {
        const y = iy * sh - H / 2;
        for (let ix = 0; ix <= gx; ix++) {
          v3[u] = (ix * sw - W / 2) * udir;
          v3[v] = y * vdir;
          v3[w] = D / 2;
          vertices.push(v3.x, v3.y, v3.z);
          count++;
        }
      }
      for (let iy = 0; iy < gy; iy++)
        for (let ix = 0; ix < gx; ix++) {
          const a = n + ix + (gx + 1) * iy;
          const b = n + ix + (gx + 1) * (iy + 1);
          const c = n + ix + 1 + (gx + 1) * (iy + 1);
          const d = n + ix + 1 + (gx + 1) * iy;
          indices.push(a, b, d, b, c, d);
        }
      n += count;
    };
    ws = Math.floor(ws);
    hs = Math.floor(hs);
    ds = Math.floor(ds);
    plane("z", "y", "x", -1, -1, depth, height, width, ds, hs);
    plane("z", "y", "x", 1, -1, depth, height, -width, ds, hs);
    plane("x", "z", "y", 1, 1, width, depth, height, ws, ds);
    plane("x", "z", "y", 1, -1, width, depth, -height, ws, ds);
    plane("x", "y", "z", 1, -1, width, height, depth, ws, hs);
    plane("x", "y", "z", -1, -1, width, height, -depth, ws, hs);
    finish(this, vertices, indices);
  }
}

// ------------------------------------------------------------ polyhedra

class PolyhedronGeometry extends BufferGeometry {
  constructor(verts: number[], idx: number[], radius: number, detail: number) {
    super();
    const out: number[] = [];
    const at = (i: number) => new Vector3(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
    const push = (v: Vector3) => out.push(v.x, v.y, v.z);
    for (let f = 0; f < idx.length; f += 3) {
      const a = at(idx[f]),
        b = at(idx[f + 1]),
        c = at(idx[f + 2]);
      const cols = detail + 1;
      const v: Vector3[][] = [];
      for (let i = 0; i <= cols; i++) {
        v[i] = [];
        const aj = a.clone().lerp(c, i / cols);
        const bj = b.clone().lerp(c, i / cols);
        const rows = cols - i;
        for (let j = 0; j <= rows; j++) v[i][j] = j === 0 && i === cols ? aj : aj.clone().lerp(bj, j / rows);
      }
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < 2 * (cols - i) - 1; j++) {
          const k = Math.floor(j / 2);
          if (j % 2 === 0) {
            push(v[i][k + 1]);
            push(v[i + 1][k]);
            push(v[i][k]);
          } else {
            push(v[i][k + 1]);
            push(v[i + 1][k + 1]);
            push(v[i + 1][k]);
          }
        }
    }
    const p = new Vector3();
    for (let i = 0; i < out.length; i += 3) {
      p.set(out[i], out[i + 1], out[i + 2]).normalize().multiplyScalar(radius);
      out[i] = p.x;
      out[i + 1] = p.y;
      out[i + 2] = p.z;
    }
    finish(this, out);
  }
}

const T = (1 + Math.sqrt(5)) / 2;

export class IcosahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    // prettier-ignore
    super([-1, T, 0, 1, T, 0, -1, -T, 0, 1, -T, 0, 0, -1, T, 0, 1, T, 0, -1, -T, 0, 1, -T, T, 0, -1, T, 0, 1, -T, 0, -1, -T, 0, 1],
      // prettier-ignore
      [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
       3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1],
      radius, detail);
  }
}

export class OctahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1],
      [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2], radius, detail);
  }
}

export class TetrahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super([1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1], [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1], radius, detail);
  }
}

// --------------------------------------------------------------- tori

/** Shared quad-strip indexing for torus, knot and tube: (rows) x (ring+1). */
function gridIndices(rows: number, ring: number, aFirst: boolean) {
  const out: number[] = [];
  for (let j = 1; j <= rows; j++)
    for (let i = 1; i <= ring; i++) {
      const s = ring + 1;
      const a = aFirst ? s * (j - 1) + (i - 1) : s * j + i - 1;
      const b = aFirst ? s * j + (i - 1) : s * (j - 1) + i - 1;
      const c = aFirst ? s * j + i : s * (j - 1) + i;
      const d = aFirst ? s * (j - 1) + i : s * j + i;
      out.push(a, b, d, b, c, d);
    }
  return out;
}

export class TorusGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48) {
    super();
    radialSegments = Math.floor(radialSegments);
    tubularSegments = Math.floor(tubularSegments);
    const vertices: number[] = [];
    for (let j = 0; j <= radialSegments; j++)
      for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * PI2;
        const v = (j / radialSegments) * Math.PI * 2;
        vertices.push(
          (radius + tube * Math.cos(v)) * Math.cos(u),
          (radius + tube * Math.cos(v)) * Math.sin(u),
          tube * Math.sin(v),
        );
      }
    finish(this, vertices, gridIndices(radialSegments, tubularSegments, false));
  }
}

export class TorusKnotGeometry extends BufferGeometry {
  constructor(radius = 1, tube = 0.4, tubularSegments = 64, radialSegments = 8, p = 2, q = 3) {
    super();
    tubularSegments = Math.floor(tubularSegments);
    radialSegments = Math.floor(radialSegments);
    const vertices: number[] = [];
    const P1 = new Vector3(),
      P2 = new Vector3(),
      B = new Vector3(),
      Tn = new Vector3(),
      N = new Vector3();
    const onCurve = (u: number, o: Vector3) => {
      const quOverP = (q / p) * u;
      const cs = Math.cos(quOverP);
      o.x = radius * (2 + cs) * 0.5 * Math.cos(u);
      o.y = radius * (2 + cs) * Math.sin(u) * 0.5;
      o.z = radius * Math.sin(quOverP) * 0.5;
    };
    for (let i = 0; i <= tubularSegments; ++i) {
      const u = (i / tubularSegments) * p * Math.PI * 2;
      onCurve(u, P1);
      onCurve(u + 0.01, P2);
      Tn.subVectors(P2, P1);
      N.addVectors(P2, P1);
      B.crossVectors(Tn, N);
      N.crossVectors(B, Tn);
      B.normalize();
      N.normalize();
      for (let j = 0; j <= radialSegments; ++j) {
        const v = (j / radialSegments) * Math.PI * 2;
        const cx = -tube * Math.cos(v);
        const cy = tube * Math.sin(v);
        vertices.push(P1.x + (cx * N.x + cy * B.x), P1.y + (cx * N.y + cy * B.y), P1.z + (cx * N.z + cy * B.z));
      }
    }
    finish(this, vertices, gridIndices(tubularSegments, radialSegments, true));
  }
}

// ------------------------------------------------------- cylinder / cone

export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false) {
    super();
    radialSegments = Math.floor(radialSegments);
    heightSegments = Math.floor(heightSegments);
    const indices: number[] = [];
    const vertices: number[] = [];
    let index = 0;
    const rows: number[][] = [];
    const half = height / 2;
    const theta = (x: number) => (x / radialSegments) * PI2 + 0;

    for (let y = 0; y <= heightSegments; y++) {
      const row: number[] = [];
      const v = y / heightSegments;
      const r = v * (radiusBottom - radiusTop) + radiusTop;
      for (let x = 0; x <= radialSegments; x++) {
        vertices.push(r * Math.sin(theta(x)), -v * height + half, r * Math.cos(theta(x)));
        row.push(index++);
      }
      rows.push(row);
    }
    for (let x = 0; x < radialSegments; x++)
      for (let y = 0; y < heightSegments; y++) {
        const a = rows[y][x],
          b = rows[y + 1][x],
          c = rows[y + 1][x + 1],
          d = rows[y][x + 1];
        if (radiusTop > 0) indices.push(a, b, d);
        if (radiusBottom > 0) indices.push(b, c, d);
      }

    const cap = (top: boolean) => {
      const start = index;
      const r = top ? radiusTop : radiusBottom;
      const sign = top ? 1 : -1;
      for (let x = 1; x <= radialSegments; x++) {
        vertices.push(0, half * sign, 0);
        index++;
      }
      const end = index;
      for (let x = 0; x <= radialSegments; x++) {
        vertices.push(r * Math.sin(theta(x)), half * sign, r * Math.cos(theta(x)));
        index++;
      }
      for (let x = 0; x < radialSegments; x++) {
        const c = start + x,
          i = end + x;
        if (top) indices.push(i, i + 1, c);
        else indices.push(i + 1, i, c);
      }
    };
    if (!openEnded) {
      if (radiusTop > 0) cap(true);
      if (radiusBottom > 0) cap(false);
    }
    finish(this, vertices, indices);
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false) {
    super(0, radius, height, radialSegments, heightSegments, openEnded);
  }
}

// ------------------------------------------------------------------ lathe

export class LatheGeometry extends BufferGeometry {
  constructor(points: Vector2[], segments = 12) {
    super();
    segments = Math.floor(segments);
    const vertices: number[] = [];
    const indices: number[] = [];
    const inv = 1.0 / segments;
    for (let i = 0; i <= segments; i++) {
      const phi = 0 + i * inv * PI2;
      const sin = Math.sin(phi),
        cos = Math.cos(phi);
      for (const p of points) vertices.push(p.x * sin, p.y, p.x * cos);
    }
    for (let i = 0; i < segments; i++)
      for (let j = 0; j < points.length - 1; j++) {
        const a = j + i * points.length;
        const b = a + points.length,
          c = a + points.length + 1,
          d = a + 1;
        indices.push(a, b, d, c, d, b);
      }
    finish(this, vertices, indices);
  }
}

// ----------------------------------------------------------------- curves

/** Arc-length machinery shared by the curves, as three's Curve base class. */
abstract class Curve {
  private lengths: number[] | null = null;
  abstract getPoint(t: number): Vector3;

  getLengths(divisions = 200) {
    if (this.lengths && this.lengths.length === divisions + 1) return this.lengths;
    const cache = [0];
    let last = this.getPoint(0);
    let sum = 0;
    for (let p = 1; p <= divisions; p++) {
      const current = this.getPoint(p / divisions);
      sum += current.distanceTo(last);
      cache.push(sum);
      last = current;
    }
    return (this.lengths = cache);
  }
  getUtoTmapping(u: number) {
    const arc = this.getLengths();
    const il = arc.length;
    const target = u * arc[il - 1];
    let low = 0,
      high = il - 1,
      i = 0;
    while (low <= high) {
      i = Math.floor(low + (high - low) / 2);
      const cmp = arc[i] - target;
      if (cmp < 0) low = i + 1;
      else if (cmp > 0) high = i - 1;
      else {
        high = i;
        break;
      }
    }
    i = high;
    if (arc[i] === target) return i / (il - 1);
    return (i + (target - arc[i]) / (arc[i + 1] - arc[i])) / (il - 1);
  }
  getPointAt(u: number) {
    return this.getPoint(this.getUtoTmapping(u));
  }
  getTangentAt(u: number) {
    const t = this.getUtoTmapping(u);
    const t1 = Math.max(0, t - 0.0001),
      t2 = Math.min(1, t + 0.0001);
    return this.getPoint(t2).sub(this.getPoint(t1)).normalize();
  }
  computeFrenetFrames(segments: number, closed: boolean) {
    const tangents: Vector3[] = [];
    const normals: Vector3[] = [];
    const binormals: Vector3[] = [];
    const vec = new Vector3();
    const mat = new Matrix4();
    for (let i = 0; i <= segments; i++) tangents[i] = this.getTangentAt(i / segments);

    const t0 = tangents[0];
    const normal = new Vector3();
    let min = Number.MAX_VALUE;
    const tx = Math.abs(t0.x),
      ty = Math.abs(t0.y),
      tz = Math.abs(t0.z);
    if (tx <= min) {
      min = tx;
      normal.set(1, 0, 0);
    }
    if (ty <= min) {
      min = ty;
      normal.set(0, 1, 0);
    }
    if (tz <= min) normal.set(0, 0, 1);
    vec.crossVectors(t0, normal).normalize();
    normals[0] = new Vector3().crossVectors(t0, vec);
    binormals[0] = new Vector3().crossVectors(t0, normals[0]);

    const clampDot = (a: Vector3, b: Vector3) => Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
    for (let i = 1; i <= segments; i++) {
      normals[i] = normals[i - 1].clone();
      binormals[i] = binormals[i - 1].clone();
      vec.crossVectors(tangents[i - 1], tangents[i]);
      if (vec.length() > Number.EPSILON) {
        vec.normalize();
        normals[i].applyMatrix4(mat.makeRotationAxis(vec, clampDot(tangents[i - 1], tangents[i])));
      }
      binormals[i].crossVectors(tangents[i], normals[i]);
    }
    if (closed) {
      let theta = clampDot(normals[0], normals[segments]) / segments;
      if (tangents[0].dot(vec.crossVectors(normals[0], normals[segments])) > 0) theta = -theta;
      for (let i = 1; i <= segments; i++) {
        normals[i].applyMatrix4(mat.makeRotationAxis(tangents[i], theta * i));
        binormals[i].crossVectors(tangents[i], normals[i]);
      }
    }
    return { normals, binormals };
  }
}

/** Centripetal Catmull-Rom (three's default curve type). */
export class CatmullRomCurve3 extends Curve {
  constructor(
    public points: Vector3[],
    public closed = false,
  ) {
    super();
  }
  getPoint(t: number) {
    const pts = this.points;
    const l = pts.length;
    const p = (l - (this.closed ? 0 : 1)) * t;
    let ip = Math.floor(p);
    let w = p - ip;
    if (this.closed) ip += ip > 0 ? 0 : (Math.floor(Math.abs(ip) / l) + 1) * l;
    else if (w === 0 && ip === l - 1) {
      ip = l - 2;
      w = 1;
    }
    const p0 = this.closed || ip > 0 ? pts[(ip - 1) % l] : new Vector3().subVectors(pts[0], pts[1]).add(pts[0]);
    const p1 = pts[ip % l];
    const p2 = pts[(ip + 1) % l];
    const p3 = this.closed || ip + 2 < l ? pts[(ip + 2) % l] : new Vector3().subVectors(pts[l - 1], pts[l - 2]).add(pts[l - 1]);

    let dt0 = Math.pow(p0.distanceToSquared(p1), 0.25);
    let dt1 = Math.pow(p1.distanceToSquared(p2), 0.25);
    let dt2 = Math.pow(p2.distanceToSquared(p3), 0.25);
    if (dt1 < 1e-4) dt1 = 1.0;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;
    const axis = (x0: number, x1: number, x2: number, x3: number) => {
      const t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1;
      const t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1;
      const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
      const c3 = 2 * x1 - 2 * x2 + t1 + t2;
      const ww = w * w;
      const www = ww * w;
      return x1 + t1 * w + c2 * ww + c3 * www;
    };
    return new Vector3(axis(p0.x, p1.x, p2.x, p3.x), axis(p0.y, p1.y, p2.y, p3.y), axis(p0.z, p1.z, p2.z, p3.z));
  }
}

/**
 * Full, counter-clockwise, unrotated ellipses only: all Orbital needs. The
 * trailing three.js arguments are accepted so call sites read the same.
 */
export class EllipseCurve {
  constructor(
    public aX: number,
    public aY: number,
    public xRadius: number,
    public yRadius: number,
    _start = 0,
    _end = PI2,
    _clockwise = false,
    _rotation = 0,
  ) {}
  getPoints(divisions: number) {
    const out: Vector2[] = [];
    for (let d = 0; d <= divisions; d++) {
      const a = 0 + (d / divisions) * PI2;
      out.push(new Vector2(this.aX + this.xRadius * Math.cos(a), this.aY + this.yRadius * Math.sin(a)));
    }
    return out;
  }
}

// ------------------------------------------------------------------- tube

export class TubeGeometry extends BufferGeometry {
  constructor(path: CatmullRomCurve3, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false) {
    super();
    const { normals, binormals } = path.computeFrenetFrames(tubularSegments, closed);
    const vertices: number[] = [];
    const n = new Vector3();
    const segment = (i: number) => {
      const P = path.getPointAt(i / tubularSegments);
      const N = normals[i],
        B = binormals[i];
      for (let j = 0; j <= radialSegments; j++) {
        const v = (j / radialSegments) * Math.PI * 2;
        const sin = Math.sin(v),
          cos = -Math.cos(v);
        n.set(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize();
        vertices.push(P.x + radius * n.x, P.y + radius * n.y, P.z + radius * n.z);
      }
    };
    for (let i = 0; i < tubularSegments; i++) segment(i);
    segment(closed ? 0 : tubularSegments);
    finish(this, vertices, gridIndices(tubularSegments, radialSegments, true));
  }
}
