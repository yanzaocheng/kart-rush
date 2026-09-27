import { RoomInfo, RoomSettings } from './net';

export interface LobbyCallbacks {
  create(nick: string): void;
  join(nick: string, code: string): void;
  leave(): void;
  back(): void;
  settings(s: RoomSettings): void;
  color(i: number): void;
  start(): void;
}

const $ = (id: string) => document.getElementById(id)!;
const NICK_KEY = 'kart-rush-nick';

function storageGet(k: string): string {
  try { return localStorage.getItem(k) ?? ''; } catch { return ''; }
}
function storageSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** DOM for the online lobby (join screen + room screen). */
export class LobbyUI {
  private room: RoomInfo | null = null;
  private myId = '';
  private nickInput = $('nick') as HTMLInputElement;
  private codeInput = $('room-code') as HTMLInputElement;

  constructor(private cb: LobbyCallbacks, private palettes: { css: string }[], trackNames: string[]) {
    this.nickInput.value = storageGet(NICK_KEY);
    this.codeInput.addEventListener('input', () => { this.codeInput.value = this.codeInput.value.toUpperCase(); });
    $('create-room').onclick = () => {
      const n = this.nick();
      if (n) cb.create(n);
    };
    const doJoin = () => {
      const n = this.nick();
      const code = this.codeInput.value.trim().toUpperCase();
      if (!n) return;
      if (code.length !== 4) return this.error('房间码是 4 位');
      cb.join(n, code);
    };
    $('join-room').onclick = doJoin;
    this.codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    $('lobby-back').onclick = () => cb.back();
    $('room-leave').onclick = () => cb.leave();
    $('room-start').onclick = () => cb.start();
    $('copy-link').onclick = () => this.copyLink();

    $('r-track').innerHTML = trackNames.map((n, i) => `<button data-v="${i}">${n}</button>`).join('');
    const seg = (id: string, apply: (s: RoomSettings, v: number) => void) => {
      $(id).querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          if (!this.isHost || !this.room) return;
          const s = { ...this.room.settings };
          apply(s, Number(b.dataset.v));
          cb.settings(s);
        };
      });
    };
    seg('r-track', (s, v) => { s.track = v; });
    seg('r-mode', (s, v) => { s.mode = v; });
    seg('r-laps', (s, v) => { s.laps = v; });
    seg('r-ai', (s, v) => { s.ai = v === 1; });

    const sw = $('room-swatches');
    sw.innerHTML = '';
    palettes.forEach((p, i) => {
      const d = document.createElement('div');
      d.className = 'swatch';
      d.style.background = p.css;
      d.onclick = () => cb.color(i);
      sw.appendChild(d);
    });
  }

  private get isHost(): boolean {
    return !!this.room && this.room.hostId === this.myId;
  }

  nick(): string {
    const n = this.nickInput.value.trim().slice(0, 12);
    if (!n) {
      this.error('先起个昵称吧');
      this.nickInput.focus();
      return '';
    }
    storageSet(NICK_KEY, n);
    return n;
  }

  get savedNick(): string {
    return this.nickInput.value.trim();
  }

  get visible(): boolean {
    return !$('lobby').classList.contains('hidden');
  }

  show() {
    $('lobby').classList.remove('hidden');
  }

  hide() {
    $('lobby').classList.add('hidden');
  }

  setStatus(text: string, ok: boolean) {
    const el = $('net-status');
    el.textContent = text;
    el.className = 'net-status ' + (ok ? 'ok' : 'bad');
  }

  error(msg: string) {
    const el = $('lobby-err');
    el.textContent = msg;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  showJoin(code = '') {
    this.room = null;
    if (code) this.codeInput.value = code.toUpperCase();
    $('lobby-join').classList.remove('hidden');
    $('lobby-room').classList.add('hidden');
    $('lobby-err').textContent = '';
  }

  showRoom(room: RoomInfo, myId: string) {
    this.room = room;
    this.myId = myId;
    $('lobby-join').classList.add('hidden');
    $('lobby-room').classList.remove('hidden');
    $('room-code-show').textContent = room.code;
    const s = room.settings;
    const host = this.isHost;
    $('room-players').innerHTML = room.players
      .map((p) => `<li class="${p.id === myId ? 'me' : ''}">
        <span class="dot" style="background:${this.palettes[p.color]?.css ?? '#fff'}"></span>
        <span class="pname">${esc(p.name)}</span>
        ${p.id === room.hostId ? '<span class="badge host">房主</span>' : ''}
        ${p.id === myId ? '<span class="badge you">你</span>' : ''}</li>`)
      .join('') + (room.players.length < 6 ? `<li class="empty">${s.ai ? `空位由 AI 补满（${6 - room.players.length} 辆）` : '等待朋友加入…'}</li>` : '');
    const me = room.players.find((p) => p.id === myId);
    const taken = new Set(room.players.filter((p) => p.id !== myId).map((p) => p.color));
    $('room-swatches').querySelectorAll('.swatch').forEach((e, i) => {
      e.classList.toggle('on', me?.color === i);
      e.classList.toggle('taken', taken.has(i));
    });
    const mark = (id: string, v: number) =>
      $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === v));
    mark('r-track', s.track);
    mark('r-mode', s.mode);
    mark('r-laps', s.laps);
    mark('r-ai', s.ai ? 1 : 0);
    $('room-settings').classList.toggle('readonly', !host);
    $('room-start').classList.toggle('hidden', !host);
    $('room-wait').classList.toggle('hidden', host);
    $('room-start').textContent = room.players.length > 1 || s.ai ? '开始比赛' : '开始比赛（只有你一个人）';
  }

  private copyLink() {
    if (!this.room) return;
    const url = `${location.origin}${location.pathname}?room=${this.room.code}`;
    const done = () => {
      $('copy-link').textContent = '已复制 ✓';
      setTimeout(() => { $('copy-link').textContent = '复制邀请链接'; }, 1500);
    };
    navigator.clipboard?.writeText(url).then(done, () => {
      window.prompt('复制这个链接发给朋友：', url);
    });
    if (!navigator.clipboard) window.prompt('复制这个链接发给朋友：', url);
  }
}
