import * as THREE from 'three';
import { KartModel, KartColors } from './kartModel';
import { Track } from './track';

export interface KartInput {
  throttle: number;
  brake: number;
  steer: number; // +1 = left
  drift: boolean;
  nitro: boolean;
}

export type KartEvent =
  | 'nitro' | 'mini1' | 'mini2' | 'pad' | 'start' | 'hit' | 'gain' | 'driftStart'
  | 'spin' | 'bubble' | 'block' | 'item';

export type ItemType = 'missile' | 'water' | 'banana' | 'shield' | 'nitro';
export type StunKind = 'spin' | 'bubble';

export const MAX_SPEED = 36;

/** Compact kart state streamed over the network (short keys keep packets small). */
export interface NetKartState {
  id: string;
  x: number; z: number;
  y: number; // yaw
  m: number; // move angle
  v: number; // speed
  d: number; // drift dir (0 = not drifting)
  dt: number; // drift time
  bk: string; bt: number; // boost kind / time
  sk: string; st: number; // stun kind / time
  sh: number; // shield time
  l: number; s: number; i: number; la: number; // lap, s, index, lateral
  se: number; // steer
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Kart {
  readonly model: KartModel;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  moveAngle = 0;
  speed = 0;
  speedMul = 1;

  drifting = false;
  driftDir = 0;
  driftTime = 0;
  slip = 0;
  gauge = 0;
  nitros = 0;
  boostTime = 0;
  boostExtra = 0;
  boostKind: KartEvent | '' = '';

  index = 0;
  s = 0;
  lap = 0;
  lateral = 0;
  finished = false;
  finishTime = 0;
  wrongWay = false;
  lastSteer = 0;
  controlLock = false;

  /** item mode: drift gauge is off, nitro comes from item boxes */
  itemMode = false;
  items: ItemType[] = [];
  shieldTime = 0;
  stunKind: StunKind | '' = '';
  stunTime = 0;
  private spinVis = 0;

  private prevNitro = false;
  private hop = 0;
  private hopV = 0;
  private visRoll = 0;
  private visPitch = 0;
  private t = 0;
  private listeners: ((e: KartEvent, k: Kart, v: number) => void)[] = [];

  constructor(readonly name: string, colors: KartColors, number: number, readonly isPlayer = false) {
    this.model = new KartModel(colors, number);
  }

  on(fn: (e: KartEvent, k: Kart, v: number) => void) {
    this.listeners.push(fn);
  }

  private emit(e: KartEvent, v = 0) {
    for (const l of this.listeners) l(e, this, v);
  }

  get driftTier(): number {
    if (!this.drifting) return 0;
    return this.driftTime > 1.5 ? 2 : this.driftTime > 0.7 ? 1 : 0;
  }

  get boosting(): boolean {
    return this.boostTime > 0;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  place(track: Track, index: number, lateral: number) {
    track.pointAt(index, lateral, this.pos);
    this.yaw = this.moveAngle = track.yawAt(index);
    this.speed = 0;
    const p = track.project(this.pos, index);
    this.index = p.index;
    this.s = p.s;
    this.lateral = p.lateral;
    this.lap = 0;
    this.drifting = false;
    this.boostTime = 0;
    this.gauge = 0;
    this.nitros = 0;
    this.finished = false;
    this.items = [];
    this.shieldTime = 0;
    this.stunTime = 0;
    this.stunKind = '';
    this.spinVis = 0;
    this.syncModel(0);
  }

  applyBoost(time: number, extra: number, kind: KartEvent) {
    this.boostTime = Math.max(this.boostTime, time);
    this.boostExtra = Math.max(this.boostTime > time ? this.boostExtra : 0, extra);
    this.boostKind = kind;
    this.emit(kind, extra);
  }

  addNitro() {
    if (this.nitros < 2) {
      this.nitros++;
      this.emit('gain');
    }
  }

  get stunned(): boolean {
    return this.stunTime > 0;
  }

  /** Returns false if the hit was blocked by a shield. */
  hit(kind: StunKind): boolean {
    if (this.shieldTime > 0) {
      this.shieldTime = 0;
      this.emit('block');
      return false;
    }
    if (this.stunTime > 0) return false;
    this.stunKind = kind;
    this.stunTime = kind === 'spin' ? 1.3 : 1.9;
    this.drifting = false;
    this.boostTime = 0;
    this.boostExtra = 0;
    this.boostKind = '';
    this.speed *= kind === 'spin' ? 0.3 : 0;
    this.emit(kind);
    return true;
  }

  giveItem(it: ItemType): boolean {
    if (this.items.length >= 2) return false;
    this.items.push(it);
    this.emit('item');
    return true;
  }

  private endDrift() {
    if (!this.drifting) return;
    const tier = this.driftTier;
    this.drifting = false;
    if (tier === 2) this.applyBoost(1.0, 9, 'mini2');
    else if (tier === 1) this.applyBoost(0.55, 6, 'mini1');
  }

  update(dt: number, inp: KartInput, track: Track) {
    this.t += dt;
    if (this.controlLock || this.stunTime > 0) inp = { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false };
    if (this.shieldTime > 0) this.shieldTime = Math.max(0, this.shieldTime - dt);
    if (this.stunTime > 0) {
      this.stunTime -= dt;
      if (this.stunKind === 'spin') this.spinVis += dt * 14 * Math.max(0.2, this.stunTime);
      if (this.stunTime <= 0) {
        this.stunTime = 0;
        this.stunKind = '';
        this.spinVis = 0;
      }
    }

    // nitro (speed mode; in item mode nitro is an item handled by the game)
    if (!this.itemMode && inp.nitro && !this.prevNitro && this.nitros > 0) {
      this.nitros--;
      this.applyBoost(2.4, 16, 'nitro');
    }
    this.prevNitro = inp.nitro;

    if (this.boostTime > 0) {
      this.boostTime -= dt;
      if (this.boostTime <= 0) { this.boostTime = 0; this.boostExtra = 0; this.boostKind = ''; }
    }

    const base = MAX_SPEED * this.speedMul;
    const maxSp = base + (this.boostTime > 0 ? this.boostExtra : 0);
    const prevSpeed = this.speed;

    // longitudinal
    if (this.boostTime > 0 && this.speed < maxSp && inp.brake === 0) {
      this.speed = Math.min(maxSp, this.speed + 55 * dt);
    } else if (inp.throttle > 0) {
      if (this.speed < 0) this.speed += 40 * dt;
      else if (this.speed < maxSp) {
        const a = 26 * (1 - 0.7 * (this.speed / maxSp)) * inp.throttle;
        this.speed = Math.min(maxSp, this.speed + a * dt);
      }
    } else if (inp.brake > 0) {
      if (this.speed > 0) this.speed = Math.max(0, this.speed - 38 * dt);
      else this.speed = Math.max(-11, this.speed - 16 * dt);
    } else {
      const drag = (3 + Math.abs(this.speed) * 0.22) * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    if (this.speed > maxSp) this.speed -= (this.speed - maxSp) * Math.min(1, 1.6 * dt);

    // drift state
    const steer = inp.steer;
    this.lastSteer = steer;
    if (inp.drift && !this.drifting && Math.abs(steer) > 0.2 && this.speed > 12) {
      this.drifting = true;
      this.driftDir = Math.sign(steer);
      this.driftTime = 0;
      this.hopV = 3.2;
      this.emit('driftStart');
    }
    if (this.drifting && (!inp.drift || this.speed < 8)) this.endDrift();

    // lateral / steering
    const speedFactor = Math.min(1, Math.abs(this.speed) / 8);
    if (this.drifting) {
      const yawRate = this.driftDir * (1.05 + 0.65 * steer * this.driftDir);
      this.yaw += yawRate * dt;
      const k = 1 - Math.exp(-1.7 * dt);
      this.moveAngle += angleDiff(this.yaw, this.moveAngle) * k;
      let slip = angleDiff(this.yaw, this.moveAngle);
      const maxSlip = 0.85;
      if (Math.abs(slip) > maxSlip) {
        this.moveAngle = this.yaw - Math.sign(slip) * maxSlip;
        slip = Math.sign(slip) * maxSlip;
      }
      this.slip = slip;
      this.speed -= Math.abs(slip) * 3.2 * dt;
      this.driftTime += dt;
      const g = Math.abs(slip) * Math.max(0, this.speed / MAX_SPEED) * dt * 0.62;
      if (!this.itemMode) this.gauge += g;
      if (this.gauge >= 1) {
        if (this.nitros < 2) { this.gauge -= 1; this.addNitro(); }
        else this.gauge = 1;
      }
    } else {
      const dir = this.speed < 0 ? -1 : 1;
      const turn = steer * 2.15 * speedFactor * (1 - 0.3 * Math.min(1, this.speed / MAX_SPEED)) * dir;
      this.yaw += turn * dt;
      const k = 1 - Math.exp(-9 * dt);
      this.moveAngle += angleDiff(this.yaw, this.moveAngle) * k;
      this.slip = angleDiff(this.yaw, this.moveAngle);
    }

    // integrate
    this.pos.x += Math.sin(this.moveAngle) * this.speed * dt;
    this.pos.z += Math.cos(this.moveAngle) * this.speed * dt;

    // track projection & walls
    let p = track.project(this.pos, this.index);
    const limit = track.wallOffset - 1.05;
    if (Math.abs(p.lateral) > limit) {
      const sgn = Math.sign(p.lateral);
      const r = track.right[p.index];
      const over = Math.abs(p.lateral) - limit;
      this.pos.x -= r.x * over * sgn;
      this.pos.z -= r.z * over * sgn;
      const nx = -r.x * sgn, nz = -r.z * sgn; // inward normal
      const dx = Math.sin(this.moveAngle) * Math.sign(this.speed || 1);
      const dz = Math.cos(this.moveAngle) * Math.sign(this.speed || 1);
      const into = -(dx * nx + dz * nz);
      if (into > 0) {
        const impact = into;
        const hitSpeed = Math.abs(this.speed) * impact;
        this.speed *= 1 - 0.6 * impact;
        const sx = dx + nx * into * 1.05, sz = dz + nz * into * 1.05;
        let na = Math.atan2(sx, sz);
        if (this.speed < 0) na += Math.PI;
        this.moveAngle = na;
        this.yaw += angleDiff(na, this.yaw) * 0.35 * impact;
        if (this.drifting && impact > 0.45) this.drifting = false;
        if (hitSpeed > 4) this.emit('hit', hitSpeed);
      }
      p = track.project(this.pos, p.index);
    }

    const ds = p.s - this.s;
    if (ds < -track.length / 2) this.lap++;
    else if (ds > track.length / 2) this.lap--;
    this.s = p.s;
    this.index = p.index;
    this.lateral = p.lateral;

    // boost pads
    for (const pad of track.boostPads) {
      let di = Math.abs(this.index - pad.index);
      di = Math.min(di, track.N - di) * track.step;
      if (di < pad.halfLen && Math.abs(this.lateral - pad.lateral) < pad.halfW + 0.7) {
        if (!(this.boostKind === 'pad' && this.boostTime > 0.9)) this.applyBoost(1.2, 12, 'pad');
      }
    }

    const t = track.tan[this.index];
    const fwdDot = Math.sin(this.yaw) * t.x + Math.cos(this.yaw) * t.z;
    this.wrongWay = fwdDot < -0.3 && Math.abs(this.speed) > 3;

    this.syncModel(dt, (this.speed - prevSpeed) / Math.max(dt, 1e-4), steer);
  }

  get progress(): number {
    return this.lap * 1e5 + this.s;
  }

  syncModel(dt: number, accel = 0, steer = 0) {
    // hop physics
    this.hopV -= 22 * dt;
    this.hop = Math.max(0, this.hop + this.hopV * dt);
    if (this.hop === 0) this.hopV = Math.max(this.hopV, 0);

    const m = this.model.root;
    const bubble = this.stunKind === 'bubble';
    const float = bubble ? Math.min(1.4, (1.9 - this.stunTime) * 4) * Math.min(1, this.stunTime * 3) + Math.sin(this.t * 3) * 0.15 : 0;
    m.position.set(this.pos.x, this.hop + Math.max(0, float), this.pos.z);
    m.rotation.y = this.yaw + this.spinVis + (bubble ? Math.sin(this.t * 1.7) * 0.4 : 0);
    this.model.setShield(this.shieldTime > 0, this.t);
    this.model.setBubble(bubble, this.t);
    const sn = Math.min(1, Math.abs(this.speed) / MAX_SPEED);
    const targetRoll = this.drifting ? this.driftDir * 0.11 : steer * 0.06 * sn;
    const targetPitch = THREE.MathUtils.clamp(-accel * 0.004, -0.06, 0.05);
    const k = 1 - Math.exp(-8 * dt);
    this.visRoll += (targetRoll - this.visRoll) * k;
    this.visPitch += (targetPitch - this.visPitch) * k;
    const steerVis = this.drifting ? -this.driftDir * 0.7 : steer;
    const boostAmt = this.boostTime > 0 ? (this.boostKind === 'nitro' ? 1 : 0.55) : 0;
    this.model.update(dt, this.speed, steerVis, this.visRoll, this.visPitch, boostAmt, this.t);
  }

  // ------------------------------------------------------------------ network
  private netState: NetKartState | null = null;
  private netAt = 0;

  toNet(id: string): NetKartState {
    return {
      id, x: r2(this.pos.x), z: r2(this.pos.z), y: r3(this.yaw), m: r3(this.moveAngle), v: r2(this.speed),
      d: this.drifting ? this.driftDir : 0, dt: r2(this.driftTime),
      bk: this.boostKind, bt: r2(this.boostTime), sk: this.stunKind, st: r2(this.stunTime), sh: r2(this.shieldTime),
      l: this.lap, s: r2(this.s), i: this.index, la: r2(this.lateral), se: r2(this.lastSteer),
    };
  }

  setNet(st: NetKartState) {
    const first = !this.netState;
    this.netState = st;
    this.netAt = performance.now();
    if (first) {
      this.pos.set(st.x, 0, st.z);
      this.yaw = st.y;
      this.moveAngle = st.m;
    }
  }

  /** Drive a remote kart from its latest network state, with dead-reckoning + smoothing. */
  applyRemote(dt: number) {
    this.t += dt;
    const st = this.netState;
    if (!st) { this.syncModel(dt); return; }
    const age = Math.min(0.3, (performance.now() - this.netAt) / 1000);
    const px = st.x + Math.sin(st.m) * st.v * age;
    const pz = st.z + Math.cos(st.m) * st.v * age;
    const dx = px - this.pos.x, dz = pz - this.pos.z;
    if (dx * dx + dz * dz > 12 * 12) this.pos.set(px, 0, pz);
    else {
      const k = 1 - Math.exp(-14 * dt);
      this.pos.x += dx * k;
      this.pos.z += dz * k;
    }
    const ka = 1 - Math.exp(-18 * dt);
    this.yaw += angleDiff(st.y, this.yaw) * ka;
    this.moveAngle += angleDiff(st.m, this.moveAngle) * ka;
    this.speed = st.v;

    const wasDrifting = this.drifting;
    this.drifting = st.d !== 0;
    this.driftDir = st.d;
    this.driftTime = st.dt + (this.drifting ? age : 0);
    if (this.drifting && !wasDrifting) this.hopV = 3.2;

    if (st.bk !== this.boostKind && st.bk === 'nitro') this.emit('nitro');
    this.boostKind = st.bk as KartEvent | '';
    this.boostTime = Math.max(0, st.bt - age);
    this.boostExtra = st.bk ? 10 : 0;

    if (st.sk && !this.stunKind) this.emit(st.sk as StunKind);
    this.stunKind = st.sk as StunKind | '';
    this.stunTime = Math.max(0, st.st - age);
    if (this.stunKind === 'spin') this.spinVis += dt * 14 * Math.max(0.2, this.stunTime);
    else this.spinVis = 0;
    this.shieldTime = st.sh;

    this.lap = st.l;
    this.s = st.s;
    this.index = st.i;
    this.lateral = st.la;
    this.lastSteer = st.se;
    this.wrongWay = false;
    this.syncModel(dt, 0, st.se);
  }

  worldPoint(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.model.body.matrixWorld);
  }
}
