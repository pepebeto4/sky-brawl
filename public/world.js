import * as THREE from 'three';

export const ARENA_R = 12;

const rand = (a, b) => a + Math.random() * (b - a);

function platformTexture() {
  const S = 1024, C = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      g.fillStyle = (x + y) % 2 ? '#928eb8' : '#837ea6';
      g.fillRect(x * 64, y * 64, 64, 64);
    }
  }
  g.strokeStyle = '#ffd08a'; g.lineWidth = 12;
  g.beginPath(); g.arc(C, C, C * 0.965, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 6;
  for (const r of [0.22, 0.5, 0.78]) { g.beginPath(); g.arc(C, C, C * r, 0, Math.PI * 2); g.stroke(); }
  g.beginPath();
  g.moveTo(C, C * 0.05); g.lineTo(C, S - C * 0.05);
  g.moveTo(C * 0.05, C); g.lineTo(S - C * 0.05, C);
  g.stroke();
  // estrella central
  g.fillStyle = 'rgba(255,170,60,0.85)';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = (i % 2 ? 0.07 : 0.17) * C, a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const puffGeo = new THREE.SphereGeometry(1, 10, 8);
function cloud(color, scale) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.93, fog: false });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(puffGeo, mat);
    const r = rand(0.6, 1.4);
    m.scale.set(r * 1.4, r * 0.7, r);
    m.position.set((i - 2.5) * 0.95 + rand(-0.4, 0.4), rand(0, 0.5), rand(-0.6, 0.6));
    g.add(m);
  }
  g.scale.setScalar(scale);
  return g;
}

export function buildWorld(scene, camera) {
  const R = ARENA_R;
  scene.background = new THREE.Color(0x30204f);

  // ---- cielo al atardecer ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 zenith = vec3(0.09,0.09,0.30);
          vec3 mid = vec3(0.50,0.17,0.42);
          vec3 horizon = vec3(1.0,0.47,0.22);
          vec3 below = vec3(0.80,0.35,0.45);
          vec3 c;
          if (h >= 0.0) {
            c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
            c = mix(c, zenith, smoothstep(0.18, 0.85, h));
          } else {
            c = mix(horizon, below, smoothstep(0.0, 0.6, -h));
          }
          vec3 sd = normalize(vec3(-0.45, 0.07, -0.89));
          float s = max(dot(vDir, sd), 0.0);
          c += vec3(1.0,0.62,0.25) * pow(s, 18.0) * 0.7;
          c += vec3(1.0,0.85,0.55) * pow(s, 120.0) * 1.2;
          c = mix(c, vec3(1.0,0.96,0.8), smoothstep(0.9993, 0.9998, s));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);

  const sp = [];
  for (let i = 0; i < 400; i++) {
    const u = Math.random() * Math.PI * 2, y = rand(0.35, 1), r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(u) * r * 550, y * 550, Math.sin(u) * r * 550);
  }
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)),
    new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false })
  );
  sky.add(stars);

  // ---- luces ----
  scene.add(new THREE.HemisphereLight(0xffb08a, 0x4b3b7a, 1.0));
  const sun = new THREE.DirectionalLight(0xffc48f, 2.4);
  sun.position.set(-45, 32, -89);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 10; sc.far = 220;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---- plataforma ----
  const sideMat = new THREE.MeshToonMaterial({ color: 0x5d5a7e });
  const topMat = new THREE.MeshLambertMaterial({ map: platformTexture() });
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1, 72), [sideMat, topMat, sideMat]);
  plat.position.y = -0.5;
  plat.receiveShadow = true;
  plat.castShadow = true;
  scene.add(plat);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(R, 0.1, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0xffb04d })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.03;
  scene.add(rim);

  // roca inferior
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x514c70, flatShading: true });
  const rock = new THREE.Mesh(new THREE.ConeGeometry(R * 0.97, 10, 40, 3), rockMat);
  rock.rotation.x = Math.PI;
  rock.position.y = -6;
  scene.add(rock);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rand(-0.2, 0.2), r = R * rand(0.55, 0.85);
    const h = rand(2.5, 5);
    const st = new THREE.Mesh(new THREE.ConeGeometry(rand(0.6, 1.1), h, 6), rockMat);
    st.rotation.x = Math.PI;
    st.position.set(Math.cos(a) * r, -1 - h / 2, Math.sin(a) * r);
    scene.add(st);
  }

  // farolillos del borde
  const lamps = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * (R - 0.35), 0, Math.sin(a) * (R - 0.35));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 8), sideMat);
    post.position.y = 0.45;
    post.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    bulb.position.y = 1.0;
    g.add(post, bulb);
    scene.add(g);
    lamps.push(bulb);
  }

  // islotes flotantes
  const islets = [];
  const grass = new THREE.MeshToonMaterial({ color: 0x7ccf8a });
  const trunk = new THREE.MeshToonMaterial({ color: 0x6b4a3a });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rand(-0.3, 0.3), r = rand(36, 75), s = rand(0.8, 1.8);
    const g = new THREE.Group();
    const under = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3.2, 7), rockMat);
    under.rotation.x = Math.PI; under.position.y = -1.6;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.5, 7), grass);
    top.position.y = 0.05;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 6), trunk);
    tr.position.set(0.3, 0.7, 0);
    const lf = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 7), grass);
    lf.position.set(0.3, 1.7, 0);
    g.add(under, top, tr, lf);
    g.scale.setScalar(s);
    g.position.set(Math.cos(a) * r, rand(-6, 10), Math.sin(a) * r);
    g.userData.y0 = g.position.y;
    scene.add(g);
    islets.push(g);
  }

  // nubes
  const rings = [];
  const ring = (y, rMin, rMax, n, sMin, sMax, color, speed) => {
    const g = new THREE.Group();
    g.position.y = y;
    for (let i = 0; i < n; i++) {
      const c = cloud(color, rand(sMin, sMax));
      const a = Math.random() * Math.PI * 2, r = rand(rMin, rMax);
      c.position.set(Math.cos(a) * r, rand(-3, 3), Math.sin(a) * r);
      c.rotation.y = rand(0, 6);
      g.add(c);
    }
    g.userData.speed = speed;
    scene.add(g);
    rings.push(g);
  };
  ring(-14, 30, 150, 26, 6, 13, 0xf7ab92, 0.012);
  ring(-28, 20, 200, 34, 10, 20, 0xc96b93, -0.008);
  ring(-6, 160, 330, 16, 18, 34, 0xffb78e, 0.005);
  ring(14, 220, 380, 10, 20, 36, 0xff9a7a, -0.004);

  return {
    update(t, dt) {
      sky.position.copy(camera.position);
      for (const g of rings) g.rotation.y += dt * g.userData.speed;
      islets.forEach((g, i) => { g.position.y = g.userData.y0 + Math.sin(t * 0.6 + i) * 0.6; });
      lamps.forEach((b, i) => b.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.08));
    },
  };
}
