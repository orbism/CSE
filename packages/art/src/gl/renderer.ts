/**
 * The CSE engine's WebGL2 renderer.
 *
 * Draws exactly what the collection uses: flat-shaded physically based
 * surfaces (three.js r169's MeshStandardMaterial path, MIT, ported for a scene
 * with directional and ambient light and no environment), unlit meshes, lines
 * and points, linear fog, alpha blending, all into a 4x multisampled target
 * that the glyph pass reads back. Output is linear, as three writes into a
 * render target.
 */

import { Matrix4, Vector3 } from "./math.js";
import {
  AmbientLight,
  type BufferGeometry,
  type Camera,
  DirectionalLight,
  DoubleSide,
  Drawable,
  InstancedMesh,
  LineSegments,
  MeshStandardMaterial,
  type Object3D,
  Points,
  type Scene,
} from "./scene.js";

export class WebGLRenderTarget {
  onDispose: (() => void) | null = null;
  constructor(
    public width: number,
    public height: number,
    public options: { samples?: number } = {},
  ) {}
  dispose() {
    this.onDispose?.();
  }
}

const VERT = `
in vec3 position;
#ifdef INSTANCED
in mat4 instanceMatrix;
#endif
uniform mat4 modelViewMatrix, projectionMatrix;
uniform float size, scale;
out vec3 vViewPosition;
out float vFogDepth;
void main() {
  vec4 mvPosition = vec4(position, 1.0);
#ifdef INSTANCED
  mvPosition = instanceMatrix * mvPosition;
#endif
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
#ifdef POINTS
  gl_PointSize = size * (scale / - mvPosition.z);
#endif
  vViewPosition = - mvPosition.xyz;
  vFogDepth = - mvPosition.z;
}`;

const FRAG = `
#define RECIPROCAL_PI 0.3183098861837907
#define EPSILON 1e-6
#define saturate(a) clamp(a, 0.0, 1.0)
uniform vec3 diffuse, emissive, fogColor, ambientLightColor;
uniform float opacity, roughness, metalness, fogNear, fogFar;
#if NUM_DIR > 0
uniform vec3 dirDirection[NUM_DIR], dirColor[NUM_DIR];
#endif
in vec3 vViewPosition;
in float vFogDepth;
out highp vec4 fragColor;
float pow2(const in float x) { return x * x; }
vec3 BRDF_Lambert(const in vec3 c) { return RECIPROCAL_PI * c; }
vec3 F_Schlick(const in vec3 f0, const in float f90, const in float dotVH) {
  float fresnel = exp2((- 5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1.0 - fresnel) + (f90 * fresnel);
}
float V_GGX_SmithCorrelated(const in float alpha, const in float dotNL, const in float dotNV) {
  float a2 = pow2(alpha);
  float gv = dotNL * sqrt(a2 + (1.0 - a2) * pow2(dotNV));
  float gl = dotNV * sqrt(a2 + (1.0 - a2) * pow2(dotNL));
  return 0.5 / max(gv + gl, EPSILON);
}
float D_GGX(const in float alpha, const in float dotNH) {
  float a2 = pow2(alpha);
  float denom = pow2(dotNH) * (a2 - 1.0) + 1.0;
  return RECIPROCAL_PI * a2 / pow2(denom);
}
vec3 BRDF_GGX(const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 f0, const in float f90, const in float rough) {
  float alpha = pow2(rough);
  vec3 halfDir = normalize(lightDir + viewDir);
  float dotNL = saturate(dot(normal, lightDir));
  float dotNV = saturate(dot(normal, viewDir));
  float dotNH = saturate(dot(normal, halfDir));
  float dotVH = saturate(dot(viewDir, halfDir));
  vec3 F = F_Schlick(f0, f90, dotVH);
  float V = V_GGX_SmithCorrelated(alpha, dotNL, dotNV);
  float D = D_GGX(alpha, dotNH);
  return F * (V * D);
}
void main() {
  vec4 diffuseColor = vec4(diffuse, opacity);
#ifdef LIT
  vec3 fdx = dFdx(vViewPosition);
  vec3 fdy = dFdy(vViewPosition);
  vec3 normal = normalize(cross(fdx, fdy));
  vec3 matDiffuse = diffuseColor.rgb * (1.0 - metalness);
  vec3 dxy = max(abs(dFdx(normal)), abs(dFdy(normal)));
  float geometryRoughness = max(max(dxy.x, dxy.y), dxy.z);
  float rough = max(roughness, 0.0525);
  rough += geometryRoughness;
  rough = min(rough, 1.0);
  vec3 specularColor = mix(vec3(0.04), diffuseColor.rgb, metalness);
  vec3 viewDir = normalize(vViewPosition);
  vec3 directDiffuse = vec3(0.0);
  vec3 directSpecular = vec3(0.0);
#if NUM_DIR > 0
  for (int i = 0; i < NUM_DIR; i++) {
    float dotNL = saturate(dot(normal, dirDirection[i]));
    vec3 irradiance = dotNL * dirColor[i];
    directSpecular += irradiance * BRDF_GGX(dirDirection[i], viewDir, normal, specularColor, 1.0, rough);
    directDiffuse += irradiance * BRDF_Lambert(matDiffuse);
  }
#endif
  vec3 indirectDiffuse = ambientLightColor * BRDF_Lambert(matDiffuse);
  vec3 outgoingLight = (directDiffuse + indirectDiffuse) + directSpecular + emissive;
#else
  vec3 outgoingLight = diffuseColor.rgb;
#endif
#ifdef OPAQUE
  diffuseColor.a = 1.0;
#endif
  fragColor = vec4(outgoingLight, diffuseColor.a);
  fragColor.rgb = mix(fragColor.rgb, fogColor, smoothstep(fogNear, fogFar, vFogDepth));
}`;

interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}
interface GeoBuffers {
  pos: WebGLBuffer;
  count: number;
  index: WebGLBuffer | null;
  indexCount: number;
  wire?: { buf: WebGLBuffer; count: number };
}
interface TargetBuffers {
  ms: WebGLFramebuffer;
  resolve: WebGLFramebuffer;
}

const UNIFORMS = [
  "modelViewMatrix", "projectionMatrix", "size", "scale", "diffuse", "emissive", "fogColor",
  "ambientLightColor", "opacity", "roughness", "metalness", "fogNear", "fogFar", "dirDirection", "dirColor",
];

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private target: WebGLRenderTarget | null = null;
  private height = 1;
  private programs = new Map<string, Program>();
  private geos = new WeakMap<BufferGeometry, GeoBuffers>();
  private instances = new WeakMap<InstancedMesh, WebGLBuffer>();
  private targets = new WeakMap<WebGLRenderTarget, TargetBuffers>();

  constructor({ canvas }: { canvas: HTMLCanvasElement; antialias?: boolean; preserveDrawingBuffer?: boolean }) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
  }

  setPixelRatio(_ratio: number) {}

  /** The height feeds point-size attenuation exactly as three's `_height` does. */
  setSize(width: number, height: number, _style?: boolean) {
    this.height = height;
    const c = this.gl.canvas as HTMLCanvasElement;
    c.width = width;
    c.height = height;
  }

  getRenderTarget() {
    return this.target;
  }
  setRenderTarget(t: WebGLRenderTarget | null) {
    this.target = t;
  }

  render(scene: Scene, camera: Camera) {
    const gl = this.gl;
    const t = this.target;
    if (!t) throw new Error("the CSE engine only renders into a target");
    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();

    // ---- gather lights and drawables, depth first, as three's projectObject
    const proj = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const ambient = [0, 0, 0];
    const dirs: number[] = [];
    const dirColors: number[] = [];
    type Item = { o: Drawable; z: number };
    const opaque: Item[] = [];
    const transparent: Item[] = [];
    const v = new Vector3();
    const visit = (o: Object3D) => {
      if (!o.visible) return;
      if (o instanceof AmbientLight) {
        ambient[0] += o.color.r * o.intensity;
        ambient[1] += o.color.g * o.intensity;
        ambient[2] += o.color.b * o.intensity;
      } else if (o instanceof DirectionalLight) {
        // target sits at the origin, never updated: direction = position
        v.setFromMatrixPosition(o.matrixWorld).transformDirection(camera.matrixWorldInverse);
        dirs.push(v.x, v.y, v.z);
        dirColors.push(o.color.r * o.intensity, o.color.g * o.intensity, o.color.b * o.intensity);
      } else if (o instanceof Drawable) {
        const z = v.setFromMatrixPosition(o.matrixWorld).applyMatrix4(proj).z;
        (o.material.transparent ? transparent : opaque).push({ o, z });
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
    opaque.sort(
      (a, b) =>
        a.o.renderOrder - b.o.renderOrder || a.o.material.id - b.o.material.id || a.z - b.z || a.o.id - b.o.id,
    );
    transparent.sort((a, b) => a.o.renderOrder - b.o.renderOrder || b.z - a.z || a.o.id - b.o.id);

    // ---- target, clear
    const tb = this.targetBuffers(t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, tb.ms);
    gl.viewport(0, 0, t.width, t.height);
    const bg = scene.background;
    gl.clearColor(bg?.r ?? 0, bg?.g ?? 0, bg?.b ?? 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const fog = scene.fog;
    const mv = new Matrix4();
    for (const { o } of [...opaque, ...transparent]) {
      const m = o.material;
      const lit = m instanceof MeshStandardMaterial;
      const points = o instanceof Points;
      const instanced = o instanceof InstancedMesh;
      const prog = this.program(lit, points, instanced, !m.transparent, dirs.length / 3);
      gl.useProgram(prog.p);
      const u = prog.u;

      gl.uniformMatrix4fv(u.modelViewMatrix, false, mv.multiplyMatrices(camera.matrixWorldInverse, o.matrixWorld).elements);
      gl.uniformMatrix4fv(u.projectionMatrix, false, camera.projectionMatrix.elements);
      gl.uniform3f(u.diffuse, m.color.r, m.color.g, m.color.b);
      gl.uniform1f(u.opacity, m.opacity);
      gl.uniform3f(u.fogColor, fog?.color.r ?? 0, fog?.color.g ?? 0, fog?.color.b ?? 0);
      gl.uniform1f(u.fogNear, fog?.near ?? 1e9);
      gl.uniform1f(u.fogFar, fog?.far ?? 2e9);
      if (lit) {
        const k = m.emissiveIntensity;
        gl.uniform3f(u.emissive, m.emissive.r * k, m.emissive.g * k, m.emissive.b * k);
        gl.uniform1f(u.roughness, m.roughness);
        gl.uniform1f(u.metalness, m.metalness);
        gl.uniform3fv(u.ambientLightColor, ambient);
        if (dirs.length) {
          gl.uniform3fv(u.dirDirection, dirs);
          gl.uniform3fv(u.dirColor, dirColors);
        }
      }
      if (points) {
        gl.uniform1f(u.size, (o as Points).material.size);
        gl.uniform1f(u.scale, this.height * 0.5);
      }

      if (m.transparent) {
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      } else gl.disable(gl.BLEND);
      if (m.side === DoubleSide) gl.disable(gl.CULL_FACE);
      else {
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
      }
      gl.frontFace(!points && !(o instanceof LineSegments) && o.matrixWorld.determinant() < 0 ? gl.CW : gl.CCW);

      this.draw(o, points, instanced);
    }

    // ---- resolve the multisampled target for readback
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, tb.ms);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, tb.resolve);
    gl.blitFramebuffer(0, 0, t.width, t.height, 0, 0, t.width, t.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  readRenderTargetPixels(t: WebGLRenderTarget, x: number, y: number, w: number, h: number, out: Uint8Array) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targetBuffers(t).resolve);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  // ------------------------------------------------------------- internals

  private draw(o: Drawable, points: boolean, instanced: boolean) {
    const gl = this.gl;
    const g = this.geoBuffers(o.geometry);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    let count = 1;
    if (instanced) {
      const im = o as InstancedMesh;
      count = im.count;
      let buf = this.instances.get(im);
      if (!buf || im.instanceMatrix.needsUpdate) {
        buf ??= gl.createBuffer()!;
        this.instances.set(im, buf);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, im.instanceMatrix.array, gl.STATIC_DRAW);
        im.instanceMatrix.needsUpdate = false;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let c = 0; c < 4; c++) {
        gl.enableVertexAttribArray(1 + c);
        gl.vertexAttribPointer(1 + c, 4, gl.FLOAT, false, 64, c * 16);
        gl.vertexAttribDivisor(1 + c, 1);
      }
    } else for (let c = 0; c < 4; c++) gl.disableVertexAttribArray(1 + c);

    const wire = o.material.wireframe && !points && !(o instanceof LineSegments);
    const mode = points ? gl.POINTS : o instanceof LineSegments || wire ? gl.LINES : gl.TRIANGLES;
    const index = wire ? this.wireIndex(o.geometry, g) : g.index ? { buf: g.index, count: g.indexCount } : null;
    if (index) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buf);
      gl.drawElementsInstanced(mode, index.count, gl.UNSIGNED_INT, 0, count);
    } else gl.drawArraysInstanced(mode, 0, g.count, count);
  }

  private geoBuffers(geo: BufferGeometry): GeoBuffers {
    let g = this.geos.get(geo);
    if (g) return g;
    const gl = this.gl;
    const pos = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, geo.attributes.position.array, gl.STATIC_DRAW);
    let index: WebGLBuffer | null = null;
    if (geo.index) {
      index = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.index.array, gl.STATIC_DRAW);
    }
    g = { pos, count: geo.attributes.position.count, index, indexCount: geo.index?.count ?? 0 };
    this.geos.set(geo, g);
    geo.onDispose = () => {
      gl.deleteBuffer(pos);
      if (index) gl.deleteBuffer(index);
      if (g!.wire) gl.deleteBuffer(g!.wire.buf);
      this.geos.delete(geo);
    };
    return g;
  }

  /** a-b, b-c, c-a per triangle, undeduplicated, as three's wireframe attribute. */
  private wireIndex(geo: BufferGeometry, g: GeoBuffers) {
    if (!g.wire) {
      const out: number[] = [];
      const tri = geo.index ? Array.from(geo.index.array) : null;
      const n = tri ? tri.length : g.count - 1;
      for (let i = 0; i < n; i += 3) {
        const [a, b, c] = tri ? [tri[i], tri[i + 1], tri[i + 2]] : [i, i + 1, i + 2];
        out.push(a, b, b, c, c, a);
      }
      const gl = this.gl;
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(out), gl.STATIC_DRAW);
      g.wire = { buf, count: out.length };
    }
    return g.wire;
  }

  private targetBuffers(t: WebGLRenderTarget): TargetBuffers {
    let tb = this.targets.get(t);
    if (tb) return tb;
    const gl = this.gl;
    const samples = Math.min(t.options.samples ?? 0, gl.getParameter(gl.MAX_SAMPLES));
    const rb = (format: number, ms: boolean) => {
      const r = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, r);
      if (ms) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, t.width, t.height);
      else gl.renderbufferStorage(gl.RENDERBUFFER, format, t.width, t.height);
      return r;
    };
    const fb = (color: WebGLRenderbuffer, depth?: WebGLRenderbuffer) => {
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      return f;
    };
    const bufs = [rb(gl.RGBA8, true), rb(gl.DEPTH_COMPONENT24, true), rb(gl.RGBA8, false)];
    tb = { ms: fb(bufs[0], bufs[1]), resolve: fb(bufs[2]) };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets.set(t, tb);
    t.onDispose = () => {
      gl.deleteFramebuffer(tb!.ms);
      gl.deleteFramebuffer(tb!.resolve);
      bufs.forEach((b) => gl.deleteRenderbuffer(b));
      this.targets.delete(t);
    };
    return tb;
  }

  private program(lit: boolean, points: boolean, instanced: boolean, opaque: boolean, dirs: number): Program {
    const defines = [lit && "LIT", points && "POINTS", instanced && "INSTANCED", opaque && "OPAQUE"]
      .filter(Boolean)
      .map((d) => `#define ${d}`)
      .concat(`#define NUM_DIR ${dirs}`)
      .join("\n");
    let prog = this.programs.get(defines);
    if (prog) return prog;
    const gl = this.gl;
    const head = `#version 300 es\nprecision highp float;\nprecision highp int;\n${defines}\n`;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, head + src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(p, 0, "position");
    gl.bindAttribLocation(p, 1, "instanceMatrix");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    const u: Program["u"] = {};
    for (const name of UNIFORMS) u[name] = gl.getUniformLocation(p, name);
    prog = { p, u };
    this.programs.set(defines, prog);
    return prog;
  }
}
