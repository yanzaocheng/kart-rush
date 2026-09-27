import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Track } from './track';
import * as T from './textures';
import { Theme } from './themes';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function createSky(scene: THREE.Scene, sunDir: THREE.Vector3, th: Theme) {
  const geo = new THREE.SphereGeometry(3000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(th.skyTop) },
      mid: { value: new THREE.Color(th.skyMid) },
      horizon: { value: new THREE.Color(th.skyHorizon) },
      sunDir: { value: sunDir.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        c = mix(c, top, smoothstep(0.15, 0.7, h));
        if (h < 0.0) c = horizon;
        float s = max(dot(vDir, sunDir), 0.0);
        c += vec3(1.0, 0.9, 0.7) * pow(s, 350.0) * 6.0;
        c += vec3(1.0, 0.85, 0.6) * pow(s, 12.0) * 0.35;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

export function createGround(scene: THREE.Scene, th: Theme) {
  const tex = th.ground === 'sand' ? T.sandTexture() : T.grassTexture();
  tex.repeat.set(220, 220);
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: 0xffffff }),
  );
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);
}

function distToTrack(track: Track, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < track.N; i += 6) {
    const p = track.pts[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function jitter(geo: THREE.BufferGeometry, amt: number) {
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + rand(-amt, amt), p.getY(i) + rand(-amt, amt) * 0.5, p.getZ(i) + rand(-amt, amt));
  }
  geo.computeVertexNormals();
}

export function createFlora(scene: THREE.Scene, track: Track, th: Theme) {
  if (th.flora === 'desert') createDesertFlora(scene, track);
  else createTrees(scene, track);
}

function scatterSpots(track: Track, count: number, pad: number, nearBias: number) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of track.pts) {
    b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
  }
  const spots: { x: number; z: number; s: number; d: number }[] = [];
  let tries = 0;
  while (spots.length < count && tries < count * 15) {
    tries++;
    const x = rand(b.minX - pad, b.maxX + pad), z = rand(b.minZ - pad, b.maxZ + pad);
    const d = distToTrack(track, x, z);
    if (d < track.wallOffset + 7) continue;
    if (d > 60 && Math.random() < nearBias) continue;
    spots.push({ x, z, s: rand(0.8, 1.6), d });
  }
  return spots;
}

function createDesertFlora(scene: THREE.Scene, track: Track) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  // saguaro cactus: trunk + two arms merged
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CapsuleGeometry(0.55, 5, 4, 10);
  trunk.translate(0, 3, 0);
  parts.push(trunk);
  for (const [sx, h, len] of [[1, 2.6, 1.8], [-1, 3.4, 1.4]]) {
    const elbow = new THREE.CapsuleGeometry(0.4, 1.0, 4, 8);
    elbow.rotateZ(Math.PI / 2);
    elbow.translate(sx * 0.9, h, 0);
    const arm = new THREE.CapsuleGeometry(0.4, len, 4, 8);
    arm.translate(sx * 1.5, h + len / 2 + 0.2, 0);
    parts.push(elbow, arm);
  }
  const cactusGeo = mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  const spots = scatterSpots(track, 700, 260, 0.6);
  const cactus = new THREE.InstancedMesh(cactusGeo, new THREE.MeshStandardMaterial({ roughness: 0.75, flatShading: true }), spots.length);
  spots.forEach((p, i) => {
    q.setFromAxisAngle(Y, Math.random() * 6);
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s * rand(0.8, 1.3), p.s));
    cactus.setMatrixAt(i, m);
    cactus.setColorAt(i, col.setHSL(rand(0.27, 0.34), rand(0.35, 0.5), rand(0.28, 0.36)));
  });
  // red rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  jitter(rockGeo, 0.2);
  const rockSpots = scatterSpots(track, 900, 300, 0.5);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), rockSpots.length);
  rockSpots.forEach((p, i) => {
    const s = rand(0.6, p.d > 80 ? 9 : 3.5);
    q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random()));
    m.compose(new THREE.Vector3(p.x, s * 0.25, p.z), q, new THREE.Vector3(s * rand(1, 1.8), s * rand(0.6, 1.2), s));
    rocks.setMatrixAt(i, m);
    rocks.setColorAt(i, col.setHSL(rand(0.03, 0.08), rand(0.45, 0.6), rand(0.35, 0.5)));
  });
  // dry shrubs near the barriers
  const shrubGeo = new THREE.IcosahedronGeometry(0.8, 0);
  jitter(shrubGeo, 0.2);
  const shrubs = new THREE.InstancedMesh(shrubGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 450);
  for (let i = 0; i < 450; i++) {
    const idx = Math.floor(Math.random() * track.N);
    const side = Math.random() < 0.5 ? -1 : 1;
    const p = track.pointAt(idx, side * (track.wallOffset + rand(2.5, 12)));
    if (distToTrack(track, p.x, p.z) < track.wallOffset + 2) p.y = -10;
    const s = rand(0.6, 1.3);
    m.compose(p.setY(p.y + 0.3 * s), q.setFromAxisAngle(Y, Math.random() * 6), new THREE.Vector3(s * 1.3, s * 0.8, s * 1.3));
    shrubs.setMatrixAt(i, m);
    shrubs.setColorAt(i, col.setHSL(rand(0.1, 0.17), 0.4, rand(0.35, 0.45)));
  }
  for (const mesh of [cactus, rocks, shrubs]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function createMesas(scene: THREE.Scene, center: THREE.Vector3, th: Theme) {
  const geos: THREE.BufferGeometry[] = [];
  const bands = [new THREE.Color(th.mountains.low), new THREE.Color(th.mountains.mid), new THREE.Color(th.mountains.peak)];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + rand(-0.06, 0.06);
    const r = rand(900, 1450);
    const h = rand(90, 260);
    const w = rand(90, 220);
    const g = new THREE.CylinderGeometry(w * rand(0.7, 0.9), w, h, 8, 6);
    jitter(g, 8);
    g.scale(1, 1, rand(0.5, 1));
    g.rotateY(Math.random() * 6);
    g.translate(Math.cos(a) * r + center.x, h / 2 - 5, Math.sin(a) * r + center.z);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const band = (((Math.floor((pos.getY(v) / h) * 6) + i) % 3) + 3) % 3;
      const c = bands[band];
      colors.set([c.r, c.g, c.b], v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g.toNonIndexed());
  }
  const merged = mergeGeometries(geos)!;
  merged.computeVertexNormals();
  scene.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
}

function createTrees(scene: THREE.Scene, track: Track) {
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of track.pts) {
    bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z);
  }
  const pad = 260;
  const spots: { x: number; z: number; s: number; d: number }[] = [];
  let tries = 0;
  while (spots.length < 1400 && tries < 20000) {
    tries++;
    const x = rand(bounds.minX - pad, bounds.maxX + pad);
    const z = rand(bounds.minZ - pad, bounds.maxZ + pad);
    const d = distToTrack(track, x, z);
    if (d < track.wallOffset + 7) continue;
    // denser near the track for a sense of speed
    if (d > 60 && Math.random() < 0.55) continue;
    spots.push({ x, z, s: rand(0.8, 1.6), d });
  }

  // pine: stacked cones
  const pineParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(2.6 - i * 0.6, 3.2, 8, 1);
    c.translate(0, 3 + i * 1.7, 0);
    pineParts.push(c);
  }
  const pineGeo = mergeGeometries(pineParts)!;
  jitter(pineGeo, 0.15);
  const roundGeo = new THREE.IcosahedronGeometry(2.6, 1);
  jitter(roundGeo, 0.35);
  roundGeo.translate(0, 4.4, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 3, 6);
  trunkGeo.translate(0, 1.5, 0);

  const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const roundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5234, roughness: 0.9 });

  const pines = spots.filter((_, i) => i % 2 === 0);
  const rounds = spots.filter((_, i) => i % 2 === 1);
  const pineMesh = new THREE.InstancedMesh(pineGeo, pineMat, pines.length);
  const roundMesh = new THREE.InstancedMesh(roundGeo, roundMat, rounds.length);
  const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let ti = 0;
  pines.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6);
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s * rand(0.9, 1.3), p.s));
    pineMesh.setMatrixAt(i, m);
    trunkMesh.setMatrixAt(ti++, m);
    pineMesh.setColorAt(i, col.setHSL(rand(0.28, 0.36), rand(0.45, 0.6), rand(0.22, 0.32)));
  });
  rounds.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6);
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
    roundMesh.setMatrixAt(i, m);
    trunkMesh.setMatrixAt(ti++, m);
    const autumn = Math.random() < 0.18;
    roundMesh.setColorAt(i, autumn ? col.setHSL(rand(0.05, 0.11), 0.75, 0.5) : col.setHSL(rand(0.22, 0.3), rand(0.5, 0.65), rand(0.35, 0.45)));
  });
  for (const mesh of [pineMesh, roundMesh, trunkMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // bushes & flowers close to the barriers
  const bushGeo = new THREE.IcosahedronGeometry(1, 0);
  jitter(bushGeo, 0.15);
  const bushCount = 500;
  const bush = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), bushCount);
  const flowerGeo = new THREE.SphereGeometry(0.22, 6, 4);
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), bushCount * 3);
  let fi = 0;
  for (let i = 0; i < bushCount; i++) {
    const idx = Math.floor(Math.random() * track.N);
    const side = Math.random() < 0.5 ? -1 : 1;
    const off = side * (track.wallOffset + rand(2.5, 9));
    const p = track.pointAt(idx, off);
    if (distToTrack(track, p.x, p.z) < track.wallOffset + 2) continue;
    const s = rand(0.7, 1.5);
    m.compose(p.setY(0.3 * s), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), new THREE.Vector3(s * 1.3, s, s * 1.3));
    bush.setMatrixAt(i, m);
    bush.setColorAt(i, col.setHSL(rand(0.25, 0.33), 0.55, rand(0.28, 0.38)));
    for (let k = 0; k < 3; k++) {
      m.makeTranslation(p.x + rand(-1.4, 1.4) * s, 0.15 + Math.random() * s * 0.9, p.z + rand(-1.4, 1.4) * s);
      flowers.setMatrixAt(fi, m);
      flowers.setColorAt(fi, col.setHSL([0.0, 0.14, 0.83, 0.58][(Math.random() * 4) | 0], 0.9, 0.62));
      fi++;
    }
  }
  flowers.count = fi;
  bush.castShadow = true;
  bush.receiveShadow = true;
  scene.add(bush, flowers);
}

export function createMountains(scene: THREE.Scene, center: THREE.Vector3, th: Theme) {
  if (th.mountains.mesa) return createMesas(scene, center, th);
  const geos: THREE.BufferGeometry[] = [];
  const snow = new THREE.Color(th.mountains.peak), rock = new THREE.Color(th.mountains.mid), green = new THREE.Color(th.mountains.low);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rand(-0.05, 0.05);
    const r = rand(1100, 1500);
    const h = rand(180, 420);
    const g = new THREE.ConeGeometry(rand(180, 320), h, 9, 4);
    jitter(g, 18);
    g.translate(Math.cos(a) * r + center.x, h / 2 - 10, Math.sin(a) * r + center.z);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) / 420;
      if (y > 0.62) c.copy(snow);
      else if (y > 0.25) c.copy(rock).lerp(snow, Math.max(0, (y - 0.5) * 5));
      else c.copy(green).lerp(rock, y * 4);
      colors.set([c.r, c.g, c.b], v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g.toNonIndexed());
  }
  const merged = mergeGeometries(geos)!;
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  scene.add(mesh);
}

export function createClouds(scene: THREE.Scene, center: THREE.Vector3, th: Theme): THREE.Group {
  const group = new THREE.Group();
  const tex = T.cloudTexture();
  for (let i = 0; i < 40; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: th.cloudTint, transparent: true, opacity: rand(0.7, 0.95), depthWrite: false, fog: false });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2, r = rand(300, 1400);
    s.position.set(center.x + Math.cos(a) * r, rand(180, 380), center.z + Math.sin(a) * r);
    const w = rand(200, 420);
    s.scale.set(w, w * 0.45, 1);
    group.add(s);
  }
  scene.add(group);
  return group;
}

export function createStartArea(scene: THREE.Scene, track: Track, th: Theme) {
  const yaw = track.yawAt(0);
  const p0 = track.pts[0];
  const r = track.right[0];
  const W = track.wallOffset + 1.5;

  const arch = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.6, roughness: 0.35 });
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9, 1.4), pillarMat);
    pillar.position.set(s * W, 4.5, 0);
    arch.add(pillar);
  }
  const bannerTex = T.bannerTexture('KART RUSH  ★  START', th.banner[0], th.banner[1]);
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(W * 2 + 1.4, 2.4, 0.8),
    [pillarMat, pillarMat, pillarMat, pillarMat,
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.35 }),
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.35 })],
  );
  beam.position.y = 9.2;
  arch.add(beam);
  // start lights
  const lamps: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 }),
    );
    lamp.position.set((i - 1.5) * 1.6, 7.3, -0.5);
    arch.add(lamp);
    lamps.push(lamp);
  }
  arch.position.copy(p0);
  arch.rotation.y = yaw;
  arch.traverse((o) => { o.castShadow = true; });
  scene.add(arch);

  // grandstands
  const crowd = T.crowdTexture();
  crowd.repeat.set(3, 1);
  for (const s of [-1, 1]) {
    const stand = new THREE.Group();
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(60, 1.1, 2.2),
        new THREE.MeshStandardMaterial({ color: k % 2 ? 0xcfd6e0 : 0xb8c2cf, roughness: 0.7 }),
      );
      box.position.set(0, 0.55 + k * 1.1, k * 2.2);
      stand.add(box);
    }
    const people = new THREE.Mesh(
      new THREE.PlaneGeometry(60, steps * 2.3),
      new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9, transparent: false }),
    );
    people.rotation.x = -(Math.PI / 2 + Math.atan2(1.1, 2.2));
    people.rotation.z = Math.PI;
    people.position.set(0, steps * 0.55 + 1.2, steps * 1.1 - 1.1);
    stand.add(people);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(62, 0.4, 14), new THREE.MeshStandardMaterial({ color: s > 0 ? 0x1f6fe0 : 0xe0262b, roughness: 0.5 }));
    roof.position.set(0, 12, 5);
    roof.rotation.x = -0.12;
    stand.add(roof);
    for (const x of [-29, 29]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 12, 0.5), pillarMat);
      post.position.set(x, 6, 11);
      stand.add(post);
    }
    const off = s * (track.wallOffset + 5);
    stand.position.copy(p0).addScaledVector(r, off).addScaledVector(track.tan[0], -30);
    stand.rotation.y = yaw + (s > 0 ? -Math.PI / 2 : Math.PI / 2);
    stand.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    scene.add(stand);
  }
  return lamps;
}

export function createFlags(scene: THREE.Scene, track: Track): THREE.Mesh[] {
  const flags: THREE.Mesh[] = [];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.8, roughness: 0.3 });
  const colors = [0xff3b3b, 0xffc93b, 0x3bb4ff, 0x7dff5a, 0xff5ad2];
  const flagGeo = new THREE.PlaneGeometry(2.4, 1.4, 8, 1);
  flagGeo.translate(1.2, 0, 0);
  for (let i = 0; i < 70; i++) {
    const idx = Math.floor((i / 70) * track.N);
    const side = i % 2 ? -1 : 1;
    const p = track.pointAt(idx, side * (track.wallOffset + 1.8));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6, 6), poleMat);
    pole.position.copy(p).setY(3);
    pole.castShadow = true;
    scene.add(pole);
    const flag = new THREE.Mesh(
      flagGeo.clone(),
      new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 0.6 }),
    );
    flag.position.copy(p).setY(5.2);
    flag.rotation.y = Math.random() * 6;
    flag.castShadow = true;
    scene.add(flag);
    flags.push(flag);
  }
  return flags;
}

export function waveFlags(flags: THREE.Mesh[], t: number) {
  for (let f = 0; f < flags.length; f++) {
    const pos = flags[f].geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 2.2 - t * 7 + f) * 0.18 * x);
    }
    pos.needsUpdate = true;
  }
}

export class ItemBoxes {
  readonly group = new THREE.Group();
  private boxes: { mesh: THREE.Mesh; pos: THREE.Vector3; respawn: number; phase: number }[] = [];

  constructor(track: Track) {
    const tex = T.itemBoxTexture();
    const mat = new THREE.MeshPhysicalMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7,
      transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.1, clearcoat: 1,
    });
    const geo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    for (const row of track.itemRows) {
      for (let k = -2; k <= 2; k++) {
        const mesh = new THREE.Mesh(geo, mat);
        const pos = track.pointAt(row, k * 4.2).setY(1.3);
        mesh.position.copy(pos);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({ mesh, pos, respawn: 0, phase: Math.random() * 6 });
      }
    }
  }

  update(dt: number, t: number) {
    for (const b of this.boxes) {
      if (b.respawn > 0) {
        b.respawn -= dt;
        b.mesh.visible = b.respawn <= 0;
        b.mesh.scale.setScalar(0.01);
      }
      if (b.mesh.visible) {
        const s = Math.min(1, b.mesh.scale.x + dt * 3);
        b.mesh.scale.setScalar(s);
        b.mesh.rotation.set(t * 0.9 + b.phase, t * 1.3 + b.phase, 0);
        b.mesh.position.y = b.pos.y + Math.sin(t * 2.5 + b.phase) * 0.25;
      }
    }
  }

  /** returns the collected box (index + world position) or null */
  collect(p: THREE.Vector3): { idx: number; pos: THREE.Vector3 } | null {
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.mesh.visible) continue;
      const dx = b.pos.x - p.x, dz = b.pos.z - p.z;
      if (dx * dx + dz * dz < 2.4 * 2.4) {
        b.mesh.visible = false;
        b.respawn = 3;
        return { idx: i, pos: b.pos.clone() };
      }
    }
    return null;
  }

  /** Another online player took box `idx`. */
  take(idx: number): THREE.Vector3 | null {
    const b = this.boxes[idx];
    if (!b || !b.mesh.visible) return null;
    b.mesh.visible = false;
    b.respawn = 3;
    return b.pos.clone();
  }

  reset() {
    for (const b of this.boxes) { b.respawn = 0; b.mesh.visible = true; b.mesh.scale.setScalar(1); }
  }
}
