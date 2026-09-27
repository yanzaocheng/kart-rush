import * as THREE from 'three';
import * as T from './textures';
import { TrackDef } from './themes';


export interface Projection {
  index: number;
  s: number; // distance along track
  lateral: number; // signed distance from centerline (+ = right)
}

export class Track {
  readonly N = 2400;
  readonly halfWidth = 12;
  readonly curbWidth = 1.6;
  readonly wallOffset = 15;
  readonly pts: THREE.Vector3[] = [];
  readonly tan: THREE.Vector3[] = [];
  readonly right: THREE.Vector3[] = [];
  readonly length: number;
  readonly step: number;
  readonly group = new THREE.Group();
  readonly boostPads: { index: number; lateral: number; halfLen: number; halfW: number }[] = [];
  readonly itemRows: number[] = [];

  constructor(readonly def: TrackDef) {
    const curve = new THREE.CatmullRomCurve3(
      def.control.map(([x, z]) => new THREE.Vector3(x * def.scale, 0, z * def.scale)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    this.step = this.length / this.N;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.N; i++) {
      const u = i / this.N;
      this.pts.push(curve.getPointAt(u));
      const t = curve.getTangentAt(u).setY(0).normalize();
      this.tan.push(t);
      this.right.push(new THREE.Vector3().crossVectors(t, up).normalize());
    }
    // boost pads & item boxes (in meters along the track)
    for (const [m, lat] of def.boostPads) {
      this.boostPads.push({ index: this.idx(m), lateral: lat, halfLen: 4, halfW: 2.6 });
    }
    for (const m of def.itemRows) this.itemRows.push(this.idx(m));
    this.build();
  }

  idx(meters: number): number {
    return ((Math.round(meters / this.step) % this.N) + this.N) % this.N;
  }

  wrap(i: number): number {
    return ((i % this.N) + this.N) % this.N;
  }

  /** Project a world position onto the track, searching around a hint index. */
  project(pos: THREE.Vector3, hint: number, window = 60): Projection {
    let best = hint, bestD = Infinity;
    for (let k = -window; k <= window; k++) {
      const i = this.wrap(hint + k);
      const p = this.pts[i];
      const dx = pos.x - p.x, dz = pos.z - p.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    const p = this.pts[best], t = this.tan[best], r = this.right[best];
    const dx = pos.x - p.x, dz = pos.z - p.z;
    const along = dx * t.x + dz * t.z;
    const lateral = dx * r.x + dz * r.z;
    let s = best * this.step + along;
    s = ((s % this.length) + this.length) % this.length;
    return { index: best, s, lateral };
  }

  /** Global nearest (slow): used for respawn / init. */
  nearest(pos: THREE.Vector3): number {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.N; i++) {
      const d = this.pts[i].distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  pointAt(index: number, lateral: number, out = new THREE.Vector3()): THREE.Vector3 {
    const i = this.wrap(index);
    return out.copy(this.pts[i]).addScaledVector(this.right[i], lateral);
  }

  /** Heading (yaw) of the track at index. forward = (sin yaw, cos yaw) */
  yawAt(index: number): number {
    const t = this.tan[this.wrap(index)];
    return Math.atan2(t.x, t.z);
  }

  private ribbon(
    offA: number, offB: number, yA: number, yB: number, vLen: number, material: THREE.Material,
    alongU = false,
  ): THREE.Mesh {
    const n = this.N + 1;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let k = 0; k < n; k++) {
      const i = k % this.N;
      const p = this.pts[i], r = this.right[i];
      const v = (k * this.step) / vLen;
      pos.set([p.x + r.x * offA, yA, p.z + r.z * offA, p.x + r.x * offB, yB, p.z + r.z * offB], k * 6);
      uv.set(alongU ? [v, 0, v, 1] : [0, v, 1, v], k * 4);
      if (k < n - 1) {
        const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }

  private build() {
    const hw = this.halfWidth;
    const road = new THREE.MeshStandardMaterial({
      map: T.asphaltTexture(), roughness: 0.82, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.group.add(this.ribbon(-hw, hw, 0.02, 0.02, 14, road));

    const curbMat = new THREE.MeshStandardMaterial({
      map: T.curbTexture(), roughness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const cw = this.curbWidth;
    this.group.add(this.ribbon(-hw - cw, -hw, 0.06, 0.03, 6, curbMat));
    this.group.add(this.ribbon(hw, hw + cw, 0.03, 0.06, 6, curbMat));

    // sand shoulder
    const sand = new THREE.MeshStandardMaterial({
      color: this.def.theme.shoulder, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.group.add(this.ribbon(-this.wallOffset, -hw - cw, 0.015, 0.015, 10, sand));
    this.group.add(this.ribbon(hw + cw, this.wallOffset, 0.015, 0.015, 10, sand));

    // barrier walls
    const barrierTex = T.barrierTexture(this.def.theme.barrier);
    const wallMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.5, side: THREE.DoubleSide });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xe8e8ee, roughness: 0.4 });
    const H = 1.1, W = this.wallOffset, TH = 0.7;
    for (const sgn of [-1, 1]) {
      const inner = this.ribbon(sgn * W, sgn * W, 0, H, 16, wallMat, true);
      inner.castShadow = true;
      this.group.add(inner);
      this.group.add(this.ribbon(sgn * (W + TH), sgn * (W + TH), 0, H, 16, wallMat, true));
      this.group.add(this.ribbon(sgn * W, sgn * (W + TH), H, H, 16, topMat));
    }

    // start/finish checker
    const checker = T.checkerTexture();
    checker.repeat.set(3, 1);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 3),
      new THREE.MeshStandardMaterial({
        map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }),
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = this.yawAt(0);
    line.position.copy(this.pts[0]).setY(0.04);
    line.receiveShadow = true;
    this.group.add(line);

    // boost pads
    const padMat = new THREE.MeshStandardMaterial({
      map: T.boostPadTexture(), emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.3,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    padMat.emissiveMap = padMat.map;
    for (const pad of this.boostPads) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pad.halfW * 2, pad.halfLen * 2), padMat);
      m.rotation.order = 'YXZ';
      m.rotation.y = this.yawAt(pad.index) + Math.PI;
      m.rotation.x = -Math.PI / 2;
      this.pointAt(pad.index, pad.lateral, m.position).setY(0.05);
      this.group.add(m);
    }
  }
}
