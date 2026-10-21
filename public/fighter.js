import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Personajes seleccionables. Para usar un modelo propio, guarda un .glb en
// public/models/<nombre en minúsculas>.glb (ej. tito.glb). Debe mirar hacia +Z.
export const SKINS = [
  { name: 'Tito',  skin: 0xf1c27d, shirt: 0xe63946, gloves: 0xffd166, trunks: 0x1d3557, hat: 'headband', hatColor: 0xffffff },
  { name: 'Luna',  skin: 0x8d5524, shirt: 0x7b2cbf, gloves: 0xff70a6, trunks: 0x3c096c, hat: 'ears',     hatColor: 0xffc2e2 },
  { name: 'Bruno', skin: 0xffdbac, shirt: 0x1d70f5, gloves: 0xffffff, trunks: 0x0b2545, hat: 'helmet',   hatColor: 0xcfd8dc },
  { name: 'Kiko',  skin: 0xc68642, shirt: 0x2dc653, gloves: 0xff9f1c, trunks: 0x14532d, hat: 'mohawk',   hatColor: 0xff006e },
  { name: 'Nora',  skin: 0xe0ac69, shirt: 0xff7b00, gloves: 0x3a86ff, trunks: 0x7f4f24, hat: 'cap',      hatColor: 0x3a86ff },
  { name: 'Rex',   skin: 0x8fd694, shirt: 0x2b2b2b, gloves: 0xffe66d, trunks: 0x555555, hat: 'crown',    hatColor: 0xffd60a },
];

const gradient = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([70, 160, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();
const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x140a24, side: THREE.BackSide });
const matCache = new Map();
function toon(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: gradient }));
  return matCache.get(color);
}
function part(geo, color, outline = 1.08) {
  const m = new THREE.Mesh(geo, toon(color));
  m.castShadow = true;
  if (outline) {
    const o = new THREE.Mesh(geo, OUTLINE);
    o.scale.setScalar(outline);
    m.add(o);
  }
  return m;
}

const lerp = (a, b, k) => a + (b - a) * k;
const mix = (p, q, k) => ({ sx: lerp(p.sx, q.sx, k), ex: lerp(p.ex, q.ex, k), sz: lerp(p.sz, q.sz, k) });
const ease = (k) => k * k * (3 - 2 * k);
const curve = (u, peak) => (u < peak ? ease(u / peak) : 1 - ease((u - peak) / (1 - peak)));

// Poses de brazo: sx = hombro, ex = codo (negativo = hacia delante/arriba), sz = cierre lateral
const GUARD = { sx: -0.55, ex: -1.9, sz: 0.15 };
const PUNCH = { sx: -1.5, ex: -0.08, sz: 0 };
const WIND = { sx: 0.7, ex: -1.2, sz: 0.2 };
const BLOCK = { sx: -1.05, ex: -2.35, sz: 0.5 };
const HURT = { sx: 0.4, ex: -0.5, sz: 0.6 };
const LIMP = { sx: 0.25, ex: -0.1, sz: 0.2 };
const CHEER = { sx: -2.7, ex: -0.3, sz: 0.5 };

export function buildFighter(cfg) {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  const proc = new THREE.Group();
  const glbHolder = new THREE.Group();
  root.add(body);
  body.add(proc, glbHolder);

  // piernas
  const legs = [];
  for (const s of [1, -1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.17, 0.76, 0);
    const thigh = part(new THREE.CylinderGeometry(0.13, 0.11, 0.4, 14), cfg.trunks);
    thigh.position.y = -0.14;
    const shin = part(new THREE.CylinderGeometry(0.09, 0.08, 0.4, 12), cfg.skin);
    shin.position.y = -0.46;
    const shoe = part(new THREE.BoxGeometry(0.2, 0.13, 0.36), 0xf4f4f4);
    shoe.position.set(0, -0.69, 0.07);
    leg.add(thigh, shin, shoe);
    proc.add(leg);
    legs.push(leg);
  }

  // torso y pantalón
  const torso = part(new THREE.CapsuleGeometry(0.27, 0.3, 6, 16), cfg.shirt);
  torso.position.y = 1.1;
  const shorts = part(new THREE.CylinderGeometry(0.29, 0.31, 0.3, 18), cfg.trunks);
  shorts.position.y = 0.8;
  const belt = part(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 18), 0xffffff, 1.0);
  belt.position.y = 0.94;
  proc.add(torso, shorts, belt);

  // brazos
  const arms = [];
  for (const s of [1, -1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.4, 1.38, 0);
    const joint = part(new THREE.SphereGeometry(0.11, 12, 10), cfg.skin, 1.0);
    const up = part(new THREE.CylinderGeometry(0.085, 0.075, 0.4, 10), cfg.skin);
    up.position.y = -0.2;
    const el = new THREE.Group();
    el.position.y = -0.4;
    const fore = part(new THREE.CylinderGeometry(0.075, 0.07, 0.36, 10), cfg.skin);
    fore.position.y = -0.18;
    const glove = part(new THREE.SphereGeometry(0.19, 16, 12), cfg.gloves);
    glove.position.y = -0.4;
    el.add(fore, glove);
    sh.add(joint, up, el);
    proc.add(sh);
    arms.push({ sh, el, s });
  }

  // cabeza y cara
  const head = part(new THREE.SphereGeometry(0.3, 24, 18), cfg.skin);
  head.position.y = 1.78;
  proc.add(head);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const black = new THREE.MeshBasicMaterial({ color: 0x140a24 });
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), white);
    eye.scale.set(1, 1.15, 0.5);
    eye.position.set(s * 0.115, 1.82, 0.26);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), black);
    pupil.position.set(s * 0.115, 1.82, 0.3);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.03), black);
    brow.position.set(s * 0.115, 1.93, 0.255);
    brow.rotation.z = s * 0.4;
    const ear = part(new THREE.SphereGeometry(0.06, 8, 8), cfg.skin, 1.0);
    ear.position.set(s * 0.3, 1.78, 0);
    proc.add(eye, pupil, brow, ear);
  }
  const nose = part(new THREE.SphereGeometry(0.05, 8, 8), cfg.skin, 1.0);
  nose.position.set(0, 1.74, 0.3);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.03), black);
  mouth.position.set(0, 1.66, 0.285);
  proc.add(nose, mouth);

  // sombrero / accesorio
  const hat = new THREE.Group();
  hat.position.set(0, 1.78, 0);
  proc.add(hat);
  switch (cfg.hat) {
    case 'headband': {
      const b = part(new THREE.TorusGeometry(0.3, 0.04, 8, 24), cfg.hatColor, 1.0);
      b.rotation.x = Math.PI / 2; b.position.y = 0.12;
      const knot = part(new THREE.BoxGeometry(0.08, 0.14, 0.04), cfg.hatColor, 1.0);
      knot.position.set(0.12, 0.08, -0.31);
      hat.add(b, knot);
      break;
    }
    case 'ears': {
      for (const s of [1, -1]) {
        const e = part(new THREE.CapsuleGeometry(0.07, 0.36, 4, 8), cfg.hatColor);
        e.position.set(s * 0.13, 0.5, 0);
        e.rotation.z = -s * 0.15;
        hat.add(e);
      }
      break;
    }
    case 'helmet': {
      const h = part(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), cfg.hatColor);
      h.position.y = 0.02;
      const stripe = part(new THREE.BoxGeometry(0.06, 0.04, 0.7), 0xe63946, 1.0);
      stripe.position.y = 0.34;
      hat.add(h, stripe);
      break;
    }
    case 'mohawk': {
      for (let i = -2; i <= 2; i++) {
        const c = part(new THREE.ConeGeometry(0.07, 0.3, 8), cfg.hatColor);
        c.position.set(0, 0.34 - Math.abs(i) * 0.03, i * 0.11);
        hat.add(c);
      }
      break;
    }
    case 'cap': {
      const dome = part(new THREE.SphereGeometry(0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), cfg.hatColor);
      dome.position.y = 0.04;
      const brim = part(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 20), cfg.hatColor);
      brim.position.set(0, 0.06, 0.28);
      brim.scale.set(1, 1, 0.7);
      hat.add(dome, brim);
      break;
    }
    case 'crown': {
      const base = part(new THREE.CylinderGeometry(0.21, 0.23, 0.1, 16), cfg.hatColor);
      base.position.y = 0.3;
      hat.add(base);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const c = part(new THREE.ConeGeometry(0.06, 0.18, 6), cfg.hatColor);
        c.position.set(Math.cos(a) * 0.18, 0.43, Math.sin(a) * 0.18);
        hat.add(c);
      }
      break;
    }
    default:
  }

  const f = { root, body, proc, glbHolder, legs, arms, spin: 0, rootX: 0, hasGLB: false, cfg };

  // state: idle|block|jab|cross|heavy|hit|dodge|fall|ko|win   u: progreso 0..1   t: tiempo
  f.setPose = (state, u, t, speed, air, dt) => {
    let L = GUARD, R = GUARD;
    let lean = 0, twist = 0, crouch = 0, lunge = 0, bob = 0, rootTarget = 0;
    switch (state) {
      case 'block': L = R = BLOCK; lean = 0.2; crouch = 0.07; break;
      case 'jab': { const e = curve(u, 0.4); L = mix(GUARD, PUNCH, e); lean = 0.12 * e; twist = -0.3 * e; lunge = 0.25 * e; break; }
      case 'cross': { const e = curve(u, 0.36); R = mix(GUARD, PUNCH, e); lean = 0.2 * e; twist = 0.45 * e; lunge = 0.35 * e; break; }
      case 'heavy': {
        let w = 0, e = 0;
        if (u < 0.45) w = ease(u / 0.45);
        else if (u < 0.58) { w = 1 - (u - 0.45) / 0.13; e = (u - 0.45) / 0.13; }
        else e = 1 - ease((u - 0.58) / 0.42);
        R = mix(mix(GUARD, WIND, w), PUNCH, e);
        lean = -0.3 * w + 0.35 * e; twist = -0.55 * w + 0.6 * e; lunge = 0.5 * e; crouch = 0.1 * w;
        break;
      }
      case 'hit': { const k = Math.sin(Math.PI * u); L = R = HURT; lean = -0.5 * k; crouch = 0.06 * k; break; }
      case 'dodge': { const k = Math.sin(Math.PI * u); lean = 0.35 * k; crouch = 0.28 * k; break; }
      case 'fall': L = R = { sx: -2.6 + Math.sin(t * 16) * 0.5, ex: -0.3, sz: 0.5 }; break;
      case 'ko': L = R = LIMP; rootTarget = -1.45; lunge = -0.1; break;
      case 'win': L = R = CHEER; bob = Math.abs(Math.sin(t * 7)) * 0.18; break;
      default: {
        const sway = Math.sin(t * 3) * 0.05;
        L = { ...GUARD, sx: GUARD.sx + sway };
        R = { ...GUARD, sx: GUARD.sx - sway };
        bob = Math.sin(t * 5) * 0.02;
      }
    }

    if (state === 'fall') { f.spin -= dt * 5.5; f.rootX = f.spin; }
    else { f.spin = 0; f.rootX += (rootTarget - f.rootX) * (1 - Math.exp(-7 * dt)); }
    root.rotation.x = f.rootX;

    const ka = 1 - Math.exp(-26 * dt);
    for (const a of arms) {
      const tg = a.s > 0 ? L : R;
      a.sh.rotation.x += (tg.sx - a.sh.rotation.x) * ka;
      a.el.rotation.x += (tg.ex - a.el.rotation.x) * ka;
      a.sh.rotation.z += (-a.s * tg.sz - a.sh.rotation.z) * ka;
    }
    const kb = 1 - Math.exp(-22 * dt);
    body.rotation.x += (lean - body.rotation.x) * kb;
    body.rotation.y += (twist - body.rotation.y) * kb;
    body.position.y += (bob - crouch - body.position.y) * kb;
    body.position.z += (lunge - body.position.z) * kb;

    const amp = Math.min(1, speed / 5) * 0.8;
    const ph = t * 11;
    legs.forEach((lg, i) => {
      const sg = i === 0 ? 1 : -1;
      lg.rotation.x = air ? sg * 0.5 : Math.sin(ph) * amp * sg;
      lg.rotation.z = -sg * (state === 'block' ? 0.14 : 0.07);
    });
  };

  return f;
}

const loader = new GLTFLoader();

// Si existe public/models/<nombre>.glb se usa en lugar del modelo procedural.
// El modelo se anima de forma global (inclinación, avance, caída), no por huesos.
export async function tryAttachGLB(f, url) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return false;
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(2.0 / (size.y || 1));
    box.setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z);
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    f.glbHolder.add(model);
    f.proc.visible = false;
    f.hasGLB = true;
    return true;
  } catch {
    return false;
  }
}
