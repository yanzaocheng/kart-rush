// Kart Rush online room server.
// Relay-style: each client simulates its own kart (the room host also simulates AI karts)
// and streams state; the server manages rooms, race start, and the authoritative finish order.
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_PLAYERS = 6;
const COLORS = 6;
const AI_NAMES = ['闪电', '旋风', '火箭', '疾风', '星辰', '雷霆'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FINISH_GRACE_MS = 45000; // after the first human finishes, others get this long

const rooms = new Map(); // code -> room
let nextId = 1;

const log = (...a) => console.log(new Date().toISOString(), ...a);

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function broadcast(room, obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const p of room.players.values()) if (p.id !== exceptId) send(p.ws, s);
}

function roomInfo(room) {
  return {
    type: 'room',
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    settings: room.settings,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
  };
}

function genCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function freeColor(room, wanted, selfId) {
  const used = new Set([...room.players.values()].filter((p) => p.id !== selfId).map((p) => p.color));
  if (!used.has(wanted)) return wanted;
  for (let i = 0; i < COLORS; i++) if (!used.has(i)) return i;
  return wanted;
}

function cleanName(n) {
  const s = String(n ?? '').replace(/[<>&"'\n\r\t]/g, '').trim().slice(0, 12);
  return s || '车手';
}

function joinRoom(p, room) {
  leaveRoom(p);
  p.color = freeColor(room, p.color, p.id);
  room.players.set(p.id, p);
  p.room = room;
  broadcast(room, roomInfo(room));
}

function leaveRoom(p) {
  const room = p.room;
  if (!room) return;
  room.players.delete(p.id);
  p.room = null;
  if (room.players.size === 0) {
    clearTimeout(room.endTimer);
    rooms.delete(room.code);
    log('room closed', room.code);
    return;
  }
  if (room.hostId === p.id) room.hostId = room.players.keys().next().value;
  broadcast(room, { type: 'left', id: p.id });
  broadcast(room, roomInfo(room));
  if (room.state === 'racing') checkEnd(room);
}

function startRace(room) {
  const humans = [...room.players.values()];
  const s = room.settings;
  const used = new Set(humans.map((h) => h.color));
  const karts = humans.map((h) => ({ id: h.id, name: h.name, color: h.color, human: true }));
  if (s.ai) {
    let n = 0;
    for (let c = 0; c < COLORS && karts.length < MAX_PLAYERS; c++) {
      if (used.has(c)) continue;
      karts.push({ id: 'ai' + n, name: AI_NAMES[n], color: c, human: false });
      n++;
    }
  }
  // humans get shuffled into the middle/back of the grid, AI fill the rest
  const grid = karts.map((k) => k.id);
  for (let i = grid.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [grid[i], grid[j]] = [grid[j], grid[i]];
  }
  room.state = 'racing';
  room.raceId++;
  room.finishes = [];
  room.humanIds = new Set(humans.map((h) => h.id));
  room.kartIds = new Set(karts.map((k) => k.id));
  clearTimeout(room.endTimer);
  room.endTimer = null;
  broadcast(room, { type: 'start', raceId: room.raceId, settings: s, karts, grid, hostId: room.hostId });
  broadcast(room, roomInfo(room));
  log('race start', room.code, 'humans', humans.length, 'karts', karts.length);
}

function endRace(room) {
  if (room.state !== 'racing') return;
  clearTimeout(room.endTimer);
  room.endTimer = null;
  room.state = 'lobby';
  broadcast(room, { type: 'end', raceId: room.raceId, finishes: room.finishes });
  broadcast(room, roomInfo(room));
  log('race end', room.code);
}

function checkEnd(room) {
  if (room.state !== 'racing') return;
  const present = [...room.humanIds].filter((id) => room.players.has(id));
  const done = present.every((id) => room.finishes.some((f) => f.kartId === id));
  if (present.length === 0 || done) {
    clearTimeout(room.endTimer);
    room.endTimer = setTimeout(() => endRace(room), 4000);
  }
}

const wss = new WebSocketServer({ host: HOST, port: PORT, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const p = { id: 'p' + nextId++, name: '车手', color: 0, ws, room: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'welcome', id: p.id });
  log('connect', p.id, req.headers['x-forwarded-for'] || req.socket.remoteAddress);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    const room = p.room;
    const isHost = room && room.hostId === p.id;

    switch (m.type) {
      case 'hello':
        p.name = cleanName(m.name);
        p.color = Math.max(0, Math.min(COLORS - 1, m.color | 0));
        if (room) {
          p.color = freeColor(room, p.color, p.id);
          broadcast(room, roomInfo(room));
        }
        break;
      case 'create': {
        const r = {
          code: genCode(), hostId: p.id, players: new Map(), state: 'lobby', raceId: 0,
          settings: { track: 0, mode: 0, laps: 3, ai: true }, finishes: [], humanIds: new Set(), kartIds: new Set(), endTimer: null,
        };
        rooms.set(r.code, r);
        joinRoom(p, r);
        log('room created', r.code, 'by', p.id);
        break;
      }
      case 'join': {
        const r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return send(ws, { type: 'error', msg: '房间不存在，检查一下房间码' });
        if (r === room) return send(ws, roomInfo(r));
        if (r.state !== 'lobby') return send(ws, { type: 'error', msg: '这个房间正在比赛中，等这一局结束再加入' });
        if (r.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', msg: '房间已满（最多 6 人）' });
        joinRoom(p, r);
        break;
      }
      case 'leave':
        leaveRoom(p);
        break;
      case 'color':
        if (room && room.state === 'lobby') {
          p.color = freeColor(room, Math.max(0, Math.min(COLORS - 1, m.color | 0)), p.id);
          broadcast(room, roomInfo(room));
        }
        break;
      case 'settings':
        if (isHost && room.state === 'lobby' && m.settings) {
          const s = m.settings;
          room.settings = {
            track: Math.max(0, Math.min(9, s.track | 0)),
            mode: s.mode ? 1 : 0,
            laps: [1, 3, 5].includes(s.laps) ? s.laps : 3,
            ai: !!s.ai,
          };
          broadcast(room, roomInfo(room));
        }
        break;
      case 'start':
        if (isHost && room.state === 'lobby') startRace(room);
        break;
      case 'state':
        // high-rate kart state stream: relay as-is to everyone else in the room
        if (room && room.state === 'racing' && Array.isArray(m.k)) {
          m.from = p.id;
          broadcast(room, m, p.id);
        }
        break;
      case 'ev':
        if (room && room.state === 'racing') {
          m.from = p.id;
          broadcast(room, m, p.id);
        }
        break;
      case 'finish': {
        if (!room || room.state !== 'racing' || m.raceId !== room.raceId) break;
        const kartId = String(m.kartId);
        if (!room.kartIds.has(kartId) || room.finishes.some((f) => f.kartId === kartId)) break;
        // players may only report themselves; the host reports AI karts
        if (kartId !== p.id && !(isHost && kartId.startsWith('ai'))) break;
        const f = { kartId, time: Number(m.time) || 0, place: room.finishes.length + 1 };
        room.finishes.push(f);
        broadcast(room, { type: 'finish', ...f });
        if (room.humanIds.has(kartId) && !room.endTimer) {
          room.endTimer = setTimeout(() => endRace(room), FINISH_GRACE_MS);
        }
        checkEnd(room);
        break;
      }
      case 'ping':
        send(ws, { type: 'pong', t: m.t });
        break;
    }
  });

  ws.on('close', () => {
    leaveRoom(p);
    log('disconnect', p.id);
  });
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

log(`kart-rush server listening on ${HOST}:${PORT}/ws`);
