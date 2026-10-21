'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

/* ---------------- constantes de juego ---------------- */
const R = 12;               // radio de la plataforma
const G = 24;               // gravedad
const MAX_HP = 100;
const ROUND_TIME = 90;      // segundos por ronda
const WINS_NEEDED = 2;      // mejor de 3
const COUNTDOWN = 3.2;
const ROUND_END = 3.2;
const DT = 1 / 60;

const ATK = {
  jab:   { dur: 0.38, hit: 0.12, dmg: 6,  range: 1.5,  kb: 3.2, stun: 0.24, lunge: 1.6, heavy: false },
  cross: { dur: 0.50, hit: 0.17, dmg: 9,  range: 1.6,  kb: 4.6, stun: 0.30, lunge: 2.4, heavy: false },
  heavy: { dur: 0.90, hit: 0.45, dmg: 18, range: 1.85, kb: 11,  stun: 0.60, lunge: 3.6, heavy: true  },
};

/* ---------------- http + ws ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');

function serve(req, res) {
  let url;
  try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (url === '/health') { res.writeHead(200); res.end('ok'); return; }
  let base = PUBLIC_DIR, rel = url;
  if (url.startsWith('/vendor/three/')) { base = THREE_DIR; rel = url.slice('/vendor/three'.length); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(serve);
const wss = new WebSocketServer({ server, maxPayload: 2048 });

const rooms = new Map();

/* ---------------- utilidades ---------------- */
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function cleanName(n) {
  const s = String(n == null ? '' : n).replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14);
  return s || 'Jugador';
}
function cleanSkin(k) {
  const i = parseInt(k, 10);
  return Number.isFinite(i) ? Math.max(0, Math.min(5, i)) : 0;
}
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
  } while (rooms.has(c));
  return c;
}

/* ---------------- salas y jugadores ---------------- */
function createRoom() {
  const room = { code: makeCode(), players: [], phase: 'waiting', tm: 0, round: 1, events: [], clock: 0, lastWinner: null };
  rooms.set(room.code, room);
  return room;
}

function newPlayer(ws, name, skin) {
  return {
    ws, id: 0, room: null, name, skin,
    x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, yaw: 0,
    hp: MAX_HP, state: 'idle', stateT: 0, stateDur: 0, hitDone: false,
    fallen: false, dodgeCd: 0, speed: 0,
    input: { mx: 0, mz: 0, jump: false, block: false },
    buf: null, wins: 0, rematch: false,
  };
}

function resetForRound(room) {
  room.players.forEach((p, i) => {
    p.id = i;
    p.x = i === 0 ? -4 : 4; p.z = 0; p.y = 0;
    p.vx = p.vz = p.vy = p.kx = p.kz = 0;
    p.yaw = i === 0 ? Math.PI / 2 : -Math.PI / 2;
    p.hp = MAX_HP;
    p.state = 'idle'; p.stateT = 0; p.stateDur = 0; p.hitDone = false;
    p.fallen = false; p.dodgeCd = 0; p.buf = null; p.rematch = false; p.speed = 0;
    p.input = { mx: 0, mz: 0, jump: false, block: false };
  });
}

function startRound(room) {
  resetForRound(room);
  room.phase = 'countdown';
  room.tm = COUNTDOWN;
  room.lastWinner = null;
  room.events.push({ e: 'round', r: room.round });
}

function addPlayer(room, p) {
  p.room = room;
  p.id = room.players.length;
  room.players.push(p);
  resetForRound(room);
}

function leave(p) {
  const room = p.room;
  if (!room) return;
  p.room = null;
  room.players = room.players.filter((x) => x !== p);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  const q = room.players[0];
  q.wins = 0;
  room.phase = 'waiting';
  room.round = 1;
  room.tm = 0;
  room.lastWinner = null;
  resetForRound(room);
  room.events.push({ e: 'left' });
  send(q.ws, { t: 'joined', code: room.code, id: q.id });
}

/* ---------------- combate ---------------- */
function startAttack(room, p, name) {
  const A = ATK[name];
  p.state = name; p.stateT = 0; p.stateDur = A.dur; p.hitDone = false;
  p.kx += Math.sin(p.yaw) * A.lunge;
  p.kz += Math.cos(p.yaw) * A.lunge;
  room.events.push({ e: 'sw', id: p.id, hv: A.heavy ? 1 : 0 });
}

function startDodge(room, p) {
  let dx = p.input.mx, dz = p.input.mz;
  const l = Math.hypot(dx, dz);
  if (l < 0.2) { dx = -Math.sin(p.yaw); dz = -Math.cos(p.yaw); } else { dx /= l; dz /= l; }
  p.kx = dx * 13; p.kz = dz * 13;
  p.state = 'dodge'; p.stateT = 0; p.stateDur = 0.3; p.dodgeCd = 0.9; p.hitDone = true;
  room.events.push({ e: 'dodge', id: p.id });
}

function tryHit(room, a, d, A) {
  if (d.fallen || d.state === 'ko') return;
  const dx = d.x - a.x, dz = d.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist > A.range) return;
  if (dist > 0.001) {
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    if ((dx * fx + dz * fz) / dist < 0.5) return;
  }
  if (Math.abs(d.y - a.y) > 1.3) return;
  if (d.state === 'dodge' && d.stateT < 0.22) {
    room.events.push({ e: 'evade', id: d.id });
    return;
  }
  const nx = dist > 0.001 ? dx / dist : Math.sin(a.yaw);
  const nz = dist > 0.001 ? dz / dist : Math.cos(a.yaw);
  const blocked = d.state === 'block';
  let dmg = A.dmg, kb = A.kb, stun = A.stun;
  if (blocked) {
    if (A.heavy) { dmg = A.dmg * 0.4; kb = A.kb * 0.6; stun = 0.25; }
    else { dmg = 1; kb = A.kb * 0.35; stun = 0; }
  }
  d.hp = Math.max(0, d.hp - dmg);
  d.kx += nx * kb; d.kz += nz * kb;
  if (stun > 0) {
    d.state = 'hit'; d.stateT = 0; d.stateDur = stun; d.hitDone = true; d.buf = null;
    if (A.heavy && d.y <= 0.001) d.vy = 3.5;
  }
  room.events.push({
    e: 'hit', id: d.id,
    x: +d.x.toFixed(2), y: +(d.y + 1.3).toFixed(2), z: +d.z.toFixed(2),
    b: blocked ? 1 : 0, hv: A.heavy ? 1 : 0, dmg: Math.round(dmg),
  });
  if (d.hp <= 0) endRound(room, a, 'ko');
}

function endRound(room, winner, why) {
  if (room.phase !== 'fight') return;
  room.phase = 'roundEnd';
  room.tm = ROUND_END;
  room.lastWinner = winner;
  if (winner) {
    winner.wins++;
    if (!winner.fallen) { winner.state = 'win'; winner.stateT = 0; winner.stateDur = 0; }
    const loser = room.players.find((x) => x !== winner);
    if (loser && why === 'ko') { loser.state = 'ko'; loser.stateT = 0; loser.stateDur = 0; loser.vy = 0; }
  }
  room.events.push({ e: 'end', w: winner ? winner.id : -1, why });
}

function stepPlayer(room, p, o, dt, canAct) {
  p.stateT += dt;
  p.dodgeCd = Math.max(0, p.dodgeCd - dt);
  const dist0 = Math.hypot(p.x, p.z);
  const grounded = !p.fallen && p.y <= 0.001 && dist0 <= R && p.vy <= 0;

  // orientación automática hacia el rival
  if (!p.fallen && Math.abs(o.x - p.x) + Math.abs(o.z - p.z) > 0.01) {
    p.yaw = Math.atan2(o.x - p.x, o.z - p.z);
  }

  // fin de estados temporizados
  if (p.stateDur > 0 && p.stateT >= p.stateDur && (ATK[p.state] || p.state === 'hit' || p.state === 'dodge')) {
    p.state = 'idle'; p.stateT = 0; p.stateDur = 0;
  }

  if (canAct && !p.fallen) {
    if (p.state === 'idle' && p.input.block) { p.state = 'block'; p.stateT = 0; }
    else if (p.state === 'block' && !p.input.block) { p.state = 'idle'; p.stateT = 0; }

    if (p.buf) {
      if (room.clock - p.buf.t > 0.25) p.buf = null;
      else if (p.state === 'idle' || p.state === 'block') {
        const a = p.buf.a;
        if (a === 'dodge') {
          if (p.dodgeCd <= 0) { startDodge(room, p); p.buf = null; }
        } else { startAttack(room, p, a); p.buf = null; }
      }
    }
    if (p.input.jump && grounded && (p.state === 'idle' || p.state === 'block')) {
      p.vy = 8;
      room.events.push({ e: 'jump', id: p.id });
    }
  }

  // movimiento
  const mv = canAct && !p.fallen;
  let sp = 0;
  if (mv) {
    if (p.state === 'idle') sp = 5.2;
    else if (p.state === 'block') sp = 2.4;
    else if (p.state === 'jab' || p.state === 'cross') sp = 1.6;
    else if (p.state === 'heavy') sp = 0.8;
  }
  const tx = mv ? p.input.mx * sp : 0;
  const tz = mv ? p.input.mz * sp : 0;
  const acc = (grounded ? 50 : 14) * dt;
  p.vx = approach(p.vx, tx, acc);
  p.vz = approach(p.vz, tz, acc);
  const kd = Math.exp(-(grounded ? 4 : 1.2) * dt);
  p.kx *= kd; p.kz *= kd;
  p.x += (p.vx + p.kx) * dt;
  p.z += (p.vz + p.kz) * dt;
  p.speed = Math.hypot(p.vx, p.vz);

  // vertical
  if (!grounded) p.vy -= G * dt;
  p.y += p.vy * dt;
  const d2 = Math.hypot(p.x, p.z);
  if (!p.fallen) {
    if (p.y <= 0 && d2 <= R && p.vy <= 0) { p.y = 0; p.vy = 0; }
    else if (p.y < -0.4) {
      p.fallen = true; p.state = 'fall'; p.stateT = 0; p.stateDur = 0; p.buf = null;
      room.events.push({ e: 'fall', id: p.id });
    }
  }

  // golpe activo
  const A = ATK[p.state];
  if (A && !p.hitDone && p.stateT >= A.hit) {
    p.hitDone = true;
    if (room.phase === 'fight') tryHit(room, p, o, A);
  }
}

function separate(a, b) {
  if (a.fallen || b.fallen || Math.abs(a.y - b.y) > 1.2) return;
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = 0.9;
  if (d < min) {
    const nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
    const push = (min - d) / 2;
    a.x -= nx * push; a.z -= nz * push;
    b.x += nx * push; b.z += nz * push;
  }
}

function stepRoom(room, dt) {
  room.clock += dt;
  if (room.phase === 'waiting' || room.players.length < 2) return;
  const [a, b] = room.players;
  const canAct = room.phase === 'fight';
  stepPlayer(room, a, b, dt, canAct);
  stepPlayer(room, b, a, dt, canAct);
  separate(a, b);

  if (room.phase === 'matchEnd') return;
  room.tm -= dt;

  if (room.phase === 'countdown') {
    if (room.tm <= 0) { room.phase = 'fight'; room.tm = ROUND_TIME; room.events.push({ e: 'fight' }); }
  } else if (room.phase === 'fight') {
    for (const p of [a, b]) {
      if (p.fallen && p.y < -6) { endRound(room, p === a ? b : a, 'ring'); break; }
    }
    if (room.phase === 'fight' && room.tm <= 0) {
      const w = a.hp > b.hp ? a : b.hp > a.hp ? b : null;
      endRound(room, w, 'time');
    }
  } else if (room.phase === 'roundEnd' && room.tm <= 0) {
    const w = room.lastWinner;
    if (w && w.wins >= WINS_NEEDED) {
      room.phase = 'matchEnd';
      room.events.push({ e: 'match', w: w.id });
    } else {
      if (w) room.round++;
      startRound(room);
    }
  }
}

/* ---------------- red ---------------- */
function snapshot(room) {
  const r = (n) => Math.round(n * 100) / 100;
  return JSON.stringify({
    t: 's', ph: room.phase, tm: r(Math.max(0, room.tm)), r: room.round,
    p: room.players.map((p) => ({
      i: p.id, n: p.name, k: p.skin,
      x: r(p.x), y: r(p.y), z: r(p.z), a: r(p.yaw),
      h: Math.round(p.hp * 10) / 10,
      s: p.state, t: r(p.stateT), d: r(p.stateDur),
      v: r(p.speed), w: p.wins, rm: p.rematch ? 1 : 0,
    })),
    ev: room.events,
  });
}

function broadcast(room) {
  if (room.players.length === 0) return;
  const msg = snapshot(room);
  room.events = [];
  for (const p of room.players) if (p.ws.readyState === 1) p.ws.send(msg);
}

let acc = 0, last = process.hrtime.bigint(), tick = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Math.min(0.1, Number(now - last) / 1e9);
  last = now;
  while (acc >= DT) {
    for (const room of rooms.values()) stepRoom(room, DT);
    acc -= DT;
    tick++;
    if (tick % 2 === 0) for (const room of rooms.values()) broadcast(room);
  }
}, 8);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let p = null;
  let count = 0;
  const rl = setInterval(() => { count = 0; }, 1000);

  ws.on('message', (raw) => {
    if (++count > 200) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    switch (m.t) {
      case 'ping':
        send(ws, { t: 'pong', ts: m.ts });
        break;
      case 'create': {
        if (p) return;
        p = newPlayer(ws, cleanName(m.name), cleanSkin(m.skin));
        const room = createRoom();
        addPlayer(room, p);
        send(ws, { t: 'joined', code: room.code, id: p.id });
        break;
      }
      case 'join': {
        if (p) return;
        const room = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!room) { send(ws, { t: 'err', msg: 'La sala no existe' }); return; }
        if (room.players.length >= 2) { send(ws, { t: 'err', msg: 'La sala está llena' }); return; }
        p = newPlayer(ws, cleanName(m.name), cleanSkin(m.skin));
        addPlayer(room, p);
        send(ws, { t: 'joined', code: room.code, id: p.id });
        room.round = 1;
        room.players.forEach((x) => { x.wins = 0; });
        startRound(room);
        break;
      }
      case 'input': {
        if (!p || !p.room) return;
        let mx = Number(m.mx), mz = Number(m.mz);
        if (!Number.isFinite(mx) || !Number.isFinite(mz)) return;
        const l = Math.hypot(mx, mz);
        if (l > 1) { mx /= l; mz /= l; }
        p.input = { mx, mz, jump: !!m.jump, block: !!m.block };
        break;
      }
      case 'act':
        if (!p || !p.room) return;
        if (m.a === 'jab' || m.a === 'cross' || m.a === 'heavy' || m.a === 'dodge') {
          p.buf = { a: m.a, t: p.room.clock };
        }
        break;
      case 'rematch': {
        if (!p || !p.room || p.room.phase !== 'matchEnd') return;
        p.rematch = true;
        const room = p.room;
        if (room.players.length === 2 && room.players.every((x) => x.rematch)) {
          room.round = 1;
          room.players.forEach((x) => { x.wins = 0; });
          startRound(room);
        }
        break;
      }
      case 'leave':
        if (p) { leave(p); p = null; }
        break;
      default:
    }
  });

  ws.on('close', () => {
    clearInterval(rl);
    if (p) leave(p);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => console.log('Sky Brawl: servidor en el puerto ' + PORT));
