/**
 * Scene graph, buffers and materials for the CSE engine.
 *
 * Shapes and semantics follow three.js r169 (MIT) closely enough that the
 * archetypes run unchanged: same class names, same transform order, same
 * id-ordered sorting. Only what the collection uses is here.
 */

import { Box3, type BoxSource, Color, Euler, Matrix4, Quaternion, Vector3 } from "./math.js";

export const FrontSide = 0;
export const DoubleSide = 2;

let objectId = 0;
let materialId = 0;

// ---------------------------------------------------------------- buffers

export class BufferAttribute {
  readonly count: number;
  constructor(
    public array: Float32Array | Uint32Array,
    public itemSize: number,
  ) {
    this.count = array.length / itemSize;
  }
  getX(i: number) {
    return this.array[i * this.itemSize];
  }
  getY(i: number) {
    return this.array[i * this.itemSize + 1];
  }
  getZ(i: number) {
    return this.array[i * this.itemSize + 2];
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: ArrayLike<number>, itemSize: number) {
    super(new Float32Array(array), itemSize);
  }
}

/** Positions and an optional index; the engine shades flat, so no normals or UVs. */
export class BufferGeometry {
  attributes: Record<string, BufferAttribute> = {};
  index: BufferAttribute | null = null;
  boundingBox: Box3 | null = null;
  /** Set by the renderer; dispose() frees its GPU buffers. */
  onDispose: (() => void) | null = null;

  setAttribute(name: string, a: BufferAttribute) {
    this.attributes[name] = a;
    return this;
  }
  getAttribute(name: string) {
    return this.attributes[name];
  }
  setIndex(index: number[]) {
    this.index = new BufferAttribute(new Uint32Array(index), 1);
    return this;
  }
  computeBoundingBox() {
    this.boundingBox = new Box3().setFromArray(this.attributes.position.array);
  }
  /** No-op: shading is flat, from screen-space derivatives. Kept for API parity. */
  computeVertexNormals() {}
  dispose() {
    this.onDispose?.();
  }
}

// -------------------------------------------------------------- materials

type Params = Record<string, unknown>;

export class Material {
  readonly id = materialId++;
  side = FrontSide;
  transparent = false;
  opacity = 1;
  wireframe = false;
  color = new Color();
  constructor(params: Params = {}) {
    Object.assign(this, params);
  }
  dispose() {}
}

export class MeshStandardMaterial extends Material {
  readonly lit = true;
  emissive = new Color(0, 0, 0);
  emissiveIntensity = 1;
  roughness = 1;
  metalness = 0;
  flatShading = true;
  constructor(params: Params = {}) {
    super();
    Object.assign(this, params);
  }
}

export class MeshBasicMaterial extends Material {}
export class LineBasicMaterial extends Material {}

export class PointsMaterial extends Material {
  size = 1;
  sizeAttenuation = true;
  constructor(params: Params = {}) {
    super();
    Object.assign(this, params);
  }
}

// ----------------------------------------------------------- scene graph

export class Object3D implements BoxSource {
  readonly id = objectId++;
  parent: Object3D | null = null;
  children: Object3D[] = [];
  readonly position = new Vector3();
  readonly rotation = new Euler();
  readonly quaternion = new Quaternion();
  readonly scale = new Vector3(1, 1, 1);
  readonly up = new Vector3(0, 1, 0);
  matrix = new Matrix4();
  matrixWorld = new Matrix4();
  visible = true;
  renderOrder = 0;
  userData: Record<string, unknown> = {};

  constructor() {
    this.rotation._onChange = () => this.quaternion.setFromEuler(this.rotation);
  }

  add(o: Object3D) {
    o.parent?.remove(o);
    o.parent = this;
    this.children.push(o);
    return this;
  }
  remove(o: Object3D) {
    const i = this.children.indexOf(o);
    if (i !== -1) {
      o.parent = null;
      this.children.splice(i, 1);
    }
    return this;
  }
  traverse(fn: (o: Object3D) => void) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }
  /** three recomputes every world matrix under auto-update; so does this. */
  updateMatrixWorld(_force?: boolean) {
    this.updateMatrix();
    if (this.parent === null) this.matrixWorld.copy(this.matrix);
    else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    for (const c of this.children) c.updateMatrixWorld(true);
  }
  updateWorldMatrix(parents: boolean, children: boolean) {
    if (parents && this.parent) this.parent.updateWorldMatrix(true, false);
    this.updateMatrix();
    if (this.parent === null) this.matrixWorld.copy(this.matrix);
    else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    if (children) for (const c of this.children) c.updateWorldMatrix(false, true);
  }
  getWorldPosition(t: Vector3) {
    this.updateWorldMatrix(true, false);
    return t.setFromMatrixPosition(this.matrixWorld);
  }
}

export class Group extends Object3D {}

/** Anything drawn: one geometry, one material. */
export class Drawable extends Object3D {
  constructor(
    public geometry: BufferGeometry,
    public material: Material,
  ) {
    super();
  }
  localBox(): Box3 | null {
    if (!this.geometry.boundingBox) this.geometry.computeBoundingBox();
    return this.geometry.boundingBox;
  }
}

export class Mesh extends Drawable {}
export class Points extends Drawable {
  declare material: PointsMaterial;
}
export class LineSegments extends Drawable {}

export class InstancedMesh extends Mesh {
  readonly instanceMatrix: { array: Float32Array; needsUpdate: boolean };
  private box: Box3 | null = null;

  constructor(
    geometry: BufferGeometry,
    material: Material,
    public count: number,
  ) {
    super(geometry, material);
    const array = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) array.set(new Matrix4().elements, i * 16);
    this.instanceMatrix = { array, needsUpdate: false };
  }
  setMatrixAt(i: number, m: Matrix4) {
    this.instanceMatrix.array.set(m.elements, i * 16);
  }
  /** Union of every instance's box, as three's InstancedMesh.computeBoundingBox. */
  localBox() {
    if (!this.box) {
      const g = super.localBox()!;
      const m = new Matrix4();
      this.box = new Box3();
      for (let i = 0; i < this.count; i++) {
        this.box.union(g.clone().applyMatrix4(m.fromArray(this.instanceMatrix.array, i * 16)));
      }
    }
    return this.box;
  }
}

export class Scene extends Object3D {
  background: Color | null = null;
  fog: Fog | null = null;
}

export class Fog {
  constructor(
    public color: Color,
    public near = 1,
    public far = 1000,
  ) {}
}

export class AmbientLight extends Object3D {
  color: Color;
  constructor(
    color: number,
    public intensity = 1,
  ) {
    super();
    this.color = new Color(color);
  }
}

export class DirectionalLight extends Object3D {
  color: Color;
  constructor(
    color: number,
    public intensity = 1,
  ) {
    super();
    this.color = new Color(color);
    this.position.set(0, 1, 0);
  }
}

export class Camera extends Object3D {
  readonly isCamera = true;
  matrixWorldInverse = new Matrix4();
  projectionMatrix = new Matrix4();

  updateMatrixWorld(force?: boolean) {
    super.updateMatrixWorld(force);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
  updateWorldMatrix(parents: boolean, children: boolean) {
    super.updateWorldMatrix(parents, children);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
  /** Cameras look down -Z, so eye and target swap relative to other objects. */
  lookAt(x: number, y: number, z: number) {
    this.updateWorldMatrix(true, false);
    const pos = new Vector3().setFromMatrixPosition(this.matrixWorld);
    this.quaternion.setFromRotationMatrix(new Matrix4().lookAt(pos, new Vector3(x, y, z), this.up));
  }
}

export class PerspectiveCamera extends Camera {
  constructor(
    public fov = 50,
    public aspect = 1,
    public near = 0.1,
    public far = 2000,
  ) {
    super();
    this.updateProjectionMatrix();
  }
  updateProjectionMatrix() {
    const top = (this.near * Math.tan((Math.PI / 180) * 0.5 * this.fov)) / 1;
    const height = 2 * top;
    const width = this.aspect * height;
    const left = -0.5 * width;
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, this.near, this.far);
  }
}
