import * as THREE from 'three';
import { buildFighter, tryAttachGLB, SKINS } from './fighter.js';
import { buildWorld } from './world.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function lerpAngle(a, b, k) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
}

/* ---------------- renderer y escena ---------------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1200);
const world = buildWorld(scene, camera);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ---------------- estado ---------------- */
const S = { ws: null, id: -1, code: '', screen: 'menu', snap: null, phase: '', count: -1, ping: 0 };
const disp = [null, null];
const cam = { base: 0, orbit: 0, yaw: 0, pitch: 0.24, lastMouse: 0, init: false, shake: 0 };
const keys = new Set();
let skinIdx = 0;

try {
  skinIdx = clamp(parseInt(localStorage.getItem('sb_skin') || '0', 10) || 0, 0, SKINS.length - 1);
  $('name').value = localStorage.getItem('sb_name') || '';
} catch { /* sin almacenamiento */ }
const urlParams = new URLSearchParams(location.search);
if (urlParams.get('sala')) $('code').value = urlParams.get('sala').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

const glbUrl = (i) => '/models/' + SKINS[i].name.toLowerCase() + '.glb';

/* ---------------- luchadores ---------------- */
function ensureFighter(i, skin) {
  let d = disp[i];
  if (d && d.skin === skin) return d;
  if (d) scene.remove(d.f.root);
  const f = buildFighter(SKINS[skin] || SKINS[0]);
  scene.add(f.root);
  tryAttachGLB(f, glbUrl(skin));
  d = { f, skin, tgt: null, x: 0, y: 0, z: 0, yaw: 0, init: false, recvAt: 0 };
  disp[i] = d;
  return d;
}
function removeFighter(i) {
  if (disp[i]) { scene.remove(disp[i].f.root); disp[i] = null; }
}

/* ---------------- partículas ---------------- */
const parts = [];
const pGeo = new THREE.SphereGeometry(0.09, 6, 5);
const ringGeo = new THREE.RingGeometry(0.22, 0.3, 28);
function burst(x, y, z, color, n, speed) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
    const v = new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b) + 0.6, Math.sin(a) * Math.cos(b))
      .multiplyScalar(speed * (0.5 + Math.random()));
    parts.push({ m, v, life: 0.45 + Math.random() * 0.3, t: 0, ring: false });
    scene.add(m);
  }
}
function shockRing(x, y, z, color) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, y, z);
  m.lookAt(camera.position);
  parts.push({ m, v: null, life: 0.3, t: 0, ring: true });
  scene.add(m);
}
function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.t += dt;
    if (p.t >= p.life) { scene.remove(p.m); p.m.material.dispose(); parts.splice(i, 1); continue; }
    const k = p.t / p.life;
    if (p.ring) p.m.scale.setScalar(0.3 + k * 3.4);
    else { p.v.y -= 9 * dt; p.m.position.addScaledVector(p.v, dt); p.m.scale.setScalar(1 - k * 0.7); }
    p.m.material.opacity = 1 - k;
  }
}

/* ---------------- previsualización del menú ---------------- */
const pCanvas = $('preview');
const pRenderer = new THREE.WebGLRenderer({ canvas: pCanvas, antialias: true, alpha: true });
pRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
pRenderer.setSize(260, 320, false);
const pScene = new THREE.Scene();
const pCam = new THREE.PerspectiveCamera(32, 260 / 320, 0.1, 50);
pCam.position.set(0, 1.3, 7);
pCam.lookAt(0, 1.05, 0);
pScene.add(new THREE.HemisphereLight(0xffe0c0, 0x6a4a8a, 1.3));
const pLight = new THREE.DirectionalLight(0xffffff, 2.2);
pLight.position.set(3, 5, 4);
pScene.add(pLight);
let pFighter = null;
function setPreview(i) {
  if (pFighter) pScene.remove(pFighter.root);
  pFighter = buildFighter(SKINS[i]);
  pScene.add(pFighter.root);
  tryAttachGLB(pFighter, glbUrl(i));
  $('skinName').textContent = SKINS[i].name;
}
setPreview(skinIdx);
$('prev').onclick = () => { skinIdx = (skinIdx + SKINS.length - 1) % SKINS.length; setPreview(skinIdx); };
$('next').onclick = () => { skinIdx = (skinIdx + 1) % SKINS.length; setPreview(skinIdx); };

/* ---------------- pantallas ---------------- */
function setScreen(name) {
  if (S.screen === name) return;
  S.screen = name;
  $('menu').classList.toggle('hidden', name !== 'menu');
  $('lobby').classList.toggle('hidden', name !== 'lobby');
  $('hud').classList.toggle('hidden', name !== 'game');
  if (name !== 'game' && document.pointerLockElement) document.exitPointerLock();
  updateLockHint();
}
function setMenuErr(msg) { $('menuErr').textContent = msg || ''; }
function updateLockHint() {
  $('lockHint').classList.toggle('hidden', S.screen !== 'game' || !!document.pointerLockElement);
}
document.addEventListener('pointerlockchange', updateLockHint);

let msgTimer = 0;
function showMsg(big, sub = '', ms = 1500) {
  const m = $('msg');
  m.textContent = '';
  const b = document.createElement('div');
  b.className = 'big';
  b.textContent = big;
  m.appendChild(b);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'sub';
    s.textContent = sub;
    m.appendChild(s);
  }
  m.classList.remove('pop');
  void m.offsetWidth;
  m.classList.add('pop');
  m.style.opacity = 1;
  clearTimeout(msgTimer);
  if (ms > 0) msgTimer = setTimeout(() => { m.style.opacity = 0; }, ms);
}

function showMenu(err) {
  if (S.ws) { const ws = S.ws; S.ws = null; try { ws.close(); } catch { /* nada */ } }
  removeFighter(0); removeFighter(1);
  S.id = -1; S.phase = ''; S.snap = null; S.count = -1;
  keys.clear();
  setScreen('menu');
  setMenuErr(err || '');
  $('msg').style.opacity = 0;
  $('rematch').classList.add('hidden');
}

/* ---------------- red ---------------- */
function connect() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(proto + '://' + location.host);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('conexión'));
  });
}

async function enter(kind) {
  audio.initAudio();
  setMenuErr('');
  const name = $('name').value.trim().slice(0, 14) || 'Jugador';
  try {
    localStorage.setItem('sb_name', $('name').value.trim());
    localStorage.setItem('sb_skin', String(skinIdx));
  } catch { /* nada */ }
  $('btnCreate').disabled = $('btnJoin').disabled = true;
  try {
    const ws = await connect();
    S.ws = ws;
    ws.onmessage = onMessage;
    ws.onclose = () => { if (S.ws === ws) { S.ws = null; showMenu('Conexión perdida con el servidor'); } };
    ws.send(JSON.stringify(kind === 'create'
      ? { t: 'create', name, skin: skinIdx }
      : { t: 'join', code: $('code').value.trim(), name, skin: skinIdx }));
  } catch {
    setMenuErr('No se pudo conectar con el servidor');
  }
  $('btnCreate').disabled = $('btnJoin').disabled = false;
}

function send(o) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); }

function onMessage(ev) {
  let m;
  try { m = JSON.parse(ev.data); } catch { return; }
  if (m.t === 's') onSnap(m);
  else if (m.t === 'joined') {
    S.id = m.id; S.code = m.code; S.phase = '';
    removeFighter(0); removeFighter(1);
    $('roomCode').textContent = m.code;
    $('roomLink').textContent = location.origin + '/?sala=' + m.code;
    setScreen('lobby');
  } else if (m.t === 'pong') {
    S.ping = Math.round(performance.now() - m.ts);
    $('ping').textContent = S.ping + ' ms';
  } else if (m.t === 'err') {
    const ws = S.ws; S.ws = null;
    if (ws) ws.close();
    setMenuErr(m.msg);
  }
}
setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);

function onSnap(s) {
  const now = performance.now();
  S.snap = s;
  for (const p of s.p) {
    const d = ensureFighter(p.i, p.k);
    d.tgt = p; d.recvAt = now;
    if (!d.init) { d.x = p.x; d.y = p.y; d.z = p.z; d.yaw = p.a; d.init = true; }
  }
  for (let i = 0; i < 2; i++) if (disp[i] && !s.p.some((p) => p.i === i)) removeFighter(i);
  if (s.ph !== S.phase) { S.phase = s.ph; S.count = -1; }
  setScreen(s.ph === 'waiting' ? 'lobby' : 'game');
  for (const e of s.ev) handleEvent(e);
  if (s.ph === 'countdown') {
    const n = Math.ceil(s.tm - 0.2);
    if (n >= 1 && n <= 3 && n !== S.count) { S.count = n; showMsg(String(n), 'RONDA ' + s.r, 900); audio.sfx.count(n); }
  }
  updateHUD(s);
}

function handleEvent(e) {
  switch (e.e) {
    case 'sw': audio.sfx.whoosh(e.hv); break;
    case 'jump': audio.sfx.jump(); break;
    case 'dodge': case 'evade': audio.sfx.dodge(); break;
    case 'fall': audio.sfx.fall(); break;
    case 'hit': {
      audio.sfx.hit(e.hv, e.b);
      const col = e.b ? 0x9ad1ff : (e.hv ? 0xff7a3d : 0xffe066);
      burst(e.x, e.y, e.z, col, e.hv ? 20 : 12, e.hv ? 6 : 4);
      if (e.hv && !e.b) shockRing(e.x, e.y, e.z, 0xfff2b0);
      if (e.id === S.id) {
        if (!e.b) { $('flash').style.opacity = e.hv ? 0.7 : 0.45; setTimeout(() => { $('flash').style.opacity = 0; }, 80); }
        cam.shake = Math.max(cam.shake, e.hv ? 0.5 : 0.2);
      } else cam.shake = Math.max(cam.shake, e.hv ? 0.25 : 0.1);
      break;
    }
    case 'fight': audio.sfx.bell(); showMsg('¡PELEA!', '', 900); break;
    case 'end': {
      if (e.why === 'ko' || e.why === 'ring') audio.sfx.ko();
      const big = e.w === -1 ? 'EMPATE' : e.why === 'ko' ? '¡K.O.!' : e.why === 'ring' ? '¡FUERA DEL RING!' : '¡TIEMPO!';
      const sub = e.w === -1 ? 'La ronda se repite' : e.w === S.id ? 'Ganas la ronda' : 'Pierdes la ronda';
      showMsg(big, sub, 0);
      break;
    }
    case 'match': {
      const won = e.w === S.id;
      if (won) audio.sfx.win(); else audio.sfx.lose();
      showMsg(won ? '¡VICTORIA!' : 'DERROTA', '', 0);
      break;
    }
    case 'left': $('lobbyInfo').textContent = 'El rival se ha ido. Esperando a otro jugador…'; break;
    default:
  }
}

function updateHUD(s) {
  const me = s.p.find((p) => p.i === S.id);
  const op = s.p.find((p) => p.i !== S.id);
  const side = (n, p) => {
    $('n' + n).textContent = p ? p.n + (n === 0 ? ' (tú)' : '') : '—';
    const pct = p ? Math.max(0, p.h) : 0;
    $('f' + n).style.width = pct + '%';
    $('t' + n).style.width = pct + '%';
    $('f' + n).classList.toggle('low', pct <= 30);
    const pips = $('p' + n).children;
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', !!p && i < p.w);
  };
  side(0, me); side(1, op);
  $('roundLbl').textContent = 'RONDA ' + s.r;
  $('timer').textContent = s.ph === 'fight' ? String(Math.max(0, Math.ceil(s.tm))) : '90';
  const rm = $('rematch');
  rm.classList.toggle('hidden', s.ph !== 'matchEnd');
  if (s.ph === 'matchEnd') {
    rm.disabled = !!(me && me.rm);
    rm.textContent = me && me.rm ? 'Esperando al rival…' : 'Revancha';
  }
}

/* ---------------- entrada ---------------- */
function act(a) { if (S.phase === 'fight') send({ t: 'act', a }); }

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'KeyM') { audio.toggleMusic(); return; }
  if (S.screen !== 'game') return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  switch (e.code) {
    case 'KeyJ': act('jab'); break;
    case 'KeyK': act('cross'); break;
    case 'KeyE': case 'KeyL': act('heavy'); break;
    case 'ShiftLeft': case 'ShiftRight': act('dodge'); break;
    default:
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

window.addEventListener('mousedown', (e) => {
  if (S.screen !== 'game' || (e.target.closest && e.target.closest('button'))) return;
  if (!document.pointerLockElement && canvas.requestPointerLock) canvas.requestPointerLock();
  if (e.button === 0) act('jab');
  else if (e.button === 2) act('cross');
});
window.addEventListener('contextmenu', (e) => { if (S.screen === 'game') e.preventDefault(); });
window.addEventListener('mousemove', (e) => {
  if (S.screen !== 'game' || !document.pointerLockElement) return;
  cam.orbit -= e.movementX * 0.0028;
  cam.pitch = clamp(cam.pitch + e.movementY * 0.0018, -0.05, 0.75);
  cam.lastMouse = performance.now();
});

setInterval(() => {
  if (S.screen !== 'game') return;
  const fw = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const rt = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const c = cam.yaw;
  let mx = Math.sin(c) * fw - Math.cos(c) * rt;
  let mz = Math.cos(c) * fw + Math.sin(c) * rt;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  send({ t: 'input', mx: +mx.toFixed(3), mz: +mz.toFixed(3), jump: keys.has('Space'), block: keys.has('KeyQ') });
}, 33);

/* menú */
$('code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnCreate').onclick = () => enter('create');
$('btnJoin').onclick = () => {
  if ($('code').value.trim().length !== 4) { setMenuErr('El código tiene 4 caracteres'); return; }
  enter('join');
};
$('btnLeave').onclick = () => showMenu();
$('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('roomLink').textContent); $('btnCopy').textContent = 'Copiado'; }
  catch { $('btnCopy').textContent = 'Copia el enlace a mano'; }
  setTimeout(() => { $('btnCopy').textContent = 'Copiar enlace'; }, 1800);
};
$('rematch').onclick = () => send({ t: 'rematch' });

/* ---------------- cámara ---------------- */
function updateCamera(dt, t) {
  const me = disp[S.id], op = disp[1 - S.id];
  if (S.screen !== 'game' || !me || !me.init) {
    const a = t * 0.12;
    camera.position.set(Math.cos(a) * 24, 7.5, Math.sin(a) * 24);
    camera.lookAt(0, 1.5, 0);
    cam.init = false;
    return;
  }
  const hasOp = op && op.init;
  const target = hasOp ? Math.atan2(op.x - me.x, op.z - me.z) : cam.base;
  if (!cam.init) { cam.base = target; cam.orbit = 0; cam.init = true; }
  cam.base = lerpAngle(cam.base, target, 1 - Math.exp(-7 * dt));
  if (performance.now() - cam.lastMouse > 1500) cam.orbit *= Math.exp(-2.2 * dt);
  cam.yaw = cam.base + cam.orbit;
  const d = hasOp ? Math.hypot(op.x - me.x, op.z - me.z) : 4;
  const dist = 4.6 + Math.min(4, d * 0.35);
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    me.x - Math.sin(cam.yaw) * cp * dist,
    me.y + 1.5 + Math.sin(cam.pitch) * dist,
    me.z - Math.cos(cam.yaw) * cp * dist
  );
  const w = hasOp ? 0.35 : 0;
  const lx = me.x + (hasOp ? (op.x - me.x) * w : 0);
  const lz = me.z + (hasOp ? (op.z - me.z) * w : 0);
  const ly = me.y * 0.6 + 1.3;
  camera.lookAt(lx, ly, lz);
  if (cam.shake > 0.002) {
    camera.position.x += (Math.random() - 0.5) * cam.shake;
    camera.position.y += (Math.random() - 0.5) * cam.shake;
    cam.shake *= Math.exp(-9 * dt);
  }
}

/* ---------------- bucle ---------------- */
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;
  world.update(t, dt);

  const kp = 1 - Math.exp(-20 * dt), ky = 1 - Math.exp(-30 * dt), kr = 1 - Math.exp(-16 * dt);
  for (let i = 0; i < 2; i++) {
    const d = disp[i];
    if (!d || !d.tgt) continue;
    const g = d.tgt;
    d.x += (g.x - d.x) * kp;
    d.y += (g.y - d.y) * ky;
    d.z += (g.z - d.z) * kp;
    d.yaw = lerpAngle(d.yaw, g.a, kr);
    d.f.root.position.set(d.x, d.y, d.z);
    d.f.root.rotation.y = d.yaw;
    const el = Math.min(0.12, (now - d.recvAt) / 1000);
    const u = g.d > 0 ? Math.min(1, (g.t + el) / g.d) : 0;
    d.f.setPose(g.s, u, t + i * 1.7, g.v, d.y > 0.06, dt);
  }
  updateParticles(dt);
  updateCamera(dt, t);
  renderer.render(scene, camera);

  if (S.screen === 'menu' && pFighter) {
    pFighter.setPose('idle', 0, t, 0, false, dt);
    pFighter.root.rotation.y = t * 0.8;
    pRenderer.render(pScene, pCam);
  }
}
requestAnimationFrame(frame);

window.__sb = { S, disp, cam, scene, camera };
