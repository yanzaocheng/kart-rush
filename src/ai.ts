import { Kart, KartInput } from './kart';
import { Track } from './track';

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class AIDriver {
  private offset = 0;
  private offsetTarget = 0;
  private retarget = 0;
  private nitroDelay = 1 + Math.random() * 3;

  constructor(readonly kart: Kart, public skill: number) {}

  /** true when the road ahead is fairly straight (good moment for nitro) */
  onStraight(track: Track): boolean {
    const i0 = this.kart.index, st = track.step;
    const near = angleDiff(track.yawAt(i0 + Math.round(22 / st)), track.yawAt(i0));
    const far = angleDiff(track.yawAt(i0 + Math.round(48 / st)), track.yawAt(i0 + Math.round(10 / st)));
    return Math.abs(near) < 0.2 && Math.abs(far) < 0.25;
  }

  think(dt: number, track: Track, karts: Kart[], rubberBand: number): KartInput {
    const k = this.kart;
    const st = track.step;
    k.speedMul = this.skill + rubberBand;

    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 2 + Math.random() * 3;
      this.offsetTarget = (Math.random() - 0.5) * 8;
    }
    this.offset += (this.offsetTarget - this.offset) * Math.min(1, dt * 0.8);

    // simple avoidance: shift laterally if someone is right ahead
    for (const o of karts) {
      if (o === k) continue;
      let ds = o.s - k.s;
      if (ds < -track.length / 2) ds += track.length;
      if (ds > 0 && ds < 9 && Math.abs(o.lateral - (k.lateral + this.offset * 0.2)) < 2.4) {
        this.offsetTarget = o.lateral > k.lateral ? -6 : 6;
      }
    }

    const i0 = k.index;
    const near = angleDiff(track.yawAt(i0 + Math.round(22 / st)), track.yawAt(i0));
    const far = angleDiff(track.yawAt(i0 + Math.round(48 / st)), track.yawAt(i0 + Math.round(10 / st)));
    const la = 9 + Math.max(0, k.speed) * 0.45;
    const ia = i0 + Math.round(la / st);
    const curveHere = angleDiff(track.yawAt(ia + Math.round(15 / st)), track.yawAt(ia - Math.round(5 / st)));
    const inside = -Math.sign(curveHere) * Math.min(7, Math.abs(curveHere) * 12);
    const lat = Math.max(-9, Math.min(9, inside + this.offset));
    const target = track.pointAt(ia, lat);
    const desired = Math.atan2(target.x - k.pos.x, target.z - k.pos.z);

    const inp: KartInput = { throttle: 1, brake: 0, steer: 0, drift: false, nitro: false };
    const ref = k.drifting ? k.moveAngle : k.yaw;
    const err = angleDiff(desired, ref);
    inp.steer = Math.max(-1, Math.min(1, err * (k.drifting ? 3.2 : 2.6)));

    // drifting
    if (!k.drifting) {
      if (Math.abs(far) > 0.75 && k.speed > 22 && Math.sign(err) === Math.sign(far) && Math.abs(err) > 0.05) {
        inp.drift = true;
        inp.steer = Math.sign(far);
      }
    } else {
      const keep = Math.abs(near) > 0.22 && err * k.driftDir > -0.12 && k.driftTime < 2.6;
      inp.drift = keep;
    }

    // very sharp and fast: lift off a bit
    if (!k.drifting && Math.abs(near) > 1.1 && k.speed > 30) inp.throttle = 0.3;

    // nitro on straights
    if (k.nitros > 0) {
      this.nitroDelay -= dt;
      if (this.nitroDelay <= 0 && Math.abs(far) < 0.25 && Math.abs(near) < 0.2 && !k.boosting) {
        inp.nitro = true;
        this.nitroDelay = 2 + Math.random() * 5;
      }
    }

    // wrong way / stuck recovery
    if (k.wrongWay) {
      inp.steer = Math.sign(angleDiff(track.yawAt(i0), k.yaw)) || 1;
    }
    return inp;
  }
}
