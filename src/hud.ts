import { ItemType, Kart, MAX_SPEED } from './kart';
import { Track } from './track';

export function fmtTime(t: number): string {
  if (!isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t * 1000) % 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

const SUFFIX = ['st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th'];

export const ITEM_INFO: Record<ItemType, { icon: string; name: string; color: string }> = {
  missile: { icon: '🚀', name: '导弹', color: '#ff5a3c' },
  water: { icon: '💧', name: '水炸弹', color: '#3fa9ff' },
  banana: { icon: '🍌', name: '香蕉皮', color: '#ffd52e' },
  shield: { icon: '🛡️', name: '护盾', color: '#7fe3ff' },
  nitro: { icon: '⚡', name: '氮气', color: '#5ff2ff' },
};

const TEMPLATE = `
  <canvas class="speedlines"></canvas>
  <div class="hud-tl">
    <div class="tag"></div>
    <div class="pos"><span class="pos-num">1</span><sup class="pos-suf">st</sup><small>/<span class="pos-total">6</span></small></div>
    <div class="lap">LAP <b class="lap-num">1</b>/<span class="lap-total">3</span></div>
    <div class="time">00:00.000</div>
    <div class="best">最佳 <span class="best-t">--:--.---</span></div>
  </div>
  <ol class="board"></ol>
  <canvas class="minimap" width="440" height="440"></canvas>
  <div class="hud-bl">
    <div class="nitro-label"><span class="nl-text">NITRO</span> <span class="key"></span></div>
    <div class="nitro-slots"><div class="slot s0"></div><div class="slot s1"></div></div>
    <div class="gauge"><div class="gauge-fill"></div></div>
    <div class="drift-tier"></div>
  </div>
  <div class="hud-br">
    <canvas class="speedo" width="440" height="440"></canvas>
    <div class="speed-num"><span class="speed">0</span><small>km/h</small></div>
  </div>
  <div class="wrongway hidden">⚠ 逆行 WRONG WAY</div>
  <div class="lockon hidden">🚀 导弹锁定！</div>
  <div class="center-msg"></div>
  <div class="toast"></div>
`;

export class Hud {
  readonly root: HTMLDivElement;
  private mm: HTMLCanvasElement;
  private mmCtx: CanvasRenderingContext2D;
  private trackImg!: HTMLCanvasElement;
  private speedo: HTMLCanvasElement;
  private spCtx: CanvasRenderingContext2D;
  private lines: HTMLCanvasElement;
  private lnCtx: CanvasRenderingContext2D;
  private toMap!: (x: number, z: number) => [number, number];
  private el: Record<string, HTMLElement> = {};
  private boardKey = '';
  private itemKey = '';

  constructor(parent: HTMLElement, track: Track, opts: { split: boolean; region: 'full' | 'top' | 'bottom'; tag?: string; itemMode: boolean; keyHint: string }) {
    this.root = document.createElement('div');
    this.root.className = `hud ${opts.region}${opts.split ? ' split' : ''}${opts.itemMode ? ' items' : ''}`;
    this.root.innerHTML = TEMPLATE;
    parent.appendChild(this.root);
    for (const c of ['pos-num', 'pos-suf', 'pos-total', 'lap-num', 'lap-total', 'time', 'best-t', 'speed', 's0', 's1', 'gauge-fill',
      'drift-tier', 'wrongway', 'lockon', 'board', 'center-msg', 'toast', 'tag', 'key', 'nl-text']) {
      this.el[c] = this.root.querySelector('.' + c) as HTMLElement;
    }
    this.el.tag.textContent = opts.tag ?? '';
    this.el.tag.classList.toggle('hidden', !opts.tag);
    this.el.key.textContent = opts.keyHint;
    this.el['nl-text'].textContent = opts.itemMode ? 'ITEM' : 'NITRO';
    this.mm = this.root.querySelector('.minimap')!;
    this.mmCtx = this.mm.getContext('2d')!;
    this.speedo = this.root.querySelector('.speedo')!;
    this.spCtx = this.speedo.getContext('2d')!;
    this.lines = this.root.querySelector('.speedlines')!;
    this.lnCtx = this.lines.getContext('2d')!;
    this.setTrack(track);
    this.resize();
  }

  dispose() {
    this.root.remove();
  }

  setTrack(track: Track) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const W = this.mm.width, pad = 40;
    const sc = (W - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (W - (maxX - minX) * sc) / 2, oz = (W - (maxZ - minZ) * sc) / 2;
    // mirror x so the map matches the driver's left/right when heading "up"
    this.toMap = (x, z) => [W - (ox + (x - minX) * sc), W - (oz + (z - minZ) * sc)];

    this.trackImg = document.createElement('canvas');
    this.trackImg.width = this.trackImg.height = W;
    const c = this.trackImg.getContext('2d')!;
    const path = () => {
      c.beginPath();
      track.pts.forEach((p, i) => {
        const [x, y] = this.toMap(p.x, p.z);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.closePath();
    };
    c.lineJoin = c.lineCap = 'round';
    path(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 22; c.stroke();
    path(); c.strokeStyle = '#fff'; c.lineWidth = 14; c.stroke();
    path(); c.strokeStyle = '#4a5068'; c.lineWidth = 9; c.stroke();
    const [sx, sy] = this.toMap(track.pts[0].x, track.pts[0].z);
    c.fillStyle = '#ffcf2e';
    c.beginPath(); c.arc(sx, sy, 8, 0, Math.PI * 2); c.fill();
  }

  resize() {
    this.lines.width = innerWidth;
    this.lines.height = this.root.classList.contains('full') ? innerHeight : Math.round(innerHeight / 2);
  }

  update(me: Kart, ranking: Kart[], totalLaps: number, raceTime: number, best: number, colors: Map<Kart, string>, locked: boolean) {
    const e = this.el;
    const place = ranking.indexOf(me) + 1;
    e['pos-num'].textContent = String(place);
    e['pos-suf'].textContent = SUFFIX[place - 1];
    e['pos-total'].textContent = String(ranking.length);
    e['lap-num'].textContent = String(Math.min(totalLaps, Math.max(1, me.lap)));
    e['lap-total'].textContent = String(totalLaps);
    e.time.textContent = fmtTime(raceTime);
    e['best-t'].textContent = fmtTime(best);
    e.speed.textContent = String(Math.round(Math.abs(me.speed) * 3.6 * 1.45));

    if (me.itemMode) {
      const key = me.items.join(',');
      if (key !== this.itemKey) {
        this.itemKey = key;
        [e.s0, e.s1].forEach((slot, i) => {
          const it = me.items[i];
          slot.className = 'slot ' + (i ? 's1' : 's0') + (it ? ' item' : '') + (it && i === 0 ? ' next' : '');
          slot.innerHTML = it ? `<span>${ITEM_INFO[it].icon}</span>` : '';
          slot.style.setProperty('--c', it ? ITEM_INFO[it].color : 'transparent');
        });
      }
    } else {
      e.s0.classList.toggle('full', me.nitros >= 1);
      e.s1.classList.toggle('full', me.nitros >= 2);
      e['gauge-fill'].style.width = `${Math.min(100, me.gauge * 100)}%`;
    }
    const tier = me.driftTier;
    e['drift-tier'].className = 'drift-tier' + (tier ? ' t' + tier : '');
    e['drift-tier'].textContent = me.drifting ? (tier === 2 ? 'SUPER DRIFT!!' : tier === 1 ? 'DRIFT!' : 'drift…') : '';
    e.wrongway.classList.toggle('hidden', !me.wrongWay || me.stunned);
    e.lockon.classList.toggle('hidden', !locked);

    const bk = ranking.map((k) => k.name).join();
    if (bk !== this.boardKey) {
      this.boardKey = bk;
      e.board.innerHTML = ranking
        .map((k, i) => `<li class="${k === me ? 'me' : k.isPlayer ? 'human' : ''}" style="border-left-color:${colors.get(k)}">
          <span class="n">${i + 1}</span><span class="dot" style="background:${colors.get(k)}"></span>${k.name}</li>`)
        .join('');
    }
    this.drawSpeedo(Math.abs(me.speed) / (MAX_SPEED + 16), me.boosting);
  }

  drawMinimap(karts: Kart[], me: Kart, colors: Map<Kart, string>) {
    const c = this.mmCtx, W = this.mm.width;
    c.clearRect(0, 0, W, W);
    c.drawImage(this.trackImg, 0, 0);
    const order = [...karts].sort((a, b) => (a === me ? 1 : 0) - (b === me ? 1 : 0));
    for (const k of order) {
      const [x, y] = this.toMap(k.pos.x, k.pos.z);
      const mine = k === me;
      c.beginPath();
      c.arc(x, y, mine ? 14 : k.isPlayer ? 12 : 9, 0, Math.PI * 2);
      c.fillStyle = colors.get(k)!;
      c.fill();
      c.lineWidth = mine ? 5 : k.isPlayer ? 3.5 : 2.5;
      c.strokeStyle = mine ? '#fff' : k.isPlayer ? '#ffe14a' : 'rgba(255,255,255,.8)';
      c.stroke();
    }
  }

  private drawSpeedo(frac: number, boost: boolean) {
    const c = this.spCtx, W = this.speedo.width, cx = W / 2, cy = W / 2, R = W / 2 - 30;
    c.clearRect(0, 0, W, W);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(cx, cy, R, a0, a1);
    c.strokeStyle = 'rgba(10,18,40,.55)';
    c.lineWidth = 34;
    c.stroke();
    for (let i = 0; i <= 12; i++) {
      const a = a0 + (a1 - a0) * (i / 12);
      const r2 = R - (i % 3 === 0 ? 44 : 36);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
      c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      c.strokeStyle = 'rgba(255,255,255,.6)';
      c.lineWidth = i % 3 === 0 ? 5 : 3;
      c.stroke();
    }
    const g = c.createLinearGradient(0, W, W, 0);
    if (boost) { g.addColorStop(0, '#ff7a00'); g.addColorStop(1, '#ffe14a'); }
    else { g.addColorStop(0, '#1b8cff'); g.addColorStop(1, '#5ff2ff'); }
    c.beginPath();
    c.arc(cx, cy, R, a0, a0 + (a1 - a0) * Math.min(1, frac));
    c.strokeStyle = g;
    c.lineWidth = 22;
    c.shadowColor = boost ? '#ff8a00' : '#2ec5ff';
    c.shadowBlur = 20;
    c.stroke();
    c.shadowBlur = 0;
  }

  drawSpeedLines(intensity: number) {
    const c = this.lnCtx, w = this.lines.width, h = this.lines.height;
    c.clearRect(0, 0, w, h);
    if (intensity <= 0.01) return;
    const cx = w / 2, cy = h * 0.45;
    const n = Math.floor(40 * intensity);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = Math.max(w, h) * (0.32 + Math.random() * 0.25);
      const r1 = r0 + 80 + Math.random() * 220 * intensity;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.strokeStyle = `rgba(255,255,255,${0.12 + Math.random() * 0.3 * intensity})`;
      c.lineWidth = 1 + Math.random() * 2.5;
      c.stroke();
    }
  }

  center(text: string, cls = '') {
    const el = this.el['center-msg'];
    el.className = 'center-msg';
    void el.offsetWidth;
    el.textContent = text;
    el.className = 'center-msg pop ' + cls;
  }

  toast(text: string, color = '#fff') {
    const el = this.el.toast;
    el.className = 'toast';
    void el.offsetWidth;
    el.textContent = text;
    el.style.color = color;
    el.style.textShadow = `0 0 20px ${color}, 0 3px 0 rgba(0,0,0,.35)`;
    el.className = 'toast show';
  }
}
