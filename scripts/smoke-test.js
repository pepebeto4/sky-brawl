'use strict';
// Prueba de humo del servidor: dos clientes simulados juegan un combate completo.
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3917;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => { console.log((cond ? 'OK   ' : 'FAIL ') + msg); if (!cond) failures++; };

function client() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:' + PORT);
    const c = { ws, id: -1, code: '', snap: null, events: [], errs: [], send: (o) => ws.send(JSON.stringify(o)) };
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'joined') { c.id = m.id; c.code = m.code; }
      else if (m.t === 'err') c.errs.push(m.msg);
      else if (m.t === 's') { c.snap = m; for (const e of m.ev) c.events.push(e); }
    });
  });
}
async function until(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  console.log('TIMEOUT esperando: ' + label);
  return false;
}
const me = (c) => c.snap.p.find((p) => p.i === c.id);
const op = (c) => c.snap.p.find((p) => p.i !== c.id);
const NOINPUT = { t: 'input', mx: 0, mz: 0, jump: false, block: false };

async function run() {
  // HTTP estático
  let r = await fetch('http://localhost:' + PORT + '/health');
  check(r.status === 200, 'GET /health responde 200');
  r = await fetch('http://localhost:' + PORT + '/');
  check(r.status === 200 && (await r.text()).includes('Sky Brawl'), 'GET / sirve index.html');
  r = await fetch('http://localhost:' + PORT + '/%2e%2e/server.js');
  check(r.status !== 200, 'no se puede salir de public/ (' + r.status + ')');
  r = await fetch('http://localhost:' + PORT + '/models/no-existe.glb', { method: 'HEAD' });
  check(r.status === 404, 'HEAD a modelo inexistente da 404');

  // salas
  const A = await client();
  A.send({ t: 'create', name: 'Ana', skin: 2 });
  await until(() => A.code, 1000, 'create');
  check(/^[A-Z2-9]{4}$/.test(A.code), 'sala creada con código ' + A.code);

  const B0 = await client();
  B0.send({ t: 'join', code: 'ZZZZ', name: 'X', skin: 0 });
  await until(() => B0.errs.length, 1000, 'join inválido');
  check(B0.errs[0] === 'La sala no existe', 'unirse a sala inexistente da error');
  B0.ws.close();

  const B = await client();
  B.send({ t: 'join', code: A.code.toLowerCase(), name: 'Beto', skin: 4 });
  await until(() => B.id === 1 && B.snap, 1000, 'join');
  check(B.id === 1, 'segundo jugador entra con id 1 (código en minúsculas aceptado)');

  const C = await client();
  C.send({ t: 'join', code: A.code, name: 'C', skin: 0 });
  await until(() => C.errs.length, 1000, 'sala llena');
  check(C.errs[0] === 'La sala está llena', 'tercer jugador rechazado');
  C.ws.close();

  await until(() => A.snap && A.snap.ph === 'countdown' && A.snap.p.length === 2, 1500, 'countdown');
  check(op(A).n === 'Beto' && me(A).k === 2 && op(A).k === 4, 'snapshot con nombres y personajes');
  check(await until(() => A.snap.ph === 'fight', 5000, 'fight'), 'pasa de cuenta atrás a pelea');

  const dist = () => Math.hypot(me(A).x - op(A).x, me(A).z - op(A).z);
  const chase = (c) => {
    const m = me(c), o = op(c);
    const dx = o.x - m.x, dz = o.z - m.z, l = Math.hypot(dx, dz) || 1;
    c.send({ t: 'input', mx: dx / l, mz: dz / l, jump: false, block: false });
  };
  const closeIn = async () => {
    const t0 = Date.now();
    while (dist() > 1.3 && Date.now() - t0 < 4000) { chase(A); await sleep(33); }
    A.send(NOINPUT);
    await sleep(120);
  };

  await closeIn();
  check(dist() <= 1.45, 'A alcanza a B (distancia ' + dist().toFixed(2) + ')');

  // jab
  let hp = op(A).h;
  A.events.length = 0;
  A.send({ t: 'act', a: 'jab' });
  await until(() => op(A).h < hp, 1500, 'daño jab');
  check(op(A).h === hp - 6, 'jab quita 6 de vida (queda ' + op(A).h + ')');
  check(A.events.some((e) => e.e === 'hit' && e.id === 1 && !e.b), 'evento hit recibido');
  await sleep(700);

  // bloqueo
  B.send({ t: 'input', mx: 0, mz: 0, jump: false, block: true });
  await sleep(200);
  check(op(A).s === 'block', 'B entra en estado de bloqueo');
  await closeIn();
  hp = op(A).h;
  A.send({ t: 'act', a: 'jab' });
  await until(() => op(A).h < hp, 1500, 'chip jab');
  check(op(A).h === hp - 1, 'jab bloqueado solo quita 1 (queda ' + op(A).h + ')');
  B.send(NOINPUT);
  await sleep(700);

  // golpe fuerte
  await closeIn();
  hp = op(A).h;
  A.send({ t: 'act', a: 'heavy' });
  await until(() => op(A).h < hp, 2500, 'daño heavy');
  check(op(A).h === hp - 18, 'golpe fuerte quita 18 (queda ' + op(A).h + ')');

  // ronda 1 termina por ring-out: B camina hasta caer de la plataforma
  const tr = Date.now();
  while (A.snap.ph === 'fight' && Date.now() - tr < 8000) {
    B.send({ t: 'input', mx: 1, mz: 0, jump: false, block: false });
    await sleep(33);
  }
  A.send(NOINPUT);
  B.send(NOINPUT);
  check(A.events.some((e) => e.e === 'fall' && e.id === 1), 'B cae de la plataforma');
  check(A.events.some((e) => e.e === 'end' && e.why === 'ring' && e.w === 0), 'ring-out da la ronda a A');
  check(me(A).w === 1, 'A suma su primera victoria');
  check(await until(() => A.snap.ph === 'countdown' && A.snap.r === 2, 6000, 'ronda 2'), 'empieza la ronda 2');
  check(op(A).h === 100 && Math.abs(me(A).x + 4) < 0.01, 'vida y posiciones reiniciadas');

  // ronda 2 termina por KO: A golpea sin parar y B vuelve al centro entre golpes
  await until(() => A.snap.ph === 'fight', 5000, 'fight 2');
  A.events.length = 0;
  const tk = Date.now();
  while (A.snap.ph === 'fight' && Date.now() - tk < 30000) {
    chase(A);
    B.send({ t: 'input', mx: me(B).x > 0 ? -1 : 0, mz: 0, jump: false, block: false });
    if (dist() < 1.45) A.send({ t: 'act', a: 'cross' });
    await sleep(33);
  }
  A.send(NOINPUT);
  B.send(NOINPUT);
  check(A.events.some((e) => e.e === 'end' && e.w === 0 && e.why === 'ko'), 'el KO termina la ronda con ganador A');
  check(op(A).h === 0, 'B queda sin vida');
  check(await until(() => A.snap.ph === 'matchEnd', 6000, 'matchEnd'), 'A gana 2-0 y acaba el combate');
  check(A.events.some((e) => e.e === 'match' && e.w === 0), 'evento match con ganador A');

  // revancha
  A.send({ t: 'rematch' });
  await sleep(150);
  check(A.snap.ph === 'matchEnd' && me(A).rm === 1, 'revancha pendiente hasta que acepte el rival');
  B.send({ t: 'rematch' });
  check(await until(() => A.snap.ph === 'countdown' && A.snap.r === 1 && me(A).w === 0, 2000, 'revancha'), 'la revancha reinicia el marcador');

  // desconexión
  B.ws.close();
  check(await until(() => A.snap.ph === 'waiting' && A.snap.p.length === 1, 2000, 'waiting'), 'si el rival se va, la sala vuelve a espera');
  A.ws.close();
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((r) => srv.stdout.on('data', (d) => { if (String(d).includes('puerto')) r(); }));
  try { await run(); } catch (e) { console.log('ERROR', e); failures++; }
  srv.kill();
  console.log(failures ? failures + ' fallo(s)' : 'TODO OK');
  process.exit(failures ? 1 : 0);
})();
