import { Game } from './game';

async function boot() {
  // canvas textures use the web font, so wait for it (but never hang)
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]);
  try {
    await Promise.race([
      Promise.all([document.fonts.load('40px "Russo One"'), document.fonts.load('700 20px "Noto Sans SC"')]),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  } catch {
    /* offline: fall back to system fonts */
  }
  new Game(document.getElementById('app')!);
  requestAnimationFrame(() => document.getElementById('loading')!.remove());
}

boot();
