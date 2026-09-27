/** Thin WebSocket client for the online room server. */

export interface RoomSettings {
  track: number;
  mode: number; // 0 speed, 1 items
  laps: number;
  ai: boolean;
}

export interface RoomPlayer {
  id: string;
  name: string;
  color: number;
}

export interface RoomInfo {
  type: 'room';
  code: string;
  hostId: string;
  state: 'lobby' | 'racing';
  settings: RoomSettings;
  players: RoomPlayer[];
}

export interface StartKart {
  id: string;
  name: string;
  color: number;
  human: boolean;
}

export interface StartMsg {
  type: 'start';
  raceId: number;
  settings: RoomSettings;
  karts: StartKart[];
  grid: string[];
  hostId: string;
}

export interface FinishMsg {
  type: 'finish';
  kartId: string;
  time: number;
  place: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Msg = { type: string; [k: string]: any };

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, ((m: Msg) => void)[]>();
  id = '';
  rtt = 0;
  private pingTimer = 0;
  onClose: (() => void) | null = null;

  static url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(Net.url());
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); reject(new Error('连接超时')); }, 8000);
      ws.onmessage = (e) => {
        let m: Msg;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'welcome') {
          this.id = m.id;
          clearTimeout(timer);
          resolve();
        } else if (m.type === 'pong') {
          this.rtt = performance.now() - m.t;
        }
        for (const h of this.handlers.get(m.type) ?? []) h(m);
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('无法连接到联机服务器')); };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (this.ws === ws) {
          this.ws = null;
          this.onClose?.();
        }
      };
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping', t: performance.now() }), 3000);
    });
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  on(type: string, fn: (m: Msg) => void) {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }

  send(obj: Msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    clearInterval(this.pingTimer);
    ws?.close();
  }
}
