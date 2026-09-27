import * as THREE from 'three';

export interface SpawnOpts {
  size?: number;
  life?: number;
  grow?: number; // size multiplier per second
  gravity?: number;
  drag?: number;
}

const VERT = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 pcolor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    vAlpha = alpha;
    vColor = pcolor;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(uSoft, 1.0, d);
    if (a * vAlpha < 0.004) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`;

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private baseSize: Float32Array;
  private baseAlpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;

  constructor(private max: number, additive: boolean, soft = 0.0) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.baseAlpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 500 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, alpha: number, o: SpawnOpts = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.baseSize[i] = o.size ?? 0.5;
    this.baseAlpha[i] = alpha;
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.grow[i] = o.grow ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= d; this.vel[j + 1] = this.vel[j + 1] * d - this.grav[i] * dt; this.vel[j + 2] *= d;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.05 && this.grav[i] > 0) { this.pos[j + 1] = 0.05; this.vel[j + 1] *= -0.4; }
      const age = this.maxLife[i] - this.life[i];
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * age);
      this.alpha[i] = this.baseAlpha[i] * k;
    }
    for (const n of ['position', 'pcolor', 'size', 'alpha']) this.geo.getAttribute(n).needsUpdate = true;
  }

  setScale(s: number) {
    this.material.uniforms.uScale.value = s;
  }
}
