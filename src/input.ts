import { KartInput } from './kart';

export type Scheme = 'solo' | 'p1' | 'p2';

interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  drift: string[];
  item: string[];
  respawn: string[];
}

const MAPS: Record<Scheme, KeyMap> = {
  solo: {
    up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    drift: ['ShiftLeft', 'ShiftRight', 'Space', 'KeyJ'], item: ['ControlLeft', 'ControlRight', 'KeyK', 'KeyE'], respawn: ['KeyR'],
  },
  p1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    drift: ['ShiftLeft', 'Space'], item: ['KeyQ', 'KeyE'], respawn: ['KeyR'],
  },
  p2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    drift: ['ShiftRight', 'Slash', 'Numpad0'], item: ['ControlRight', 'Period', 'NumpadDecimal'], respawn: ['Backslash', 'Numpad5'],
  },
};

/** Human-readable key hints per scheme (used in HUD & menu). */
export const KEY_HINTS: Record<Scheme, { move: string; drift: string; item: string; respawn: string }> = {
  solo: { move: '方向键 / WASD', drift: 'Shift / Space', item: 'Ctrl / K', respawn: 'R' },
  p1: { move: 'WASD', drift: '左Shift / Space', item: 'Q / E', respawn: 'R' },
  p2: { move: '方向键', drift: '右Shift / ?', item: '右Ctrl / .', respawn: '\\' },
};

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      // typing into a text box (nickname, room code) must not drive the kart
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Quote'].includes(e.code)) e.preventDefault();
      if (e.code.startsWith('Control')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /** true once per key press */
  hit(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  endFrame() {
    this.pressed.clear();
  }

  private pad(n: number): Gamepad | null {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p): p is Gamepad => !!p && p.connected) : [];
    return pads[n] ?? null;
  }

  respawnHit(scheme: Scheme): boolean {
    return this.hit(...MAPS[scheme].respawn);
  }

  read(scheme: Scheme = 'solo'): KartInput {
    const m = MAPS[scheme];
    let throttle = this.down(...m.up) ? 1 : 0;
    let brake = this.down(...m.down) ? 1 : 0;
    let steer = (this.down(...m.left) ? 1 : 0) - (this.down(...m.right) ? 1 : 0);
    let drift = this.down(...m.drift);
    // also count taps that went down+up between two frames
    let nitro = this.down(...m.item) || this.hit(...m.item);
    const gp = this.pad(scheme === 'p2' ? 1 : 0);
    if (gp) {
      const ax = gp.axes[0] ?? 0;
      if (Math.abs(ax) > 0.15) steer = -ax;
      if (gp.buttons[14]?.pressed) steer = 1;
      if (gp.buttons[15]?.pressed) steer = -1;
      throttle = Math.max(throttle, gp.buttons[7]?.value ?? 0, gp.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, gp.buttons[6]?.value ?? 0);
      drift = drift || !!gp.buttons[5]?.pressed || !!gp.buttons[4]?.pressed;
      nitro = nitro || !!gp.buttons[2]?.pressed || !!gp.buttons[1]?.pressed;
    }
    return { throttle, brake, steer, drift, nitro };
  }
}
