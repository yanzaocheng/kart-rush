import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = true, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, count: number, size = 2) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * amount})`;
    const s = Math.random() * size + 0.5;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

/** Road: u across width (0..1), v along length. */
export function asphaltTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#4a4d55';
  ctx.fillRect(0, 0, 512, 512);
  // large soft blotches
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 20 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const d = Math.random() < 0.5;
    g.addColorStop(0, d ? 'rgba(30,32,38,0.18)' : 'rgba(110,112,120,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  noise(ctx, 512, 512, 0.12, 30000, 0.8);
  // racing line wear in the middle
  const wear = ctx.createLinearGradient(0, 0, 512, 0);
  wear.addColorStop(0.2, 'rgba(0,0,0,0)');
  wear.addColorStop(0.5, 'rgba(20,20,25,0.18)');
  wear.addColorStop(0.8, 'rgba(0,0,0,0)');
  ctx.fillStyle = wear;
  ctx.fillRect(0, 0, 512, 512);
  // edge lines
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(14, 0, 9, 512);
  ctx.fillRect(512 - 23, 0, 9, 512);
  // center dashes
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(252, 0, 8, 200);
  ctx.fillRect(252, 256, 8, 200);
  return toTexture(c);
}

export function curbTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 256);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#f5f5f5' : '#e0262b';
    ctx.fillRect(0, i * 64, 64, 64);
  }
  noise(ctx, 64, 256, 0.15, 800, 1);
  return toTexture(c);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#5c9a36';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 30 + Math.random() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tint = Math.random() < 0.5 ? 'rgba(120,175,60,0.35)' : 'rgba(55,110,40,0.35)';
    g.addColorStop(0, tint);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // grass blades
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const l = 60 + Math.random() * 90;
    ctx.strokeStyle = `rgba(${l},${l + 70 + Math.random() * 40},${30 + Math.random() * 30},0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 4);
    ctx.stroke();
  }
  return toTexture(c);
}

export function barrierTexture(colors: [string, string, string]): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 64);
  const cols = [colors[0], colors[1]];
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = cols[i % 2];
    ctx.fillRect(i * 64, 0, 64, 64);
  }
  ctx.fillStyle = colors[2];
  ctx.fillRect(0, 0, 512, 6);
  ctx.fillRect(0, 58, 512, 6);
  return toTexture(c);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 64);
  const s = 32;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fafafa';
      ctx.fillRect(x * s, y * s, s, s);
    }
  return toTexture(c, true);
}

export function boostPadTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#ff6a00');
  g.addColorStop(1, '#ffd000');
  ctx.fillStyle = '#1a1030';
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = g;
  for (let i = 0; i < 3; i++) {
    const y = 60 + i * 150;
    ctx.beginPath();
    ctx.moveTo(128, y);
    ctx.lineTo(236, y + 110);
    ctx.lineTo(186, y + 110);
    ctx.lineTo(128, y + 52);
    ctx.lineTo(70, y + 110);
    ctx.lineTo(20, y + 110);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = '#ffd000';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 502);
  return toTexture(c, false);
}

export function itemBoxTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, '#ff4fd8');
  g.addColorStop(0.5, '#6f7bff');
  g.addColorStop(1, '#27e0ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(10, 10, 236, 236);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 12;
  ctx.strokeRect(12, 12, 232, 232);
  ctx.font = 'bold 170px "Russo One", Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 12;
  ctx.fillText('?', 128, 140);
  return toTexture(c, false);
}

export function cloudTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  for (let i = 0; i < 26; i++) {
    const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, r = 18 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(c, false);
}

export function bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, bg);
  g.addColorStop(1, shade(bg, -40));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(0, 0, 1024, 6);
  ctx.fillRect(0, 122, 1024, 6);
  ctx.font = 'bold 86px "Russo One", Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.fillText(text, 512, 70);
  return toTexture(c, false);
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function crowdTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = '#2b3140';
  ctx.fillRect(0, 0, 512, 256);
  const cols = ['#ff5a5a', '#ffd23f', '#3ec1ff', '#ffffff', '#7cff6b', '#ff8ad8', '#ff9f1c'];
  for (let row = 0; row < 8; row++) {
    for (let i = 0; i < 40; i++) {
      const x = i * 13 + (row % 2) * 6 + Math.random() * 3;
      const y = row * 32 + 14;
      ctx.fillStyle = cols[(Math.random() * cols.length) | 0];
      ctx.fillRect(x, y, 9, 14);
      ctx.fillStyle = '#f1c9a5';
      ctx.beginPath();
      ctx.arc(x + 4.5, y - 3, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return toTexture(c);
}

export function numberTexture(n: number, color: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = 'bold 84px "Russo One", Arial Black, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(String(n), 64, 70);
  return toTexture(c, false);
}

export function sandTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 512);
  ctx.fillStyle = '#d99a62';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 30 + Math.random() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, Math.random() < 0.5 ? 'rgba(240,190,130,0.35)' : 'rgba(170,100,55,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // wind ripples
  for (let y = 0; y < 512; y += 7) {
    ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,220,170' : '150,90,50'},${0.12 + Math.random() * 0.12})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.037 + y * 0.3) * 3);
    ctx.stroke();
  }
  noise(ctx, 512, 512, 0.1, 12000, 1);
  return toTexture(c);
}
