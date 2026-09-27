import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { numberTexture } from './textures';

export interface KartColors {
  body: number;
  accent: number;
  suit: number;
}

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/** Procedural kart. Local forward is +z, origin on the ground. */
export class KartModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group(); // leans/rolls
  readonly wheels: THREE.Group[] = [];
  readonly frontPivots: THREE.Group[] = [];
  readonly exhausts: THREE.Vector3[] = [new THREE.Vector3(-0.32, 0.5, -1.25), new THREE.Vector3(0.32, 0.5, -1.25)];
  readonly rearWheelsLocal = [new THREE.Vector3(-0.78, 0.05, -0.75), new THREE.Vector3(0.78, 0.05, -0.75)];
  private head: THREE.Group;
  private flameMat: THREE.MeshBasicMaterial;
  private flames: THREE.Mesh[] = [];

  constructor(colors: KartColors, number: number) {
    const paint = new THREE.MeshPhysicalMaterial({
      color: colors.body, metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
    });
    const accent = new THREE.MeshPhysicalMaterial({
      color: colors.accent, metalness: 0.3, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1,
    });
    const carbon = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.4, roughness: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.15 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
    const rim = new THREE.MeshStandardMaterial({ color: colors.accent, metalness: 0.8, roughness: 0.25 });
    const suit = new THREE.MeshStandardMaterial({ color: colors.suit, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.8 });

    this.root.add(this.body);

    // chassis floor
    const floor = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.14, 2.5, 3, 0.06), carbon);
    floor.position.set(0, 0.26, 0);
    this.body.add(floor);

    // main shell
    const shell = new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.42, 1.7, 5, 0.18), paint);
    shell.position.set(0, 0.5, 0.1);
    this.body.add(shell);

    // nose cone
    const nose = new THREE.Mesh(new RoundedBoxGeometry(1.35, 0.3, 0.75, 5, 0.14), paint);
    nose.position.set(0, 0.42, 1.18);
    nose.rotation.x = 0.12;
    this.body.add(nose);
    const bumper = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.16, 0.26, 3, 0.07), accent);
    bumper.position.set(0, 0.3, 1.5);
    this.body.add(bumper);

    // side pods
    for (const s of [-1, 1]) {
      const pod = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.3, 1.1, 4, 0.12), accent);
      pod.position.set(s * 0.72, 0.42, -0.05);
      this.body.add(pod);
      const plate = new THREE.Mesh(
        new THREE.CircleGeometry(0.16, 24),
        new THREE.MeshStandardMaterial({ map: numberTexture(number, '#' + colors.body.toString(16).padStart(6, '0')), roughness: 0.5 }),
      );
      plate.position.set(s * 0.895, 0.44, -0.05);
      plate.rotation.y = (s * Math.PI) / 2;
      this.body.add(plate);
    }

    // seat
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.62, 0.22, 3, 0.08), carbon);
    seat.position.set(0, 0.85, -0.52);
    seat.rotation.x = -0.25;
    this.body.add(seat);

    // engine block + exhausts
    const engine = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.35, 0.45, 3, 0.08), carbon);
    engine.position.set(0, 0.52, -0.95);
    this.body.add(engine);
    const pipeGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.45, 14, 1, true);
    for (const e of this.exhausts) {
      const pipe = new THREE.Mesh(pipeGeo, chrome);
      pipe.rotation.x = Math.PI / 2 + 0.25;
      pipe.position.copy(e).add(new THREE.Vector3(0, -0.04, 0.18));
      this.body.add(pipe);
    }

    // spoiler
    const wing = new THREE.Mesh(new RoundedBoxGeometry(1.55, 0.06, 0.38, 2, 0.03), accent);
    wing.position.set(0, 1.02, -1.18);
    wing.rotation.x = -0.12;
    this.body.add(wing);
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.18), carbon);
      post.position.set(s * 0.45, 0.8, -1.15);
      this.body.add(post);
      const fin = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.26, 0.46, 2, 0.02), paint);
      fin.position.set(s * 0.78, 1.06, -1.18);
      this.body.add(fin);
    }

    // steering wheel
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 8, 20), carbon);
    sw.position.set(0, 0.95, 0.18);
    sw.rotation.x = -0.9;
    this.body.add(sw);

    // driver
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.34, 6, 14), suit);
    torso.position.set(0, 1.02, -0.3);
    torso.rotation.x = -0.25;
    this.body.add(torso);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.42, 4, 8), suit);
      arm.position.set(s * 0.27, 1.02, -0.02);
      arm.rotation.x = 1.15;
      arm.rotation.z = -s * 0.25;
      this.body.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), skin);
      hand.position.set(s * 0.16, 0.95, 0.2);
      this.body.add(hand);
    }
    this.head = new THREE.Group();
    this.head.position.set(0, 1.5, -0.3);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 28, 20), paint);
    helmet.scale.set(1, 1.02, 1.08);
    this.head.add(helmet);
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 36, Math.PI), accent);
    stripe.rotation.y = Math.PI / 2;
    stripe.scale.set(1.03, 1.03, 1.08);
    this.head.add(stripe);
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.29, 24, 12, -Math.PI * 0.38, Math.PI * 0.76, Math.PI * 0.32, Math.PI * 0.3),
      new THREE.MeshPhysicalMaterial({ color: 0x0a1020, metalness: 0.9, roughness: 0.05, clearcoat: 1 }),
    );
    visor.scale.set(1.05, 1.05, 1.13);
    visor.position.z = 0.015;
    this.head.add(visor);
    this.body.add(this.head);

    // wheels
    const tireGeo = new THREE.CylinderGeometry(1, 1, 1, 28);
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.04, 6);
    rimGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.1, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const wheelDefs = [
      { x: -0.8, z: 0.95, r: 0.3, w: 0.3, front: true },
      { x: 0.8, z: 0.95, r: 0.3, w: 0.3, front: true },
      { x: -0.8, z: -0.75, r: 0.36, w: 0.42, front: false },
      { x: 0.8, z: -0.75, r: 0.36, w: 0.42, front: false },
    ];
    for (const d of wheelDefs) {
      const pivot = new THREE.Group();
      pivot.position.set(d.x, d.r, d.z);
      const wheel = new THREE.Group();
      const t = new THREE.Mesh(tireGeo, tire);
      t.scale.set(d.w, d.r, d.r);
      const r = new THREE.Mesh(rimGeo, rim);
      r.scale.set(d.w, d.r, d.r);
      const h = new THREE.Mesh(hubGeo, chrome);
      h.scale.set(d.w, d.r, d.r);
      wheel.add(t, r, h);
      pivot.add(wheel);
      this.root.add(pivot);
      this.wheels.push(wheel);
      if (d.front) this.frontPivots.push(pivot);
    }
    // front axle bar
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), carbon);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.3, 0.95);
    this.body.add(axle);

    // boost flames (hidden unless boosting)
    this.flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3, 1.4, 0.4), transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flameGeo = new THREE.ConeGeometry(0.11, 0.7, 12, 1, true);
    flameGeo.translate(0, 0.35, 0);
    flameGeo.rotateX(-Math.PI / 2);
    flameGeo.rotateX(0.25);
    for (const e of this.exhausts) {
      const f = new THREE.Mesh(flameGeo, this.flameMat);
      f.position.copy(e);
      f.visible = false;
      this.body.add(f);
      this.flames.push(f);
    }

    shadowed(this.root);
    for (const f of this.flames) f.castShadow = false;

    const sphere = new THREE.SphereGeometry(1.9, 32, 20);
    this.shield = new THREE.Mesh(sphere, new THREE.MeshPhysicalMaterial({
      color: 0x7fe3ff, emissive: 0x2aa8ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.28,
      roughness: 0.05, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.shield.position.y = 0.8;
    this.shield.visible = false;
    this.root.add(this.shield);
    this.bubble = new THREE.Mesh(sphere, new THREE.MeshPhysicalMaterial({
      color: 0x4fb3ff, emissive: 0x1a6dff, emissiveIntensity: 0.35, transparent: true, opacity: 0.45,
      roughness: 0.02, metalness: 0.1, clearcoat: 1, depthWrite: false,
    }));
    this.bubble.position.y = 0.8;
    this.bubble.visible = false;
    this.root.add(this.bubble);
  }

  private shield: THREE.Mesh;
  private bubble: THREE.Mesh;
  private label: THREE.Sprite | null = null;

  /** Floating name tag above the kart (used for other online players). */
  setLabel(text: string | null, color = '#ffffff') {
    if (this.label) {
      this.root.remove(this.label);
      this.label.material.map?.dispose();
      this.label.material.dispose();
      this.label = null;
    }
    if (!text) return;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.font = 'bold 34px "Noto Sans SC", "Microsoft YaHei", sans-serif';
    const w = Math.min(248, ctx.measureText(text).width + 36);
    ctx.fillStyle = 'rgba(10,16,34,0.72)';
    ctx.beginPath();
    ctx.roundRect((256 - w) / 2, 6, w, 52, 26);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc((256 - w) / 2 + 20, 32, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128 + 8, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    sp.scale.set(2.6, 0.65, 1);
    sp.position.y = 2.35;
    sp.renderOrder = 10;
    this.root.add(sp);
    this.label = sp;
  }

  setShield(on: boolean, t: number) {
    this.shield.visible = on;
    if (on) {
      this.shield.rotation.y = t * 2;
      this.shield.scale.setScalar(1 + Math.sin(t * 8) * 0.03);
    }
  }

  setBubble(on: boolean, t: number) {
    this.bubble.visible = on;
    if (on) this.bubble.scale.set(1 + Math.sin(t * 5) * 0.05, 1 + Math.cos(t * 5) * 0.05, 1);
  }

  private wheelSpin = 0;

  update(dt: number, speed: number, steerVisual: number, roll: number, pitch: number, boost: number, t: number) {
    this.wheelSpin += (speed * dt) / 0.33;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontPivots) p.rotation.y = steerVisual * 0.45;
    this.body.rotation.z = roll;
    this.body.rotation.x = pitch;
    this.body.position.y = Math.sin(t * 40) * 0.008 * Math.min(1, Math.abs(speed) / 10);
    this.head.rotation.z = -roll * 1.5;
    this.head.rotation.y = steerVisual * 0.25;
    const on = boost > 0.01;
    for (const f of this.flames) {
      f.visible = on;
      if (on) {
        const s = 0.8 + Math.random() * 0.5;
        f.scale.set(1 + boost * 0.4, 1 + boost * 0.4, s * (0.6 + boost));
      }
    }
    if (on) this.flameMat.color.setRGB(2.2 - boost * 1.6, 0.9 + boost * 0.3, 0.3 + boost * 1.8);
  }
}
