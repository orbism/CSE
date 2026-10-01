/**
 * Math for the CSE engine.
 *
 * Ported from three.js r169 (MIT, © 2010-2024 three.js authors), trimmed to
 * exactly the methods the archetypes and the framing solve call. The arithmetic
 * is kept operation-for-operation identical on purpose: the camera fit iterates
 * on projected bounding boxes, so a reordered multiply would move the framing
 * and with it every glyph in the piece.
 */

export class Vector2 {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
}

type Mat = { elements: number[] };

export class Vector3 {
  readonly isVector3 = true;
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  setScalar(s: number) {
    return this.set(s, s, s);
  }
  setX(x: number) {
    this.x = x;
    return this;
  }
  setY(y: number) {
    this.y = y;
    return this;
  }
  setZ(z: number) {
    this.z = z;
    return this;
  }
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  copy(v: Vector3) {
    return this.set(v.x, v.y, v.z);
  }
  add(v: Vector3) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  addVectors(a: Vector3, b: Vector3) {
    return this.set(a.x + b.x, a.y + b.y, a.z + b.z);
  }
  addScaledVector(v: Vector3, s: number) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  sub(v: Vector3) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  subVectors(a: Vector3, b: Vector3) {
    return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  multiply(v: Vector3) {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }
  negate() {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }
  multiplyScalar(s: number) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  divideScalar(s: number) {
    return this.multiplyScalar(1 / s);
  }
  min(v: Vector3) {
    return this.set(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z));
  }
  max(v: Vector3) {
    return this.set(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z));
  }
  dot(v: Vector3) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  distanceTo(v: Vector3) {
    return Math.sqrt(this.distanceToSquared(v));
  }
  distanceToSquared(v: Vector3) {
    const dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  cross(v: Vector3) {
    return this.crossVectors(this, v);
  }
  crossVectors(a: Vector3, b: Vector3) {
    const ax = a.x,
      ay = a.y,
      az = a.z,
      bx = b.x,
      by = b.y,
      bz = b.z;
    return this.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  }
  lerp(v: Vector3, a: number) {
    this.x += (v.x - this.x) * a;
    this.y += (v.y - this.y) * a;
    this.z += (v.z - this.z) * a;
    return this;
  }
  applyMatrix4(m: Mat) {
    const x = this.x,
      y = this.y,
      z = this.z,
      e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  transformDirection(m: Mat) {
    const x = this.x,
      y = this.y,
      z = this.z,
      e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }
  project(camera: { matrixWorldInverse: Mat; projectionMatrix: Mat }) {
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  }
  setFromMatrixPosition(m: Mat) {
    const e = m.elements;
    return this.set(e[12], e[13], e[14]);
  }
  setFromMatrixColumn(m: Mat, i: number) {
    const e = m.elements;
    return this.set(e[i * 4], e[i * 4 + 1], e[i * 4 + 2]);
  }
  fromBufferAttribute(a: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number) {
    return this.set(a.getX(i), a.getY(i), a.getZ(i));
  }
  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

export class Quaternion {
  _x = 0;
  _y = 0;
  _z = 0;
  _w = 1;
  _onChange = () => {};
  get x() {
    return this._x;
  }
  get y() {
    return this._y;
  }
  get z() {
    return this._z;
  }
  get w() {
    return this._w;
  }
  length() {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
  }
  normalize() {
    let l = this.length();
    if (l === 0) {
      this._x = this._y = this._z = 0;
      this._w = 1;
    } else {
      l = 1 / l;
      this._x = this._x * l;
      this._y = this._y * l;
      this._z = this._z * l;
      this._w = this._w * l;
    }
    this._onChange();
    return this;
  }
  /** XYZ order only; nothing here uses another. */
  setFromEuler(e: Euler) {
    const c1 = Math.cos(e._x / 2),
      c2 = Math.cos(e._y / 2),
      c3 = Math.cos(e._z / 2);
    const s1 = Math.sin(e._x / 2),
      s2 = Math.sin(e._y / 2),
      s3 = Math.sin(e._z / 2);
    this._x = s1 * c2 * c3 + c1 * s2 * s3;
    this._y = c1 * s2 * c3 - s1 * c2 * s3;
    this._z = c1 * c2 * s3 + s1 * s2 * c3;
    this._w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }
  setFromAxisAngle(axis: Vector3, angle: number) {
    const h = angle / 2,
      s = Math.sin(h);
    this._x = axis.x * s;
    this._y = axis.y * s;
    this._z = axis.z * s;
    this._w = Math.cos(h);
    this._onChange();
    return this;
  }
  setFromUnitVectors(from: Vector3, to: Vector3) {
    let r = from.dot(to) + 1;
    if (r < Number.EPSILON) {
      r = 0;
      if (Math.abs(from.x) > Math.abs(from.z)) {
        this._x = -from.y;
        this._y = from.x;
        this._z = 0;
      } else {
        this._x = 0;
        this._y = -from.z;
        this._z = from.y;
      }
      this._w = r;
    } else {
      this._x = from.y * to.z - from.z * to.y;
      this._y = from.z * to.x - from.x * to.z;
      this._z = from.x * to.y - from.y * to.x;
      this._w = r;
    }
    return this.normalize();
  }
  setFromRotationMatrix(m: Mat) {
    const te = m.elements,
      m11 = te[0],
      m12 = te[4],
      m13 = te[8],
      m21 = te[1],
      m22 = te[5],
      m23 = te[9],
      m31 = te[2],
      m32 = te[6],
      m33 = te[10],
      trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      this._w = 0.25 / s;
      this._x = (m32 - m23) * s;
      this._y = (m13 - m31) * s;
      this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
      this._w = (m32 - m23) / s;
      this._x = 0.25 * s;
      this._y = (m12 + m21) / s;
      this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
      this._w = (m13 - m31) / s;
      this._x = (m12 + m21) / s;
      this._y = 0.25 * s;
      this._z = (m23 + m32) / s;
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
      this._w = (m21 - m12) / s;
      this._x = (m13 + m31) / s;
      this._y = (m23 + m32) / s;
      this._z = 0.25 * s;
    }
    this._onChange();
    return this;
  }
}

/**
 * XYZ Euler. Writing any component re-derives the owner's quaternion, as in
 * three. The reverse sync (quaternion -> Euler) is omitted: nothing here reads a
 * rotation back after setting a quaternion directly.
 */
export class Euler {
  _x = 0;
  _y = 0;
  _z = 0;
  _onChange = () => {};
  get x() {
    return this._x;
  }
  set x(v) {
    this._x = v;
    this._onChange();
  }
  get y() {
    return this._y;
  }
  set y(v) {
    this._y = v;
    this._onChange();
  }
  get z() {
    return this._z;
  }
  set z(v) {
    this._z = v;
    this._onChange();
  }
  set(x: number, y: number, z: number) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._onChange();
    return this;
  }
}

export class Matrix4 {
  elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  set(...n: number[]) {
    const te = this.elements;
    // row-major arguments, column-major storage
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) te[c * 4 + r] = n[r * 4 + c];
    return this;
  }
  copy(m: Mat) {
    this.elements = m.elements.slice();
    return this;
  }
  fromArray(a: ArrayLike<number>, o = 0) {
    for (let i = 0; i < 16; i++) this.elements[i] = a[i + o];
    return this;
  }
  multiply(m: Mat) {
    return this.multiplyMatrices(this, m);
  }
  multiplyMatrices(a: Mat, b: Mat) {
    const ae = a.elements,
      be = b.elements,
      te = this.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }
  determinant() {
    const te = this.elements;
    const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12];
    const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
    const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14];
    const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
    return (
      n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
    );
  }
  invert() {
    const te = this.elements,
      n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3],
      n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7],
      n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11],
      n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15],
      t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44,
      t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44,
      t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44,
      t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const d = 1 / det;
    te[0] = t11 * d;
    te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
    te[4] = t12 * d;
    te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
    te[8] = t13 * d;
    te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
    te[12] = t14 * d;
    te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
    return this;
  }
  scale(v: Vector3) {
    const te = this.elements,
      x = v.x,
      y = v.y,
      z = v.z;
    te[0] *= x; te[4] *= y; te[8] *= z;
    te[1] *= x; te[5] *= y; te[9] *= z;
    te[2] *= x; te[6] *= y; te[10] *= z;
    te[3] *= x; te[7] *= y; te[11] *= z;
    return this;
  }
  makeTranslation(x: number, y: number, z: number) {
    return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
  }
  makeRotationAxis(axis: Vector3, angle: number) {
    const c = Math.cos(angle),
      s = Math.sin(angle),
      t = 1 - c,
      x = axis.x,
      y = axis.y,
      z = axis.z,
      tx = t * x,
      ty = t * y;
    return this.set(
      tx * x + c, tx * y - s * z, tx * z + s * y, 0,
      tx * y + s * z, ty * y + c, ty * z - s * x, 0,
      tx * z - s * y, ty * z + s * x, t * z * z + c, 0,
      0, 0, 0, 1,
    );
  }
  compose(p: Vector3, q: Quaternion, s: Vector3) {
    const te = this.elements;
    const x = q._x, y = q._y, z = q._z, w = q._w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = s.x, sy = s.y, sz = s.z;
    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;
    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;
    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;
    te[12] = p.x;
    te[13] = p.y;
    te[14] = p.z;
    te[15] = 1;
    return this;
  }
  lookAt(eye: Vector3, target: Vector3, up: Vector3) {
    const te = this.elements;
    const z = new Vector3().subVectors(eye, target);
    if (z.lengthSq() === 0) z.z = 1;
    z.normalize();
    const x = new Vector3().crossVectors(up, z);
    if (x.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) z.x += 0.0001;
      else z.z += 0.0001;
      z.normalize();
      x.crossVectors(up, z);
    }
    x.normalize();
    const y = new Vector3().crossVectors(z, x);
    te[0] = x.x; te[4] = y.x; te[8] = z.x;
    te[1] = x.y; te[5] = y.y; te[9] = z.y;
    te[2] = x.z; te[6] = y.z; te[10] = z.z;
    return this;
  }
  makePerspective(left: number, right: number, top: number, bottom: number, near: number, far: number) {
    const te = this.elements;
    const x = (2 * near) / (right - left);
    const y = (2 * near) / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    const c = -(far + near) / (far - near);
    const d = (-2 * far * near) / (far - near);
    te[0] = x; te[4] = 0; te[8] = a; te[12] = 0;
    te[1] = 0; te[5] = y; te[9] = b; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = -1; te[15] = 0;
    return this;
  }
}

const srgbToLinear = (c: number) =>
  c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);

/**
 * Linear-working-space colour, as three's ColorManagement keeps it: hex numbers
 * and CSS hex strings are read as sRGB and linearised; (r, g, b) is taken as
 * already linear.
 */
export class Color {
  r = 1;
  g = 1;
  b = 1;
  constructor(r?: number | string | Color, g?: number, b?: number) {
    if (g !== undefined && b !== undefined) {
      this.r = r as number;
      this.g = g;
      this.b = b;
    } else if (r instanceof Color) {
      this.r = r.r;
      this.g = r.g;
      this.b = r.b;
    } else if (typeof r === "number") {
      this.setSRGB((r >> 16) & 255, (r >> 8) & 255, r & 255, 255);
    } else if (typeof r === "string") {
      const h = r.replace("#", "");
      if (h.length === 3) this.setSRGB(parseInt(h[0], 16), parseInt(h[1], 16), parseInt(h[2], 16), 15);
      else this.setSRGB(...([0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]), 255);
    }
  }
  private setSRGB(r: number, g: number, b: number, d: number) {
    this.r = srgbToLinear(r / d);
    this.g = srgbToLinear(g / d);
    this.b = srgbToLinear(b / d);
  }
}

export class Box3 {
  min = new Vector3(+Infinity, +Infinity, +Infinity);
  max = new Vector3(-Infinity, -Infinity, -Infinity);

  makeEmpty() {
    this.min.set(+Infinity, +Infinity, +Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }
  isEmpty() {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
  clone() {
    return new Box3().copy(this);
  }
  copy(b: Box3) {
    this.min.copy(b.min);
    this.max.copy(b.max);
    return this;
  }
  expandByPoint(p: Vector3) {
    this.min.min(p);
    this.max.max(p);
    return this;
  }
  union(b: Box3) {
    this.min.min(b.min);
    this.max.max(b.max);
    return this;
  }
  translate(v: Vector3) {
    this.min.add(v);
    this.max.add(v);
    return this;
  }
  getCenter(t: Vector3) {
    return this.isEmpty() ? t.set(0, 0, 0) : t.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
  getSize(t: Vector3) {
    return this.isEmpty() ? t.set(0, 0, 0) : t.subVectors(this.max, this.min);
  }
  getBoundingSphere(s: Sphere) {
    if (this.isEmpty()) {
      s.center.set(0, 0, 0);
      s.radius = -1;
    } else {
      this.getCenter(s.center);
      s.radius = this.getSize(new Vector3()).length() * 0.5;
    }
    return s;
  }
  setFromArray(a: ArrayLike<number>) {
    this.makeEmpty();
    const v = new Vector3();
    for (let i = 0; i < a.length; i += 3) this.expandByPoint(v.set(a[i], a[i + 1], a[i + 2]));
    return this;
  }
  applyMatrix4(m: Mat) {
    if (this.isEmpty()) return this;
    const { min: a, max: b } = this;
    const pts = [
      [a.x, a.y, a.z], [a.x, a.y, b.z], [a.x, b.y, a.z], [a.x, b.y, b.z],
      [b.x, a.y, a.z], [b.x, a.y, b.z], [b.x, b.y, a.z], [b.x, b.y, b.z],
    ].map(([x, y, z]) => new Vector3(x, y, z).applyMatrix4(m));
    this.makeEmpty();
    for (const p of pts) this.expandByPoint(p);
    return this;
  }
  /** three's non-precise path: each object's (instanced or geometry) box, transformed to world. */
  setFromObject(o: BoxSource) {
    this.makeEmpty();
    return this.expandByObject(o);
  }
  expandByObject(o: BoxSource): this {
    o.updateWorldMatrix(false, false);
    const box = o.localBox?.();
    if (box) this.union(box.clone().applyMatrix4(o.matrixWorld));
    for (const c of o.children) this.expandByObject(c);
    return this;
  }
}

/** What Box3.setFromObject walks: anything in the scene graph that may carry geometry. */
export interface BoxSource {
  matrixWorld: Mat;
  children: BoxSource[];
  updateWorldMatrix(parents: boolean, children: boolean): void;
  localBox?(): Box3 | null;
}

export class Sphere {
  constructor(
    public center = new Vector3(),
    public radius = -1,
  ) {}
}
