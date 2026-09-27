import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { Track } from './track';
import { TRACKS } from './themes';
import { ItemType, Kart, KartEvent, KartInput, MAX_SPEED, NetKartState } from './kart';
import { AIDriver } from './ai';
import { Input, KEY_HINTS, Scheme } from './input';
import { AudioSys } from './audio';
import { Hud, fmtTime } from './hud';
import { Particles } from './particles';
import { Weapons, WeaponFx } from './weapons';
import { FinishMsg, Net, RoomInfo, StartMsg } from './net';
import { LobbyUI } from './lobby';
import {
  createSky, createGround, createFlora, createMountains, createClouds, createStartArea, createFlags, waveFlags, ItemBoxes,
} from './scenery';

const PALETTES = [
  { body: 0xe8322b, accent: 0xffd23f, suit: 0x222831, css: '#e8322b' },
  { body: 0x1f7bff, accent: 0xffffff, suit: 0x1a2340, css: '#1f7bff' },
  { body: 0xffc21a, accent: 0x222222, suit: 0x333333, css: '#ffc21a' },
  { body: 0x2ecc71, accent: 0x0b3d2e, suit: 0x0b3d2e, css: '#2ecc71' },
  { body: 0xb04dff, accent: 0x00e5ff, suit: 0x2a1040, css: '#b04dff' },
  { body: 0xff6fb5, accent: 0xffffff, suit: 0x40102a, css: '#ff6fb5' },
];
const AI_NAMES = ['闪电', '旋风', '火箭', '疾风', '星辰'];
const DIFF_SKILL = [0.86, 0.94, 1.0];

const RadialBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0 },
    center: { value: new THREE.Vector2(0.5, 0.45) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float strength; uniform vec2 center; varying vec2 vUv;
    void main() {
      vec2 dir = vUv - center;
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 col = base;
      if (strength > 0.001) {
        vec4 acc = vec4(0.0); float tot = 0.0;
        for (int i = 0; i < 10; i++) {
          float t = float(i) / 9.0;
          float w = 1.0 - t * 0.5;
          acc += texture2D(tDiffuse, vUv - dir * t * strength) * w;
          tot += w;
        }
        col = mix(base, acc / tot, smoothstep(0.1, 0.55, length(dir)));
      }
      float vig = smoothstep(0.95, 0.35, length(dir * vec2(1.0, 0.85)));
      col.rgb *= mix(0.72, 1.0, vig);
      gl_FragColor = col;
    }`,
};

type State = 'menu' | 'countdown' | 'race' | 'done';
type Region = 'full' | 'top' | 'bottom';

interface World {
  track: Track;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  items: ItemBoxes;
  weapons: Weapons;
  flags: THREE.Mesh[];
  lamps: THREE.Mesh[];
  clouds: THREE.Group;
  sparks: Particles;
  smoke: Particles;
}

interface View {
  kart: Kart;
  scheme: Scheme;
  region: Region;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  blurPass: ShaderPass;
  hud: Hud;
  camYaw: number;
  shake: number;
  blur: number;
  lapStart: number;
  bestLap: number;
  throttlePressAt: number;
  lockBeep: number;
}

/** Per-race online bookkeeping. */
interface OnlineRace {
  raceId: number;
  ids: Map<Kart, string>;
  byId: Map<string, Kart>;
  sendAcc: number;
  wseq: number;
}

type V3 = [number, number, number];
const v3 = (v: THREE.Vector3): V3 => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
const fromV3 = (a: V3) => new THREE.Vector3(a[0], a[1], a[2]);

function angLerp(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

const $ = (id: string) => document.getElementById(id)!;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private envTex: THREE.Texture;
  private world!: World;
  private views: View[] = [];
  private karts: Kart[] = [];
  private humans: Kart[] = [];
  private ais = new Map<Kart, AIDriver>();
  private autopilots = new Map<Kart, AIDriver>();
  private colors = new Map<Kart, string>();
  private input = new Input();
  private audio = new AudioSys();
  private hudLayer = $('hud-layer');

  // settings
  private trackIdx = 0;
  private itemMode = false;
  private players = 1;
  private difficulty = 1;
  private totalLaps = 3;
  private colorIdx = 0;
  private color2Idx = 1;

  private state: State = 'menu';
  private paused = false;
  private t = 0;
  private stateTime = 0;
  private raceTime = 0;
  private maxLap = new Map<Kart, number>();
  private finishOrder: Kart[] = [];
  private rankCache: Kart[] = [];
  private prevItemKey = new Map<Kart, boolean>();
  private aiItemTimer = new Map<Kart, number>();
  private itemHeld = new Map<Kart, number>();
  private countNum = 4;
  private camMode = 0;
  private resultsShown = false;
  private clock = new THREE.Clock();
  /** ?auto in the URL: human karts are driven by AI (demo / testing) */
  private auto = new URLSearchParams(location.search).has('auto');

  // online
  private net: Net | null = null;
  private lobby!: LobbyUI;
  private room: RoomInfo | null = null;
  private ol: OnlineRace | null = null;
  private connecting: Promise<void> | null = null;

  constructor(container: HTMLElement) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.envTex = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;

    const q = new URLSearchParams(location.search);
    if (q.has('track')) this.trackIdx = Math.min(TRACKS.length - 1, Number(q.get('track')) || 0);
    if (q.has('items')) this.itemMode = true;
    if (q.has('2p')) this.players = 2;

    this.buildWorld();
    this.createKarts();
    this.gridPlace();
    this.buildViews();
    this.setupMenu();
    this.setupOnline();
    window.addEventListener('resize', () => this.onResize());
    this.enterMenu();
    const roomCode = q.get('room');
    if (roomCode) this.openLobby(roomCode);
    if (q.has('debug')) (window as unknown as { game: Game }).game = this;
    r.setAnimationLoop(() => this.frame());
  }

  // ================================================================ world
  private buildWorld() {
    if (this.world) {
      this.world.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
    }
    const def = TRACKS[this.trackIdx];
    const th = def.theme;
    const track = new Track(def);
    const scene = new THREE.Scene();
    scene.environment = this.envTex;
    scene.environmentIntensity = 0.45;
    scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    this.renderer.toneMappingExposure = th.exposure;

    const sunDir = new THREE.Vector3(...th.sunDir).normalize();
    scene.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiIntensity));
    const sun = new THREE.DirectionalLight(th.sunColor, th.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 1;
    sc.far = 500;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);

    const center = new THREE.Vector3();
    for (const p of track.pts) center.add(p);
    center.divideScalar(track.N);
    createSky(scene, sunDir, th);
    createGround(scene, th);
    scene.add(track.group);
    createFlora(scene, track, th);
    createMountains(scene, center, th);
    const clouds = createClouds(scene, center, th);
    const lamps = createStartArea(scene, track, th);
    const flags = createFlags(scene, track);
    const items = new ItemBoxes(track);
    scene.add(items.group);
    const sparks = new Particles(3000, true, 0.2);
    const smoke = new Particles(2500, false, 0.0);
    scene.add(sparks.points, smoke.points);
    const weapons = new Weapons(track, sparks, smoke, (fx, pos) => this.onWeaponFx(fx, pos));
    weapons.canHit = (k) => this.isLocal(k);
    weapons.onHit = (id) => this.sendEv({ kind: 'hit', wid: id });
    scene.add(weapons.group);

    this.world = { track, scene, sun, sunDir, items, weapons, flags, lamps, clouds, sparks, smoke };
  }

  private createKarts() {
    for (const k of this.karts) this.world.scene.remove(k.model.root);
    this.karts = [];
    this.humans = [];
    this.ais.clear();
    this.autopilots.clear();
    this.colors.clear();
    const humanColors = this.players === 2 ? [this.colorIdx, this.color2Idx] : [this.colorIdx];
    const aiColors = PALETTES.map((_, i) => i).filter((i) => !humanColors.includes(i));
    const names = this.players === 2 ? ['1P', '2P'] : ['你'];
    let n = 0;
    humanColors.forEach((pi, i) => {
      const k = new Kart(names[i], PALETTES[pi], ++n, true);
      this.humans.push(k);
      this.autopilots.set(k, new AIDriver(k, 0.92));
      this.addKart(k, pi);
    });
    aiColors.slice(0, 6 - humanColors.length).forEach((pi, i) => {
      const k = new Kart(AI_NAMES[i], PALETTES[pi], ++n, false);
      this.ais.set(k, new AIDriver(k, DIFF_SKILL[this.difficulty] + (Math.random() * 0.06 - 0.04)));
      this.addKart(k, pi);
    });
  }

  private addKart(k: Kart, palette: number) {
    k.itemMode = this.itemMode;
    this.karts.push(k);
    this.colors.set(k, PALETTES[palette].css);
    this.world.scene.add(k.model.root);
    k.on((e, kk, v) => this.onKartEvent(e, kk, v));
  }

  private gridPlace(order?: string[]) {
    // humans start mid-pack; AI fill the remaining grid slots
    const humanSlots = [3, 4];
    const used = new Set(humanSlots.slice(0, this.humans.length));
    const aiSlots = [0, 1, 2, 3, 4, 5].filter((s) => !used.has(s));
    let hi = 0, ai = 0;
    const tr = this.world.track;
    for (const k of this.karts) {
      const slot = order && this.ol ? order.indexOf(this.ol.ids.get(k)!) : k.isPlayer ? humanSlots[hi++] : aiSlots[ai++];
      const row = Math.floor(slot / 2), col = slot % 2;
      const back = 9 + row * 8 + col * 3.5;
      k.place(tr, tr.idx(tr.length - back), col ? 4.5 : -4.5);
      k.controlLock = true;
      this.maxLap.set(k, 0);
    }
    this.finishOrder = [];
    this.rankCache = [...this.karts];
    this.world.items.reset();
    this.world.weapons.clear();
  }

  private buildViews() {
    for (const v of this.views) {
      v.composer.dispose();
      v.hud.dispose();
    }
    this.views = [];
    const split = this.humans.length > 1;
    this.humans.forEach((kart, i) => {
      const region: Region = split ? (i === 0 ? 'top' : 'bottom') : 'full';
      const scheme: Scheme = split ? (i === 0 ? 'p1' : 'p2') : 'solo';
      const camera = new THREE.PerspectiveCamera(64, 1, 0.3, 4000);
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.renderer, rt);
      composer.setPixelRatio(Math.min(devicePixelRatio, 2));
      composer.addPass(new RenderPass(this.world.scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.28, 0.4, 0.95));
      const blurPass = new ShaderPass(RadialBlurShader);
      composer.addPass(blurPass);
      composer.addPass(new OutputPass());
      const hud = new Hud(this.hudLayer, this.world.track, {
        split, region, tag: split ? kart.name : undefined, itemMode: this.itemMode, keyHint: KEY_HINTS[scheme].item,
      });
      this.views.push({
        kart, scheme, region, camera, composer, blurPass, hud,
        camYaw: kart.yaw, shake: 0, blur: 0, lapStart: 0, bestLap: Infinity, throttlePressAt: -1, lockBeep: 0,
      });
    });
    this.onResize();
  }

  /** Full rebuild after a setting that changes karts / track / views. */
  private rebuild(world = false) {
    if (world) this.buildWorld();
    this.createKarts();
    this.gridPlace();
    this.buildViews();
  }

  // ================================================================ menu
  private setupMenu() {
    const tracks = $('tracks');
    tracks.innerHTML = '';
    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
    TRACKS.forEach((d, i) => {
      const c = document.createElement('div');
      c.className = 'track-card' + (i === this.trackIdx ? ' on' : '');
      const th = d.theme;
      c.innerHTML = `<div class="stripe" style="background:linear-gradient(90deg,${hex(th.skyTop)},${hex(th.skyMid)},${hex(th.skyHorizon)})"></div>
        <b>${d.name}</b><small>${d.desc}</small>`;
      c.onclick = () => {
        if (this.trackIdx === i) return;
        this.trackIdx = i;
        tracks.querySelectorAll('.track-card').forEach((e, j) => e.classList.toggle('on', j === i));
        this.rebuild(true);
        this.enterMenu();
      };
      tracks.appendChild(c);
    });

    const swatches = (id: string, set: (i: number) => void) => {
      const sw = $(id);
      sw.innerHTML = '';
      PALETTES.forEach((p, i) => {
        const d = document.createElement('div');
        d.className = 'swatch';
        d.style.background = `linear-gradient(135deg, ${p.css}, ${hex(p.accent)})`;
        d.onclick = () => {
          set(i);
          this.refreshSwatches();
          this.rebuild();
        };
        sw.appendChild(d);
      });
    };
    swatches('swatches', (i) => {
      this.colorIdx = i;
      if (this.color2Idx === i) this.color2Idx = (i + 1) % PALETTES.length;
    });
    swatches('swatches2', (i) => {
      this.color2Idx = i;
      if (this.colorIdx === i) this.colorIdx = (i + 1) % PALETTES.length;
    });
    this.refreshSwatches();

    const seg = (id: string, value: number, cb: (v: number) => void) => {
      const el = $(id);
      el.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', Number(b.dataset.v) === value);
        b.onclick = () => {
          el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          cb(Number(b.dataset.v));
        };
      });
    };
    seg('diff', this.difficulty, (v) => { this.difficulty = v; });
    seg('laps', this.totalLaps, (v) => { this.totalLaps = v; });
    seg('mode', this.itemMode ? 1 : 0, (v) => {
      this.itemMode = v === 1;
      this.updateMenuText();
      this.rebuild();
    });
    seg('players', this.players, (v) => {
      this.players = v;
      this.updateMenuText();
      this.rebuild();
    });
    this.updateMenuText();

    $('start-btn').onclick = () => this.startRace();
    $('online-btn').onclick = () => this.openLobby();
    $('resume-btn').onclick = () => this.setPaused(false);
    $('restart-btn').onclick = () => { this.setPaused(false); this.startRace(); };
    $('menu-btn').onclick = () => {
      this.setPaused(false);
      if (this.ol || this.room) this.leaveRoom();
      else this.enterMenu();
    };
    $('again-btn').onclick = () => (this.ol ? this.backToRoom() : this.startRace());
    $('menu-btn2').onclick = () => (this.ol || this.room ? this.leaveRoom() : this.enterMenu());
  }

  private refreshSwatches() {
    $('swatches').querySelectorAll('.swatch').forEach((e, j) => e.classList.toggle('on', j === this.colorIdx));
    $('swatches2').querySelectorAll('.swatch').forEach((e, j) => e.classList.toggle('on', j === this.color2Idx));
  }

  private updateMenuText() {
    const two = this.players === 2;
    $('color2-row').classList.toggle('hidden', !two);
    $('color-label').textContent = two ? '1P 涂装' : '赛车涂装';
    const itemWord = this.itemMode ? '道具' : '氮气';
    const k = (s: string) => s.split(' / ').map((x) => `<kbd>${x}</kbd>`).join(' / ');
    if (two) {
      const a = KEY_HINTS.p1, b = KEY_HINTS.p2;
      $('controls').innerHTML = `
        <div><span class="who">1P</span>${k(a.move)} 驾驶 · ${k(a.drift)} 漂移 · ${k(a.item)} ${itemWord} · ${k(a.respawn)} 复位</div>
        <div><span class="who p2">2P</span>${k(b.move)} 驾驶 · ${k(b.drift)} 漂移 · ${k(b.item)} ${itemWord} · ${k(b.respawn)} 复位</div>
        <div><kbd>P</kbd> 暂停 · <kbd>M</kbd> 音乐 · <kbd>C</kbd> 视角 · 手柄 1 → 1P，手柄 2 → 2P</div>`;
    } else {
      const a = KEY_HINTS.solo;
      $('controls').innerHTML = `
        <div>${k(a.move)} 驾驶</div>
        <div>${k(a.drift)} 漂移（按住 + 方向）</div>
        <div>${k(a.item)} 使用${itemWord}</div>
        <div><kbd>R</kbd> 回到赛道 · <kbd>P</kbd> 暂停 · <kbd>M</kbd> 音乐 · <kbd>C</kbd> 视角</div>`;
    }
    $('tips').innerHTML = this.itemMode
      ? '💥 道具赛：撞碎 “?” 箱随机获得 🚀导弹（追踪前一名）💧水炸弹（抛向前方，困住对手）🍌香蕉皮（丢在身后）🛡️护盾（抵挡一次攻击）⚡氮气。名次越靠后，越容易抽到强力道具！'
      : '💡 漂移积攒氮气槽，漂移越久松开时的小喷越强；倒计时 “GO” 前一刻按油门可触发起步加速！';
  }

  private enterMenu() {
    this.state = 'menu';
    this.stateTime = 0;
    this.gridPlace();
    this.hudLayer.classList.add('hidden');
    $('split-line').classList.add('hidden');
    $('menu').classList.remove('hidden');
    $('results').classList.add('hidden');
    $('pause').classList.add('hidden');
    this.audio.silenceEngine();
    this.setLamps(0, false);
  }

  private startRace() {
    this.audio.init();
    this.audio.startMusic();
    this.rebuild();
    this.state = 'countdown';
    this.stateTime = 0;
    this.countNum = 4;
    this.raceTime = 0;
    this.resultsShown = false;
    this.prevItemKey.clear();
    this.aiItemTimer.clear();
    this.itemHeld.clear();
    $('menu').classList.add('hidden');
    $('results').classList.add('hidden');
    this.hudLayer.classList.remove('hidden');
    $('split-line').classList.toggle('hidden', this.views.length < 2);
    for (const v of this.views) v.hud.resize();
    this.setLamps(0, false);
  }

  private setPaused(p: boolean) {
    if (this.state === 'menu' || (this.state === 'done' && this.resultsShown)) return;
    this.paused = p;
    $('pause').classList.toggle('hidden', !p);
    $('restart-btn').classList.toggle('hidden', !!this.ol);
    $('menu-btn').textContent = this.ol ? '离开房间' : '返回主菜单';
    if (p) this.audio.silenceEngine();
  }

  private setLamps(n: number, green: boolean) {
    this.world.lamps.forEach((l, i) => {
      const m = l.material as THREE.MeshStandardMaterial;
      m.emissive.set(green ? 0x22ff44 : 0xff1a1a);
      m.emissiveIntensity = green ? 4 : i < n ? 4 : 0;
    });
  }

  private viewHeight(v: View) {
    return v.region === 'full' ? innerHeight : Math.round(innerHeight / 2);
  }

  private onResize() {
    this.renderer.setSize(innerWidth, innerHeight);
    for (const v of this.views) {
      const h = this.viewHeight(v);
      v.camera.aspect = innerWidth / h;
      v.camera.updateProjectionMatrix();
      v.composer.setSize(innerWidth, h);
      v.hud.resize();
    }
  }

  private particleScale(v: View) {
    return (this.viewHeight(v) * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(v.camera.fov / 2)));
  }

  // ================================================================ events
  private viewOf(k: Kart): View | undefined {
    return this.views.find((v) => v.kart === k);
  }

  /** 0..1 loudness for a sound at a world position (relative to the nearest human camera). */
  private loudness(p: THREE.Vector3): number {
    let d = Infinity;
    for (const v of this.views) d = Math.min(d, v.camera.position.distanceTo(p));
    return THREE.MathUtils.clamp(1 - d / 90, 0, 1);
  }

  private onWeaponFx(fx: WeaponFx, pos: THREE.Vector3) {
    const l = this.loudness(pos);
    if (l <= 0) return;
    switch (fx) {
      case 'launch': this.audio.launch(); break;
      case 'explode':
        this.audio.explode(l);
        for (const v of this.views) if (v.camera.position.distanceTo(pos) < 25) v.shake = Math.max(v.shake, 0.4);
        break;
      case 'throw': this.audio.throwIt(); break;
      case 'splash': this.audio.splash(l); break;
      case 'drop': this.audio.drop(); break;
      case 'slip': break;
    }
  }

  private onKartEvent(e: KartEvent, k: Kart, v: number) {
    const view = this.viewOf(k);
    const near = this.loudness(k.pos) > 0.4;
    switch (e) {
      case 'nitro':
        if (view) { this.audio.nitro(); view.hud.toast('NITRO!', '#5ff2ff'); view.shake = 0.3; }
        this.burst(k.pos, new THREE.Color(0.4, 1.4, 3), 40, 14);
        break;
      case 'mini2':
        if (view) { this.audio.mini(2); view.hud.toast('SUPER BOOST!', '#ffae2e'); }
        break;
      case 'mini1':
        if (view) this.audio.mini(1);
        break;
      case 'pad':
        if (view) { this.audio.pad(); view.shake = 0.2; }
        break;
      case 'start':
        if (view) { this.audio.nitro(); view.hud.toast('PERFECT START!', '#7dff5a'); }
        break;
      case 'hit':
        if (view) { this.audio.hit(v); view.shake = Math.min(1, v / 18); }
        else if (near) this.audio.bump();
        this.burst(k.pos.clone().setY(0.6), new THREE.Color(3, 2, 0.6), Math.min(30, 6 + v), 8);
        break;
      case 'gain':
        if (view) { this.audio.gain(); view.hud.toast('+1 NITRO', '#5ff2ff'); }
        break;
      case 'spin':
        if (view) { this.audio.spinOut(); view.hud.toast('被击中！', '#ff6a4d'); view.shake = 0.7; }
        else if (near) this.audio.spinOut();
        break;
      case 'bubble':
        if (view) { this.audio.bubbled(); view.hud.toast('被困水泡！', '#5fb8ff'); view.shake = 0.3; }
        else if (near) this.audio.bubbled();
        break;
      case 'block':
        if (view) view.hud.toast('护盾抵挡！', '#7fe3ff');
        if (near || view) this.audio.block();
        this.burst(k.pos.clone().setY(1), new THREE.Color(0.6, 1.8, 3), 30, 10);
        break;
      case 'item':
        if (view) this.audio.itemGet();
        break;
    }
  }

  private burst(p: THREE.Vector3, color: THREE.Color, n: number, speed: number) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.world.sparks.spawn(p, v, color, 1, { size: 0.25 + Math.random() * 0.2, life: 0.4 + Math.random() * 0.4, gravity: 14, drag: 1.5 });
    }
  }

  // ================================================================ items
  /** Weighted by race position: the further back, the stronger the items. */
  private rollItem(k: Kart): ItemType {
    const n = this.rankCache.length;
    const r = n > 1 ? this.rankCache.indexOf(k) / (n - 1) : 0.5;
    const w: [ItemType, number][] = [
      ['missile', r === 0 ? 0.3 : 0.6 + 4 * r],
      ['water', 2 + r],
      ['banana', 3 - 2 * r],
      ['shield', 1.5 + 0.5 * r],
      ['nitro', 1 + 3 * r],
    ];
    let roll = w.reduce((s, [, x]) => s + x, 0) * Math.random();
    for (const [it, x] of w) {
      roll -= x;
      if (roll <= 0) return it;
    }
    return 'nitro';
  }

  private useItem(k: Kart) {
    const it = k.items.shift();
    if (!it) return;
    this.itemHeld.set(k, 0);
    const W = this.world;
    const view = this.viewOf(k);
    switch (it) {
      case 'missile': {
        const idx = this.rankCache.indexOf(k);
        let target: Kart | null = idx > 0 ? this.rankCache[idx - 1] : null;
        if (target?.finished) target = null;
        const f = W.weapons.fireMissile(k, target, this.weaponId('m'));
        this.sendEv({ kind: 'fire', w: 'missile', wid: f.id, owner: this.kartId(k), target: target ? this.kartId(target) : null, p: v3(f.pos), d: v3(f.dir) });
        const tv = target && this.viewOf(target);
        if (tv) tv.hud.toast(`${k.name} 发射了导弹！`, '#ff8a5c');
        break;
      }
      case 'water': {
        const f = W.weapons.throwWater(k, this.weaponId('w'));
        this.sendEv({ kind: 'fire', w: 'water', wid: f.id, owner: this.kartId(k), p: v3(f.pos), v: v3(f.vel) });
        break;
      }
      case 'banana': {
        const f = W.weapons.dropBanana(k, this.weaponId('b'));
        this.sendEv({ kind: 'fire', w: 'banana', wid: f.id, owner: this.kartId(k), p: v3(f.pos) });
        break;
      }
      case 'shield':
        k.shieldTime = 6;
        if (view || this.loudness(k.pos) > 0.3) this.audio.shieldUp();
        break;
      case 'nitro':
        k.applyBoost(2.4, 16, 'nitro');
        break;
    }
  }

  private progressMeters(k: Kart) {
    return k.lap * this.world.track.length + k.s;
  }

  /** AI (and autopilot) item decisions. */
  private aiItems(k: Kart, ai: AIDriver, dt: number) {
    if (!k.items.length || k.stunned || k.finished) return;
    this.itemHeld.set(k, (this.itemHeld.get(k) ?? 0) + dt);
    const timer = (this.aiItemTimer.get(k) ?? 0.8 + Math.random() * 1.5) - dt;
    this.aiItemTimer.set(k, timer);
    if (timer > 0) return;
    const rk = this.rankCache;
    const i = rk.indexOf(k);
    const ahead = i > 0 ? rk[i - 1] : null;
    const behind = i < rk.length - 1 ? rk[i + 1] : null;
    const gapA = ahead && !ahead.finished ? this.progressMeters(ahead) - this.progressMeters(k) : Infinity;
    const gapB = behind ? this.progressMeters(k) - this.progressMeters(behind) : Infinity;
    const held = this.itemHeld.get(k) ?? 0;
    let use = false;
    switch (k.items[0]) {
      case 'missile': use = gapA < 160; break;
      case 'water': use = gapA > 12 && gapA < 65; break;
      case 'banana': use = gapB < 25 || held > 8; break;
      case 'shield': use = this.world.weapons.targets.has(k) || held > 12; break;
      case 'nitro': use = ai.onStraight(this.world.track); break;
    }
    if (use) {
      this.useItem(k);
      this.aiItemTimer.set(k, 0.8 + Math.random() * 1.5);
    } else this.aiItemTimer.set(k, 0.25);
  }

  // ================================================================ frame
  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.handleGlobalKeys();
    // online races never pause: the pause menu is just an overlay
    if (!this.paused || this.ol) this.update(dt);
    this.render();
    this.input.endFrame();
  }

  private handleGlobalKeys() {
    const i = this.input;
    const lobbyOpen = this.lobby.visible;
    if (this.state === 'menu' && !lobbyOpen && i.hit('Enter', 'NumpadEnter')) this.startRace();
    if (this.state === 'done' && this.resultsShown && !this.ol && i.hit('Enter', 'NumpadEnter')) this.startRace();
    if ((this.state === 'race' || this.state === 'countdown') && i.hit('KeyP', 'Escape')) this.setPaused(!this.paused);
    if (i.hit('KeyM')) {
      this.audio.init();
      const on = this.audio.toggleMusic();
      for (const v of this.views) v.hud.toast(on ? '♪ 音乐 开' : '♪ 音乐 关');
    }
    if (i.hit('KeyC')) this.camMode = (this.camMode + 1) % 2;
    if (this.state === 'race' && !this.paused) {
      for (const v of this.views) if (i.respawnHit(v.scheme) && !v.kart.stunned) this.respawn(v.kart);
    }
  }

  private respawn(k: Kart) {
    const tr = this.world.track;
    tr.pointAt(k.index, 0, k.pos);
    k.yaw = k.moveAngle = tr.yawAt(k.index);
    k.speed = 0;
    k.drifting = false;
  }

  private update(dt: number) {
    const W = this.world;
    this.t += dt;
    this.stateTime += dt;
    W.items.update(dt, this.t);
    waveFlags(W.flags, this.t);
    W.clouds.rotation.y += dt * 0.004;

    if (this.state === 'menu') {
      for (const k of this.karts) k.syncModel(dt);
    } else if (this.state === 'countdown') {
      this.updateCountdown(dt);
    } else {
      this.raceTime += dt;
      this.updateRace(dt);
    }

    W.sparks.update(dt);
    W.smoke.update(dt);
    for (const v of this.views) this.updateCamera(v, dt);
    if (this.ol && this.state !== 'menu') this.sendStates(dt);
  }

  private updateCountdown(dt: number) {
    const t = this.stateTime;
    for (const v of this.views) {
      const inp = this.input.read(v.scheme);
      if (inp.throttle > 0 && v.throttlePressAt < 0) v.throttlePressAt = t;
      if (inp.throttle === 0) v.throttlePressAt = -1;
    }
    for (const k of this.karts) {
      if (this.isLocal(k)) k.syncModel(dt);
      else k.applyRemote(dt);
    }
    const phase = Math.floor(t);
    if (phase >= 1 && phase <= 3 && this.countNum !== 4 - phase) {
      this.countNum = 4 - phase;
      for (const v of this.views) v.hud.center(String(this.countNum));
      this.audio.beep(false);
      this.setLamps(phase, false);
    }
    if (t >= 4) {
      this.audio.beep(true);
      this.setLamps(4, true);
      this.state = 'race';
      this.stateTime = 0;
      for (const k of this.karts) k.controlLock = false;
      for (const v of this.views) {
        v.hud.center('GO!', 'go');
        v.lapStart = 0;
        if (this.auto) continue;
        if (v.throttlePressAt > 0 && t - v.throttlePressAt < 0.6) v.kart.applyBoost(1.4, 12, 'start');
        else if (v.throttlePressAt > 0) v.hud.toast('起步过早…', '#ff8a8a');
      }
      for (const [k, ai] of this.ais) if (this.isLocal(k) && Math.random() < 0.25 + ai.skill * 0.3) k.applyBoost(1.2, 10, 'start');
    }
    this.rankCache = this.ranking();
    this.updateHuds();
    const v0 = this.views[0];
    this.audio.setEngine(0.1 + (v0.throttlePressAt > 0 ? 0.3 : 0), v0.throttlePressAt > 0 ? 1 : 0, 0, 0);
  }

  private ranking(): Kart[] {
    const unfinished = this.karts.filter((k) => !this.finishOrder.includes(k)).sort((a, b) => b.progress - a.progress);
    return [...this.finishOrder, ...unfinished];
  }

  private updateRace(dt: number) {
    const W = this.world;
    const tr = W.track;
    this.rankCache = this.ranking();

    // rubber band relative to the average human (online: includes remote players)
    const humansAll = this.karts.filter((k) => k.isPlayer);
    const hp = humansAll.reduce((s, k) => s + this.progressMeters(k), 0) / Math.max(1, humansAll.length);

    for (const k of this.karts) {
      if (!this.isLocal(k)) {
        k.applyRemote(dt);
        continue;
      }
      let inp: KartInput;
      const view = this.viewOf(k);
      if (view && !k.finished && !this.auto) {
        inp = this.input.read(view.scheme);
        if (this.itemMode) {
          const prev = this.prevItemKey.get(k) ?? false;
          if (inp.nitro && !prev && !k.stunned) this.useItem(k);
          this.prevItemKey.set(k, inp.nitro);
        }
      } else if (view) {
        const ap = this.autopilots.get(k)!;
        inp = ap.think(dt, tr, this.karts, 0);
        if (this.itemMode) this.aiItems(k, ap, dt);
      } else {
        const ai = this.ais.get(k)!;
        const d = hp - this.progressMeters(k);
        const rb = THREE.MathUtils.clamp(d / 380, -0.07, 0.09) * (k.finished ? 0 : 1);
        inp = ai.think(dt, tr, this.karts, rb);
        if (this.itemMode) this.aiItems(k, ai, dt);
      }
      k.update(dt, inp, tr);
    }
    this.collideKarts();

    // item boxes
    for (const k of this.karts) {
      if (!this.isLocal(k)) continue;
      const got = W.items.collect(k.pos);
      if (!got) continue;
      this.sendEv({ kind: 'box', idx: got.idx });
      if (this.itemMode) k.giveItem(this.rollItem(k));
      else k.addNitro();
      if (this.viewOf(k)) this.audio.pickup();
      this.boxBurst(got.pos);
    }

    W.weapons.update(dt, this.karts, this.t);

    // laps & finish (remote karts report their own finish through the server)
    for (const k of this.karts) {
      if (!this.isLocal(k)) continue;
      const prev = this.maxLap.get(k)!;
      if (k.lap <= prev) continue;
      this.maxLap.set(k, k.lap);
      const view = this.viewOf(k);
      if (view && !k.finished && k.lap >= 2) {
        const lt = this.raceTime - view.lapStart;
        view.lapStart = this.raceTime;
        const best = lt < view.bestLap;
        view.bestLap = Math.min(view.bestLap, lt);
        if (k.lap <= this.totalLaps) {
          const final = k.lap === this.totalLaps;
          view.hud.center(final ? 'FINAL LAP' : `LAP ${k.lap}`, 'go');
          this.audio.lap(final);
          if (best && k.lap > 2) setTimeout(() => view.hud.toast('最快圈 ' + fmtTime(lt), '#ffcf2e'), 900);
        }
      }
      if (k.lap > this.totalLaps && !k.finished) {
        k.finished = true;
        k.finishTime = this.raceTime;
        k.items = [];
        if (this.ol) {
          // the server decides the official order
          this.net?.send({ type: 'finish', raceId: this.ol.raceId, kartId: this.kartId(k), time: this.raceTime });
          if (view) {
            view.hud.center('FINISH!', 'go stay');
            this.audio.fanfare(true);
            this.state = 'done';
            this.stateTime = 0;
          }
        } else {
          this.finishOrder.push(k);
          if (view) this.onHumanFinish(view);
        }
      }
    }

    if (this.state === 'done' && !this.resultsShown && this.stateTime > 3.5 && !this.ol) this.showResults();

    this.emitKartFx(dt);
    this.rankCache = this.ranking();
    this.updateHuds();

    // lock-on warning beeps
    const targets = W.weapons.targets;
    for (const v of this.views) {
      if (targets.has(v.kart)) {
        v.lockBeep -= dt;
        if (v.lockBeep <= 0) { this.audio.lockBeep(); v.lockBeep = 0.3; }
      }
    }

    const P = this.views[0].kart;
    const sn = Math.min(1, Math.abs(P.speed) / MAX_SPEED);
    const boostAmt = P.boosting ? (P.boostKind === 'nitro' ? 1 : 0.6) : 0;
    const thr = P.finished || this.auto ? 0.5 : this.input.read(this.views[0].scheme).throttle;
    this.audio.setEngine(sn, thr, P.drifting ? Math.min(1, Math.abs(P.slip) * 1.6) : 0, boostAmt);
  }

  private updateHuds() {
    const targets = this.world.weapons.targets;
    for (const v of this.views) {
      const time = v.kart.finished ? v.kart.finishTime : this.state === 'countdown' ? 0 : this.raceTime;
      v.hud.update(v.kart, this.rankCache, this.totalLaps, time, v.bestLap, this.colors, targets.has(v.kart));
      v.hud.drawMinimap(this.karts, v.kart, this.colors);
    }
  }

  private onHumanFinish(view: View) {
    const place = this.finishOrder.length;
    view.hud.center(place === 1 ? '🏆 WIN!' : `FINISH #${place}`, 'go stay');
    this.audio.fanfare(place <= 3);
    if (this.humans.every((h) => h.finished)) {
      this.state = 'done';
      this.stateTime = 0;
    }
  }

  private showResults() {
    this.resultsShown = true;
    this.setResultButtons();
    const r = this.ranking();
    const [p1, p2] = this.humans;
    const place1 = r.indexOf(p1) + 1;
    let title: string;
    if (p2) {
      const place2 = r.indexOf(p2) + 1;
      title = place1 < place2 ? `🏆 1P 获胜！（第 ${place1} 名）` : `🏆 2P 获胜！（第 ${place2} 名）`;
    } else {
      title = place1 === 1 ? '🏆 冠军！' : place1 <= 3 ? `第 ${place1} 名，漂亮！` : `第 ${place1} 名`;
    }
    $('result-title').textContent = title;
    const bestRows = this.views
      .map((v) => `<tr><td></td><td>${p2 ? v.kart.name + ' ' : '你的'}最快圈</td><td>${fmtTime(v.bestLap)}</td></tr>`)
      .join('');
    $('result-table').innerHTML = r
      .map((k, i) => `<tr class="${k === p1 ? 'me' : k === p2 ? 'me2' : ''}"><td>${i + 1}</td>
        <td><span class="dot" style="background:${this.colors.get(k)}"></span>${k.name}</td>
        <td>${k.finished ? fmtTime(k.finishTime) : '未完成'}</td></tr>`)
      .join('') + bestRows;
    $('results').classList.remove('hidden');
  }

  private collideKarts() {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++)
      for (let j = i + 1; j < ks.length; j++) {
        const a = ks[i], b = ks[j];
        if (a.stunKind === 'bubble' || b.stunKind === 'bubble') continue;
        const la = this.isLocal(a), lb = this.isLocal(b);
        if (!la && !lb) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const R = 2.1;
        if (d2 < R * R && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          // a remote kart doesn't move here, so the local one takes the whole push
          const pa = lb ? (la ? (R - d) / 2 : 0) : R - d;
          const pb = la ? (lb ? (R - d) / 2 : 0) : R - d;
          a.pos.x -= nx * pa; a.pos.z -= nz * pa;
          b.pos.x += nx * pb; b.pos.z += nz * pb;
          const va = a.speed * (Math.sin(a.moveAngle) * nx + Math.cos(a.moveAngle) * nz);
          const vb = b.speed * (Math.sin(b.moveAngle) * nx + Math.cos(b.moveAngle) * nz);
          const rel = va - vb;
          if (rel > 0) {
            if (la) a.speed -= rel * 0.35;
            if (lb) b.speed += rel * 0.25;
            for (const v of this.views) {
              if ((a === v.kart || b === v.kart) && rel > 3) {
                this.audio.bump();
                v.shake = Math.max(v.shake, Math.min(0.5, rel / 20));
              }
            }
          }
        }
      }
  }

  private emitKartFx(dt: number) {
    const W = this.world;
    const tmp = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const smokeCol = new THREE.Color(0.85, 0.85, 0.88);
    const blue = new THREE.Color(0.4, 1.2, 3.0);
    const orange = new THREE.Color(3.0, 1.3, 0.3);
    const flameN = new THREE.Color(0.3, 0.8, 2.0);
    const flameB = new THREE.Color(2.0, 0.8, 0.2);
    for (const k of this.karts) {
      if (this.views.every((v) => v.camera.position.distanceToSquared(k.pos) > 160 * 160)) continue;
      k.model.root.updateMatrixWorld(true);
      const back = k.forward.multiplyScalar(-1);
      if (k.drifting && k.speed > 6) {
        for (const w of k.model.rearWheelsLocal) {
          k.worldPoint(w, tmp);
          if (Math.random() < dt * 25) {
            vel.set(Math.random() - 0.5, 0.8 + Math.random(), Math.random() - 0.5).addScaledVector(back, 2);
            W.smoke.spawn(tmp, vel, smokeCol, 0.22, { size: 0.7, life: 0.7, grow: 1.5, drag: 1 });
          }
          const tier = k.driftTier;
          if (tier > 0) {
            const n = tier === 2 ? 3 : 2;
            for (let i = 0; i < n; i++) {
              vel.set((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4).addScaledVector(back, 4);
              W.sparks.spawn(tmp, vel, tier === 2 ? orange : blue, 1, { size: 0.22, life: 0.3, gravity: 18, drag: 1 });
            }
          }
        }
      }
      if (k.boosting) {
        const nitro = k.boostKind === 'nitro';
        for (const e of k.model.exhausts) {
          k.worldPoint(e, tmp);
          vel.copy(back).multiplyScalar(4 + Math.random() * 3)
            .add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5));
          W.sparks.spawn(tmp, vel, nitro ? flameN : flameB, 0.9, { size: nitro ? 0.45 : 0.3, life: 0.16, grow: -3 });
        }
      }
      if (k.stunKind === 'spin' && Math.random() < dt * 30) {
        vel.set(Math.random() - 0.5, 1.5, Math.random() - 0.5);
        W.smoke.spawn(k.pos.clone().setY(0.4), vel, smokeCol, 0.3, { size: 1, life: 0.8, grow: 1.5, drag: 1 });
      }
    }
  }

  private updateCamera(v: View, dt: number) {
    const P = v.kart;
    const cam = v.camera;
    const sn = Math.min(1.4, Math.abs(P.speed) / MAX_SPEED);
    const boostAmt = P.boosting ? (P.boostKind === 'nitro' ? 1 : 0.55) : 0;
    const split = v.region !== 'full';

    const targetYaw = angLerp(P.yaw, P.moveAngle, 0.6);
    v.camYaw = angLerp(v.camYaw, targetYaw, 1 - Math.exp(-5 * dt));
    const dist = (this.camMode === 0 ? 5.6 : 8.5) + sn * 1.3 + boostAmt * 0.6 + (split ? 0.6 : 0);
    const height = (this.camMode === 0 ? 2.2 : 3.4) + (P.stunKind === 'bubble' ? 1 : 0);
    const fx = Math.sin(v.camYaw), fz = Math.cos(v.camYaw);
    const chasePos = new THREE.Vector3(P.pos.x - fx * dist, height, P.pos.z - fz * dist);
    const chaseLook = new THREE.Vector3(P.pos.x + fx * 4, 1.0, P.pos.z + fz * 4);

    let pos = chasePos, look = chaseLook;
    if (this.state === 'menu' || this.state === 'countdown') {
      const a = this.t * (this.state === 'menu' ? 0.18 : 0.1) + P.yaw + Math.PI * 0.35 + (v.region === 'bottom' ? Math.PI : 0);
      const orbitPos = new THREE.Vector3(P.pos.x + Math.sin(a) * 8.5, 2.6, P.pos.z + Math.cos(a) * 8.5);
      const orbitLook = P.pos.clone().setY(0.9);
      if (this.state === 'menu') {
        pos = orbitPos; look = orbitLook;
      } else {
        const b = THREE.MathUtils.smoothstep(this.stateTime, 0.3, 3.2);
        pos = orbitPos.lerp(chasePos, b);
        look = orbitLook.lerp(chaseLook, b);
        v.camYaw = P.yaw;
      }
      cam.position.copy(pos);
    } else {
      cam.position.lerp(pos, 1 - Math.exp(-18 * dt));
    }
    if (v.shake > 0) {
      v.shake = Math.max(0, v.shake - dt * 2.2);
      const s = v.shake * 0.35;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    cam.lookAt(look);

    const racing = this.state === 'race' || this.state === 'done';
    const fov = (split ? 60 : 64) + (racing ? sn * 6 + boostAmt * 14 : 0);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-4 * dt));
      cam.updateProjectionMatrix();
    }
    v.blur += ((racing ? boostAmt * 0.045 : 0) - v.blur) * (1 - Math.exp(-6 * dt));
    v.blurPass.uniforms.strength.value = v.blur;
    v.hud.drawSpeedLines(racing ? boostAmt : 0);
  }

  // ================================================================ online
  /** Is this kart simulated on this machine? (offline: always) */
  private isLocal(k: Kart): boolean {
    if (!this.ol || !this.net) return true;
    const id = this.ol.ids.get(k);
    if (!id) return true;
    return id === this.net.id || (id.startsWith('ai') && this.room?.hostId === this.net.id);
  }

  private kartId(k: Kart): string {
    return this.ol?.ids.get(k) ?? '';
  }

  private weaponId(prefix: string): string | undefined {
    if (!this.ol || !this.net) return undefined;
    return `${this.net.id}.${prefix}${++this.ol.wseq}`;
  }

  private sendEv(ev: Record<string, unknown>) {
    if (this.ol && this.net) this.net.send({ type: 'ev', raceId: this.ol.raceId, ...ev });
  }

  private sendStates(dt: number) {
    const ol = this.ol!;
    ol.sendAcc += dt;
    if (ol.sendAcc < 0.05) return; // 20 Hz
    ol.sendAcc = 0;
    const k: NetKartState[] = [];
    for (const kart of this.karts) if (this.isLocal(kart)) k.push(kart.toNet(this.kartId(kart)));
    if (k.length) this.net?.send({ type: 'state', raceId: ol.raceId, k });
  }

  private boxBurst(p: THREE.Vector3) {
    const c = new THREE.Color();
    for (let i = 0; i < 30; i++) {
      c.setHSL(Math.random(), 1, 0.6).multiplyScalar(2);
      this.world.sparks.spawn(p, new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(12), c, 1,
        { size: 0.35, life: 0.6, gravity: 10, drag: 1 });
    }
  }

  private setupOnline() {
    this.lobby = new LobbyUI(
      {
        create: (nick) => this.withNet(() => {
          this.net!.send({ type: 'hello', name: nick, color: this.colorIdx });
          this.net!.send({ type: 'create' });
        }),
        join: (nick, code) => this.withNet(() => {
          this.net!.send({ type: 'hello', name: nick, color: this.colorIdx });
          this.net!.send({ type: 'join', code });
        }),
        leave: () => this.leaveRoom(),
        back: () => {
          this.lobby.hide();
          $('menu').classList.remove('hidden');
        },
        settings: (st) => this.net?.send({ type: 'settings', settings: st }),
        color: (i) => {
          this.colorIdx = i;
          this.net?.send({ type: 'color', color: i });
        },
        start: () => this.net?.send({ type: 'start' }),
      },
      PALETTES,
      TRACKS.map((t) => t.name),
    );
  }

  private openLobby(code = '') {
    $('menu').classList.add('hidden');
    $('results').classList.add('hidden');
    this.lobby.show();
    if (this.room && this.net) this.lobby.showRoom(this.room, this.net.id);
    else this.lobby.showJoin(code);
    this.withNet(() => {
      // arriving through an invite link with a remembered nickname: join right away
      if (code && this.lobby.savedNick && !this.room) {
        this.net!.send({ type: 'hello', name: this.lobby.savedNick, color: this.colorIdx });
        this.net!.send({ type: 'join', code });
      }
    });
  }

  /** Make sure we're connected, then run fn. */
  private withNet(fn: () => void) {
    if (this.net?.connected) return fn();
    // a connection may already be on its way (e.g. clicking "create" right after opening the lobby)
    if (!this.connecting) {
      this.lobby.setStatus('连接中…', false);
      const net = this.net ?? this.createNet();
      this.connecting = net.connect().then(
        () => this.lobby.setStatus(`已连接 · ${Math.round(net.rtt) || '--'}ms`, true),
        (e: Error) => {
          this.lobby.setStatus('未连接', false);
          this.lobby.error(e.message);
          throw e;
        },
      ).finally(() => { this.connecting = null; });
    }
    this.connecting.then(fn, () => {});
  }

  private createNet(): Net {
    const net = new Net();
    this.net = net;
    net.on('pong', () => this.lobby.setStatus(`已连接 · ${Math.round(net.rtt)}ms`, true));
    net.on('error', (m) => this.lobby.error(m.msg));
    net.on('room', (m) => this.onRoom(m as unknown as RoomInfo));
    net.on('start', (m) => this.startOnlineRace(m as unknown as StartMsg));
    net.on('state', (m) => {
      if (!this.ol || m.raceId !== this.ol.raceId) return;
      for (const st of m.k as NetKartState[]) {
        const k = this.ol.byId.get(st.id);
        if (k && !this.isLocal(k)) k.setNet(st);
      }
    });
    net.on('ev', (m) => this.onRemoteEv(m));
    net.on('finish', (m) => this.onFinishMsg(m as unknown as FinishMsg));
    net.on('end', () => {
      if (this.ol && !this.resultsShown) this.showResults();
    });
    net.on('left', (m) => this.onPlayerLeft(m.id));
    net.onClose = () => {
      this.lobby.setStatus('已断开', false);
      const wasOnline = !!this.ol || !!this.room;
      this.room = null;
      if (this.ol) {
        this.ol = null;
        for (const v of this.views) v.hud.toast('与服务器断开连接', '#ff8a8a');
        setTimeout(() => {
          this.rebuild();
          this.enterMenu();
        }, 1500);
      }
      if (wasOnline) this.lobby.showJoin();
    };
    return net;
  }

  private onRoom(room: RoomInfo) {
    const prevHost = this.room?.hostId;
    this.room = room;
    if (!this.net) return;
    // keep the URL shareable
    history.replaceState(null, '', `?room=${room.code}`);
    if (this.ol) {
      if (prevHost && prevHost !== room.hostId && room.hostId === this.net.id) {
        for (const v of this.views) v.hud.toast('你成为了房主（接管 AI）', '#ffcf2e');
      }
      return;
    }
    if (room.state === 'lobby') {
      // preview the chosen track behind the lobby
      if (room.settings.track !== this.trackIdx && this.state === 'menu') {
        this.trackIdx = room.settings.track;
        this.rebuild(true);
        this.enterMenu();
        $('menu').classList.add('hidden');
      }
      const me = room.players.find((p) => p.id === this.net!.id);
      if (me && me.color !== this.colorIdx && this.state === 'menu') {
        this.colorIdx = me.color;
        this.rebuild();
        this.enterMenu();
        $('menu').classList.add('hidden');
      }
      if (this.state === 'menu') this.lobby.show();
      this.lobby.showRoom(room, this.net.id);
    }
  }

  private startOnlineRace(m: StartMsg) {
    if (!this.net) return;
    const myId = this.net.id;
    this.setPaused(false);
    this.lobby.hide();
    $('menu').classList.add('hidden');
    $('results').classList.add('hidden');
    this.audio.init();
    this.audio.startMusic();

    this.players = 1;
    this.itemMode = m.settings.mode === 1;
    this.totalLaps = m.settings.laps;
    if (m.settings.track !== this.trackIdx) {
      this.trackIdx = m.settings.track;
      this.buildWorld();
    }

    // karts
    for (const k of this.karts) this.world.scene.remove(k.model.root);
    this.karts = [];
    this.humans = [];
    this.ais.clear();
    this.autopilots.clear();
    this.colors.clear();
    const ids = new Map<Kart, string>(), byId = new Map<string, Kart>();
    m.karts.forEach((spec, n) => {
      const pal = PALETTES[spec.color] ?? PALETTES[0];
      const k = new Kart(spec.id === myId ? '你' : spec.name, pal, n + 1, spec.human);
      ids.set(k, spec.id);
      byId.set(spec.id, k);
      this.addKart(k, spec.color);
      if (spec.id === myId) {
        this.humans.push(k);
        this.autopilots.set(k, new AIDriver(k, 0.92));
      } else {
        k.model.setLabel(spec.name, pal.css);
      }
      if (!spec.human) this.ais.set(k, new AIDriver(k, DIFF_SKILL[1] + (Math.random() * 0.06 - 0.04)));
    });
    this.ol = { raceId: m.raceId, ids, byId, sendAcc: 0, wseq: 0 };
    this.gridPlace(m.grid);
    this.buildViews();

    this.state = 'countdown';
    this.stateTime = -0.3;
    this.countNum = 4;
    this.raceTime = 0;
    this.resultsShown = false;
    this.prevItemKey.clear();
    this.aiItemTimer.clear();
    this.itemHeld.clear();
    this.hudLayer.classList.remove('hidden');
    for (const v of this.views) v.hud.resize();
    this.setLamps(0, false);
  }

  private onRemoteEv(m: Record<string, any>) {
    const ol = this.ol;
    if (!ol || m.raceId !== ol.raceId) return;
    const W = this.world;
    switch (m.kind) {
      case 'box': {
        const p = W.items.take(m.idx);
        if (p) this.boxBurst(p);
        break;
      }
      case 'hit':
        W.weapons.remove(m.wid);
        break;
      case 'fire': {
        const owner = ol.byId.get(m.owner);
        if (!owner) break;
        if (m.w === 'missile') {
          const target = m.target ? ol.byId.get(m.target) ?? null : null;
          W.weapons.fireMissile(owner, target, m.wid, { pos: fromV3(m.p), dir: fromV3(m.d) });
          const tv = target && this.viewOf(target);
          if (tv) tv.hud.toast(`${owner.name} 发射了导弹！`, '#ff8a5c');
        } else if (m.w === 'water') {
          W.weapons.throwWater(owner, m.wid, { pos: fromV3(m.p), vel: fromV3(m.v) });
        } else if (m.w === 'banana') {
          W.weapons.dropBanana(owner, m.wid, fromV3(m.p));
        }
        break;
      }
    }
  }

  private onFinishMsg(m: FinishMsg) {
    const k = this.ol?.byId.get(m.kartId);
    if (!k) return;
    if (!k.finished) {
      k.finished = true;
      k.finishTime = m.time;
    }
    if (!this.finishOrder.includes(k)) this.finishOrder.push(k);
    const v = this.viewOf(k);
    if (v) {
      v.hud.center(m.place === 1 ? '🏆 WIN!' : `FINISH #${m.place}`, 'go stay');
      v.hud.toast(`第 ${m.place} 名！`, '#ffcf2e');
    } else if (k.isPlayer) {
      for (const view of this.views) view.hud.toast(`${k.name} 冲线 · 第 ${m.place} 名`, '#9fe8ff');
    }
  }

  private onPlayerLeft(id: string) {
    const ol = this.ol;
    if (!ol) return;
    const k = ol.byId.get(id);
    if (!k) return;
    for (const v of this.views) v.hud.toast(`${k.name} 离开了比赛`, '#ff9f9f');
    this.world.scene.remove(k.model.root);
    this.karts = this.karts.filter((x) => x !== k);
    this.finishOrder = this.finishOrder.filter((x) => x !== k);
    ol.byId.delete(id);
  }

  private setResultButtons() {
    const online = !!this.ol;
    $('again-btn').textContent = online ? '返回房间' : '再来一局';
    $('menu-btn2').textContent = online ? '离开房间' : '主菜单';
  }

  /** After an online race: back to the room screen. */
  private backToRoom() {
    this.ol = null;
    $('results').classList.add('hidden');
    this.players = 1;
    this.rebuild();
    this.enterMenu();
    $('menu').classList.add('hidden');
    this.lobby.show();
    if (this.room && this.net) this.lobby.showRoom(this.room, this.net.id);
    else this.lobby.showJoin();
  }

  private leaveRoom() {
    this.net?.send({ type: 'leave' });
    this.room = null;
    history.replaceState(null, '', location.pathname);
    if (this.ol) {
      this.ol = null;
      this.rebuild();
    }
    $('results').classList.add('hidden');
    this.enterMenu();
    this.lobby.hide();
  }

  private render() {
    const r = this.renderer;
    const W = this.world;
    const split = this.views.length > 1;
    const w = innerWidth;
    r.setScissorTest(split);
    for (const v of this.views) {
      const h = this.viewHeight(v);
      const y = v.region === 'top' ? innerHeight - h : 0;
      r.setViewport(0, y, w, h);
      r.setScissor(0, y, w, h);
      // shadows follow whichever kart this view is looking at
      const p = v.kart.pos;
      W.sun.position.set(p.x + W.sunDir.x * 150, W.sunDir.y * 150, p.z + W.sunDir.z * 150);
      W.sun.target.position.set(p.x, 0, p.z);
      const s = this.particleScale(v);
      W.sparks.setScale(s);
      W.smoke.setScale(s);
      v.composer.render();
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, w, innerHeight);
  }
}
