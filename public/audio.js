// Audio 100% sintetizado con WebAudio: no necesita archivos de sonido.
let ctx = null, master, sfxBus, musicBus, noiseBuf;
let musicOn = true, musicTimer = null, step = 0, nextT = 0;
const MUSIC_VOL = 0.2;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? MUSIC_VOL : 0; musicBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startWind();
  startMusic();
}

export function toggleMusic() {
  musicOn = !musicOn;
  if (musicBus) musicBus.gain.value = musicOn ? MUSIC_VOL : 0;
  return musicOn;
}

function noise({ dur, type = 'bandpass', f0 = 800, f1 = 800, q = 1, vol = 0.3, at = 0, bus }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f0, t);
  fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl); fl.connect(g); g.connect(bus || sfxBus);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}

function tone({ type = 'sine', f0, f1 = f0, dur, vol = 0.3, at = 0, bus }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus || sfxBus);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  whoosh(heavy) {
    noise({ dur: heavy ? 0.32 : 0.16, f0: heavy ? 300 : 500, f1: heavy ? 1800 : 2400, q: 1.2, vol: heavy ? 0.28 : 0.16 });
  },
  hit(heavy, blocked) {
    if (blocked) {
      tone({ type: 'triangle', f0: 820, f1: 760, dur: 0.12, vol: 0.18 });
      tone({ type: 'triangle', f0: 1130, f1: 1000, dur: 0.1, vol: 0.12 });
      noise({ dur: 0.06, type: 'highpass', f0: 3000, f1: 3000, vol: 0.12 });
      return;
    }
    tone({ f0: heavy ? 170 : 140, f1: 45, dur: heavy ? 0.35 : 0.2, vol: heavy ? 0.7 : 0.5 });
    noise({ dur: heavy ? 0.22 : 0.12, type: 'lowpass', f0: 2200, f1: 300, vol: heavy ? 0.6 : 0.4 });
    if (heavy) tone({ type: 'square', f0: 90, f1: 40, dur: 0.3, vol: 0.18 });
  },
  jump() { tone({ f0: 280, f1: 620, dur: 0.14, vol: 0.12 }); },
  dodge() { noise({ dur: 0.2, type: 'highpass', f0: 1200, f1: 4000, vol: 0.14 }); },
  fall() { tone({ type: 'sawtooth', f0: 600, f1: 90, dur: 1.0, vol: 0.14 }); },
  ko() {
    tone({ type: 'sawtooth', f0: 420, f1: 55, dur: 0.9, vol: 0.28 });
    tone({ f0: 100, f1: 30, dur: 0.7, vol: 0.7 });
    noise({ dur: 0.5, type: 'lowpass', f0: 3000, f1: 200, vol: 0.5 });
  },
  bell() {
    for (const [f, v] of [[880, 0.3], [1320, 0.18], [1760, 0.12], [2640, 0.06]]) tone({ f0: f, dur: 1.4, vol: v });
  },
  count(n) { tone({ type: 'square', f0: n === 1 ? 660 : 440, dur: 0.18, vol: 0.14 }); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.4, vol: 0.22, at: i * 0.12 })); },
  lose() { [392, 330, 262].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.5, vol: 0.2, at: i * 0.18 })); },
};

function startWind() {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 520;
  const g = ctx.createGain(); g.gain.value = 0.05;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
  const lg = ctx.createGain(); lg.gain.value = 0.03;
  lfo.connect(lg); lg.connect(g.gain);
  src.connect(fl); fl.connect(g); g.connect(master);
  src.start(); lfo.start();
}

// Música: bucle suave de 4 acordes (Am - F - C - G) con bajo, arpegio y percusión
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
const BPM = 96;

function playStep(s, when) {
  const at = Math.max(0, when - ctx.currentTime);
  const bar = Math.floor(s / 16) % 4, k = s % 16;
  const ch = CHORDS[bar];
  if (k % 4 === 0) tone({ f0: mf(ch[0] - 12), dur: 0.38, vol: 0.5, at, bus: musicBus });
  if (k % 2 === 0) tone({ type: 'triangle', f0: mf(ch[(k / 2) % 3] + 12), dur: 0.22, vol: 0.16, at, bus: musicBus });
  if (k === 0) for (const n of ch) tone({ type: 'sawtooth', f0: mf(n), dur: 1.5, vol: 0.035, at, bus: musicBus });
  if (k % 8 === 0) tone({ f0: 120, f1: 42, dur: 0.18, vol: 0.55, at, bus: musicBus });
  if (k % 8 === 4) noise({ dur: 0.12, type: 'bandpass', f0: 1800, f1: 1200, vol: 0.14, at, bus: musicBus });
  if (k % 2 === 1) noise({ dur: 0.04, type: 'highpass', f0: 7000, f1: 7000, vol: 0.05, at, bus: musicBus });
}

function startMusic() {
  nextT = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    if (!ctx) return;
    while (nextT < ctx.currentTime + 0.25) {
      playStep(step, nextT);
      nextT += 60 / BPM / 4;
      step++;
    }
  }, 40);
}
