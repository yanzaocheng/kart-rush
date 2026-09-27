import * as THREE from 'three';
import { Kart } from './kart';
import { Track } from './track';
import { Particles } from './particles';

export type WeaponFx = 'launch' | 'explode' | 'throw' | 'splash' | 'drop' | 'slip';

interface Missile { id: string; mesh: THREE.Group; pos: THREE.Vector3; dir: THREE.Vector3; owner: Kart; target: Kart | null; life: number; index: number }
interface Bomb { id: string; mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; owner: Kart; index: number }
interface Zone { id: string; mesh: THREE.Mesh; pos: THREE.Vector3; owner: Kart; life: number; r: number }
interface Banana { id: string; mesh: THREE.Group; pos: THREE.Vector3; owner: Kart; life: number; age: number }

const MISSILE_SPEED = 72;
const ZONE_LIFE = 4;

export class Weapons {
  readonly group = new THREE.Group();
  private missiles: Missile[] = [];
  private bombs: Bomb[] = [];
  private zones: Zone[] = [];
  private bananas: Banana[] = [];
  private missileProto: THREE.Group;
  private bananaProto: THREE.Group;
  private bombGeo = new THREE.SphereGeometry(0.7, 24, 16);
  private bombMat = new THREE.MeshPhysicalMaterial({
    color: 0x3fa9ff, emissive: 0x1a6dff, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, roughness: 0.05, clearcoat: 1,
  });
  private zoneGeo = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  private tmp = new THREE.Vector3();
  private seq = 0;
  /** Online: only karts simulated on this machine can be hit here; remote victims report their own hits. */
  canHit: (k: Kart) => boolean = () => true;
  /** Called when a local kart was hit by weapon `id` (before the weapon is removed). */
  onHit: ((id: string, k: Kart) => void) | null = null;

  newId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  constructor(
    private track: Track,
    private sparks: Particles,
    private smoke: Particles,
    private onFx: (fx: WeaponFx, pos: THREE.Vector3) => void,
  ) {
    // missile: built along +z
    const m = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.4, roughness: 0.3 });
    const red = new THREE.MeshStandardMaterial({ color: 0xe8322b, metalness: 0.3, roughness: 0.35 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 16), white);
    body.rotation.x = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 16), red);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.95;
    m.add(body, nose);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.4), red);
      const a = (i / 4) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.25, Math.sin(a) * 0.25, -0.55);
      fin.rotation.z = a;
      m.add(fin);
    }
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2, 0.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    glow.position.z = -0.8;
    glow.scale.z = 1.8;
    m.add(glow);
    m.traverse((o) => { o.castShadow = true; });
    glow.castShadow = false;
    this.missileProto = m;

    // banana
    const b = new THREE.Group();
    const peel = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.17, 10, 16, Math.PI * 1.1),
      new THREE.MeshStandardMaterial({ color: 0xffd52e, roughness: 0.5, emissive: 0x332200 }),
    );
    peel.rotation.x = Math.PI / 2;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4a3316 }));
    tip.position.set(0.45, 0, 0);
    b.add(peel, tip);
    b.traverse((o) => { o.castShadow = true; });
    this.bananaProto = b;
  }

  get targets(): Set<Kart> {
    return new Set(this.missiles.map((m) => m.target).filter((t): t is Kart => !!t));
  }

  clear() {
    for (const o of [...this.missiles, ...this.bombs, ...this.zones, ...this.bananas]) this.group.remove(o.mesh);
    this.missiles = [];
    this.bombs = [];
    this.zones = [];
    this.bananas = [];
  }

  fireMissile(owner: Kart, target: Kart | null, id = this.newId('m'), from?: { pos: THREE.Vector3; dir: THREE.Vector3 }) {
    const mesh = this.missileProto.clone();
    const dir = from ? from.dir.clone() : owner.forward;
    const pos = from ? from.pos.clone() : owner.pos.clone().addScaledVector(dir, 2).setY(0.9);
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.missiles.push({ id, mesh, pos, dir, owner, target, life: 7, index: owner.index });
    this.onFx('launch', pos);
    return { id, pos: pos.clone(), dir: dir.clone() };
  }

  throwWater(owner: Kart, id = this.newId('w'), from?: { pos: THREE.Vector3; vel: THREE.Vector3 }) {
    const mesh = new THREE.Mesh(this.bombGeo, this.bombMat);
    const f = owner.forward;
    const pos = from ? from.pos.clone() : owner.pos.clone().addScaledVector(f, 1.5).setY(1.6);
    const vel = from ? from.vel.clone() : f.multiplyScalar(Math.max(0, owner.speed) + 28).setY(9);
    const sent = { id, pos: pos.clone(), vel: vel.clone() };
    mesh.position.copy(pos);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.bombs.push({ id, mesh, pos, vel, owner, index: owner.index });
    this.onFx('throw', pos);
    return sent;
  }

  dropBanana(owner: Kart, id = this.newId('b'), at?: THREE.Vector3) {
    const mesh = this.bananaProto.clone();
    const pos = at ? at.clone() : owner.pos.clone().addScaledVector(owner.forward, -2.6).setY(0.2);
    mesh.position.copy(pos);
    mesh.rotation.y = Math.random() * 6;
    this.group.add(mesh);
    this.bananas.push({ id, mesh, pos, owner, life: 40, age: 0 });
    this.onFx('drop', pos);
    return { id, pos: pos.clone() };
  }

  /** Remove a weapon by id (e.g. a remote client reported that it hit someone). */
  remove(id: string) {
    const mi = this.missiles.findIndex((m) => m.id === id);
    if (mi >= 0) {
      const m = this.missiles[mi];
      this.explode(m.pos.clone());
      this.group.remove(m.mesh);
      this.missiles.splice(mi, 1);
    }
    const bi = this.bananas.findIndex((b) => b.id === id);
    if (bi >= 0) {
      this.onFx('slip', this.bananas[bi].pos);
      this.group.remove(this.bananas[bi].mesh);
      this.bananas.splice(bi, 1);
    }
  }

  private clampToTrack(pos: THREE.Vector3, hint: number, margin: number): number {
    const p = this.track.project(pos, hint, 40);
    const lim = this.track.wallOffset - margin;
    if (Math.abs(p.lateral) > lim) {
      const r = this.track.right[p.index];
      const over = Math.abs(p.lateral) - lim;
      pos.x -= r.x * over * Math.sign(p.lateral);
      pos.z -= r.z * over * Math.sign(p.lateral);
    }
    return p.index;
  }

  private explode(pos: THREE.Vector3) {
    const c1 = new THREE.Color(4, 2, 0.5), c2 = new THREE.Color(0.35, 0.33, 0.32);
    const v = new THREE.Vector3();
    for (let i = 0; i < 50; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 12);
      this.sparks.spawn(pos, v, c1, 1, { size: 0.5 + Math.random() * 0.5, life: 0.35 + Math.random() * 0.3, drag: 3, gravity: 6 });
    }
    for (let i = 0; i < 14; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.6 + 0.3, Math.random() - 0.5).multiplyScalar(5);
      this.smoke.spawn(pos, v, c2, 0.5, { size: 2, life: 1.2, grow: 1.5, drag: 2 });
    }
    this.onFx('explode', pos);
  }

  private splash(pos: THREE.Vector3) {
    const c = new THREE.Color(0.5, 1.2, 2.5);
    const v = new THREE.Vector3();
    for (let i = 0; i < 60; i++) {
      v.set(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 8);
      this.sparks.spawn(pos, v, c, 0.9, { size: 0.35 + Math.random() * 0.3, life: 0.7, gravity: 22, drag: 0.5 });
    }
    this.onFx('splash', pos);
  }

  update(dt: number, karts: Kart[], t: number) {
    const st = this.track.step;
    const trailCol = new THREE.Color(0.9, 0.9, 0.9);

    // missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      m.index = this.clampToTrack(m.pos, m.index, 1.2);
      const p = this.track.project(m.pos, m.index, 10);
      let desired: THREE.Vector3;
      if (m.target && !m.target.finished && m.target.pos.distanceTo(m.pos) < 40) {
        desired = this.tmp.copy(m.target.pos).setY(0.9);
      } else {
        const lat = m.target ? THREE.MathUtils.lerp(p.lateral, m.target.lateral, 0.3) : p.lateral * 0.9;
        desired = this.track.pointAt(m.index + Math.round(14 / st), lat, this.tmp).setY(0.9);
      }
      const want = desired.sub(m.pos).normalize();
      m.dir.lerp(want, 1 - Math.exp(-9 * dt)).normalize();
      m.pos.addScaledVector(m.dir, MISSILE_SPEED * dt);
      m.pos.y = 0.9;
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(this.tmp.copy(m.pos).add(m.dir));
      m.mesh.rotateZ(t * 12);
      // trail
      const back = this.tmp.copy(m.pos).addScaledVector(m.dir, -0.9);
      this.smoke.spawn(back, new THREE.Vector3(0, 0.6, 0), trailCol, 0.3, { size: 0.6, life: 0.6, grow: 2, drag: 1 });

      let hit: Kart | null = null;
      let reached = false; // touched a remote kart: explode visually, its owner applies the hit
      for (const k of karts) {
        if (k === m.owner || k.finished) continue;
        if (k.pos.distanceToSquared(m.pos) < (k === m.target ? 2.2 * 2.2 : 1.6 * 1.6)) {
          if (this.canHit(k)) hit = k;
          else reached = true;
          break;
        }
      }
      if (hit || reached || m.life <= 0) {
        if (hit) {
          this.onHit?.(m.id, hit);
          hit.hit('spin');
        }
        this.explode(m.pos.clone());
        this.group.remove(m.mesh);
        this.missiles.splice(i, 1);
      }
    }

    // water bombs in flight
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.vel.y -= 20 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.index = this.clampToTrack(b.pos, b.index, 3);
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += dt * 6;
      if (b.pos.y <= 0.6 && b.vel.y < 0) {
        const zmesh = new THREE.Mesh(this.zoneGeo, new THREE.MeshPhysicalMaterial({
          color: 0x49b6ff, emissive: 0x1a6dff, emissiveIntensity: 0.4, transparent: true, opacity: 0.5,
          roughness: 0.02, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
        }));
        const pos = b.pos.clone().setY(0);
        zmesh.position.copy(pos);
        this.group.add(zmesh);
        this.zones.push({ id: b.id, mesh: zmesh, pos, owner: b.owner, life: ZONE_LIFE, r: 5 });
        this.splash(pos.clone().setY(0.5));
        this.group.remove(b.mesh);
        this.bombs.splice(i, 1);
      }
    }

    // water zones
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.life -= dt;
      const grow = Math.min(1, (ZONE_LIFE - z.life) * 5);
      const shrink = Math.min(1, z.life * 3);
      const s = z.r * grow * shrink;
      z.mesh.scale.set(s * (1 + Math.sin(t * 6) * 0.04), s * 0.55 * (1 + Math.cos(t * 5) * 0.06), s);
      for (const k of karts) {
        if (k === z.owner || k.finished || k.stunned || !this.canHit(k)) continue;
        const dx = k.pos.x - z.pos.x, dz = k.pos.z - z.pos.z;
        if (dx * dx + dz * dz < (z.r + 0.6) ** 2) {
          this.onHit?.(z.id, k);
          k.hit('bubble');
        }
      }
      if (z.life <= 0) {
        this.group.remove(z.mesh);
        (z.mesh.material as THREE.Material).dispose();
        this.zones.splice(i, 1);
      }
    }

    // bananas
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i];
      b.life -= dt;
      b.age += dt;
      let hit = false;
      for (const k of karts) {
        if (k.finished || k.stunned || !this.canHit(k)) continue;
        if (k === b.owner && b.age < 1) continue;
        const dx = k.pos.x - b.pos.x, dz = k.pos.z - b.pos.z;
        if (dx * dx + dz * dz < 1.5 * 1.5) {
          this.onHit?.(b.id, k);
          k.hit('spin');
          this.onFx('slip', b.pos);
          hit = true;
          break;
        }
      }
      if (hit || b.life <= 0) {
        this.group.remove(b.mesh);
        this.bananas.splice(i, 1);
      }
    }
  }
}
