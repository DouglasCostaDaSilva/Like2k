// LikeSystem — cena 3D estilo "bloquinho" (low-poly): shinobi de jaqueta laranja e preta,
// cabelo espetado facetado, bandana, espada de chakra, anel de fogo e plataforma hexagonal neon.
// Tudo procedural. Se existir /models/outfit.glb, ele substitui o personagem automaticamente.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const C = {
  orange: 0xff6a00, orangeDark: 0xd94f00, black: 0x17171c, skin: 0xffcf9e, hair: 0xffc61a, hair2: 0xffdd4d,
  navy: 0x1d2440, metal: 0xb9bec7, brown: 0x4a3222, white: 0xf2f2f2, sandal: 0x22283a,
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ texturas
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const spiral = (g, cx, cy, turns, step, width, color) => {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  g.beginPath();
  for (let a = 0; a <= Math.PI * 2 * turns; a += 0.03) {
    const r = step * a;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
};

// placa da bandana: metal escovado com espiral gravada
const plateTexture = () => canvasTexture(256, 96, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#e9edf2'); grd.addColorStop(0.5, '#aab0b9'); grd.addColorStop(1, '#d6dbe1');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.05})`; g.fillRect(0, y, w, 1); }
  spiral(g, w / 2, h / 2 + 2, 2.2, 2.9, 7, '#5b616b');
  spiral(g, w / 2 - 1, h / 2, 2.2, 2.9, 3, '#e8ecf1');
  g.strokeStyle = '#6d737c'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
});

const spiralPatch = () => canvasTexture(256, 256, (g, w) => {
  spiral(g, w / 2, w / 2, 2.4, 6.4, 18, '#d9261c');
  g.strokeStyle = '#d9261c'; g.lineWidth = 14; g.beginPath(); g.arc(w / 2, w / 2, w * 0.44, 0, Math.PI * 2); g.stroke();
});

// ------------------------------------------------------------------ shaders
const ringMaterial = (color, strength) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform vec3 uColor; uniform float uStrength; varying vec2 vUv;
    float h(float n){ return fract(sin(n)*43758.5453); }
    float noise(float x){ float i = floor(x); float f = fract(x); return mix(h(i), h(i+1.0), f*f*(3.0-2.0*f)); }
    void main(){
      float a = vUv.x * 60.0;
      float flame = noise(a - uTime*6.0) * 0.6 + noise(a*2.3 + uTime*9.0) * 0.4;
      float gap = smoothstep(0.15, 0.45, noise(vUv.x*9.0 - uTime*1.5));
      float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
      float v = pow(core, 1.5) * (0.35 + flame) * gap;
      gl_FragColor = vec4(mix(uColor, vec3(1.0,0.92,0.7), pow(v,2.0)) * v * uStrength * 2.2, v);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

function particleMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: pixelRatio } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPR; attribute float aSeed; attribute vec3 aColor; varying vec3 vColor; varying float vA;
      void main(){
        vec3 p = position;
        float h = mod(p.y + uTime * (0.25 + aSeed*0.5), 7.0) - 3.0;
        p.y = h;
        float ang = uTime * (0.2 + aSeed*0.3) + aSeed * 40.0;
        p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_PointSize = (10.0 + aSeed*22.0) * uPR / -mv.z;
        vColor = aColor; vA = smoothstep(-3.0,-2.2,h) * (1.0 - smoothstep(2.2,4.0,h));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vA;
      void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vColor*a*2.0, a*vA); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

// ------------------------------------------------------------------ cena
export function createScene(canvas, { mode = 'landing', onReady } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, mode === 'app' ? 1.5 : 2);
  renderer.setPixelRatio(pr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070a);
  scene.fog = new THREE.FogExp2(0x07070a, 0.06);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.35, 9.5);

  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x1a0c05, 0.55));
  const key = new THREE.DirectionalLight(0xfff0dd, 1.9);
  key.position.set(3, 5, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -3.5, right: 3.5, top: 4, bottom: -3.5 });
  key.shadow.radius = 4; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.SpotLight(0xff6a00, 90, 20, 0.6, 0.6, 1.3);
  rim.position.set(-3.5, 3.5, -4); scene.add(rim);
  const rim2 = new THREE.SpotLight(0xff9a3c, 60, 20, 0.6, 0.6, 1.3);
  rim2.position.set(4, 2.5, -3.5); scene.add(rim2);
  const glowLight = new THREE.PointLight(0xff7a1a, 10, 7, 2);
  glowLight.position.set(0, -0.8, 1.2); scene.add(glowLight);

  // materiais low-poly (facetados)
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02, flatShading: true, ...extra });
  const M = {
    orange: mat(C.orange), orangeDark: mat(C.orangeDark), black: mat(C.black, { roughness: 0.75 }), skin: mat(C.skin, { roughness: 0.7 }),
    hair: mat(C.hair, { roughness: 0.55 }), hair2: mat(0xf2a900, { roughness: 0.55 }), navy: mat(C.navy), brown: mat(C.brown, { roughness: 0.8 }),
    white: mat(0xd9d6cf), sandal: mat(C.sandal), metal: mat(C.metal, { metalness: 0.9, roughness: 0.3 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x0c0c10 }), shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
  const box = (w, h, d, m, r = 0.03) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), m);
  const at = (mesh, x, y, z) => { mesh.position.set(x, y, z); return mesh; };

  const rig = new THREE.Group(); // pose (scroll/mouse)
  scene.add(rig);
  const FLOOR = -2.0; // topo da plataforma
  const hero = new THREE.Group(); // personagem (pés em y=0)
  hero.position.y = FLOOR;
  rig.add(hero);
  const body = new THREE.Group(); // respira
  hero.add(body);

  // ---- Pernas (base larga, pose de combate)
  for (const side of [-1, 1]) { // -1 = direita do personagem (esquerda da tela)
    const hip = new THREE.Group();
    hip.position.set(0.24 * side, 1.36, 0);
    hip.rotation.set(side < 0 ? 0.28 : -0.3, 0, 0.2 * side);
    const thigh = at(box(0.36, 0.64, 0.4, M.orange), 0, -0.3, 0);
    const knee = new THREE.Group();
    knee.position.y = -0.62;
    knee.rotation.x = side < 0 ? 0.12 : 0.42;
    const shin = at(box(0.34, 0.56, 0.38, M.orange), 0, -0.28, 0);
    const wrapA = at(box(0.37, 0.07, 0.41, M.white, 0.01), 0, -0.16, 0);
    const wrapB = at(box(0.37, 0.05, 0.41, M.black, 0.01), 0, -0.26, 0);
    const wrapC = at(box(0.37, 0.07, 0.41, M.white, 0.01), 0, -0.36, 0);
    const foot = new THREE.Group();
    foot.position.set(0, -0.6, 0.06);
    foot.rotation.x = -knee.rotation.x - hip.rotation.x; // pé plano no chão
    foot.add(at(box(0.42, 0.12, 0.6, M.sandal, 0.03), 0, -0.02, 0.04), at(box(0.32, 0.12, 0.44, M.skin), 0, 0.09, 0.06), at(box(0.36, 0.05, 0.08, M.sandal, 0.01), 0, 0.13, 0.1));
    knee.add(shin, wrapA, wrapB, wrapC, foot);
    hip.add(thigh, knee);
    body.add(hip);
  }

  // ---- Quadril, jaqueta e cinto
  body.add(at(box(0.84, 0.3, 0.5, M.orange), 0, 1.42, 0));
  const torso = new THREE.Group();
  torso.position.y = 1.5;
  torso.rotation.y = 0.12;
  body.add(torso);
  torso.add(
    at(box(0.9, 0.78, 0.52, M.orange, 0.05), 0, 0.42, 0), // jaqueta
    at(box(0.94, 0.2, 0.56, M.orangeDark, 0.04), 0, 0.02, 0), // barra
    at(box(0.93, 0.34, 0.55, M.black, 0.05), 0, 0.68, 0), // ombreira preta
    at(box(0.035, 0.72, 0.02, M.metal, 0.005), 0, 0.42, 0.27), // zíper
    at(box(0.06, 0.1, 0.03, M.metal, 0.01), 0, 0.66, 0.285), // puxador
  );
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.24, 8, 1, true), mat(C.orange, { side: THREE.DoubleSide }));
  collar.position.y = 0.9; collar.rotation.y = Math.PI / 8;
  torso.add(collar, at(box(0.4, 0.06, 0.3, M.black, 0.02), 0, 0.8, 0));
  // cinto com bolsinhas
  torso.add(at(box(0.98, 0.1, 0.58, M.black, 0.02), 0, 0.12, 0), at(box(0.14, 0.12, 0.04, M.metal, 0.02), 0, 0.12, 0.3));
  for (const x of [-0.32, -0.16, 0.2, 0.34]) torso.add(at(box(0.13, 0.17, 0.1, M.brown, 0.025), x, 0.09, 0.31));
  // espiral nas costas
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshStandardMaterial({ map: spiralPatch(), transparent: true, roughness: 0.7 }));
  back.position.set(0, 0.38, -0.265); back.rotation.y = Math.PI;
  torso.add(back);

  // ---- Braços
  const arms = {};
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.56 * side, 0.72, 0);
    const upper = at(box(0.3, 0.5, 0.32, M.orange), 0, -0.22, 0);
    const pad = at(box(0.33, 0.2, 0.35, M.black, 0.04), 0, -0.02, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -0.46;
    const fore = at(box(0.28, 0.46, 0.3, M.orange), 0, -0.22, 0);
    const cuff = at(box(0.31, 0.09, 0.33, M.black, 0.02), 0, -0.44, 0);
    const hand = new THREE.Group();
    hand.position.y = -0.58;
    hand.add(at(box(0.25, 0.24, 0.26, M.skin, 0.05), 0, 0, 0), at(box(0.08, 0.12, 0.1, M.skin, 0.03), -0.12 * side, 0.04, 0.08));
    elbow.add(fore, cuff, hand);
    shoulder.add(upper, pad, elbow);
    torso.add(shoulder);
    arms[side] = { shoulder, elbow, hand, upper };
  }
  // espiral no ombro esquerdo
  const shoulderMark = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: spiralPatch(), transparent: true, roughness: 0.7 }));
  shoulderMark.position.set(0.155, 0, 0); shoulderMark.rotation.y = Math.PI / 2;
  arms[1].upper.add(shoulderMark);
  // pose: direita segura a espada à frente; esquerda aberta para trás
  arms[-1].shoulder.rotation.set(-0.75, 0.2, -0.35);
  arms[-1].elbow.rotation.set(-0.7, 0, 0.1);
  arms[1].shoulder.rotation.set(0.35, 0, 0.62);
  arms[1].elbow.rotation.set(-0.55, 0, 0.2);

  // ---- Espada de chakra
  const sword = new THREE.Group();
  sword.position.set(0, -0.02, 0.04);
  sword.rotation.set(1.25, 0, -0.5);
  const bladeCore = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
  const bladeGlow = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  sword.add(
    at(box(0.07, 0.34, 0.07, M.black, 0.02), 0, 0.02, 0), // cabo
    at(box(0.26, 0.05, 0.1, M.metal, 0.02), 0, -0.17, 0), // guarda
    at(new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.55, 0.012), bladeCore), 0, -0.97, 0),
    at(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.62, 0.05), bladeGlow), 0, -0.98, 0),
  );
  arms[-1].hand.add(sword);

  // ---- Cabeça (grandona, estilo bloquinho)
  const head = new THREE.Group();
  head.position.y = 1.02;
  torso.add(head);
  head.add(at(box(0.2, 0.16, 0.2, M.skin, 0.03), 0, 0, 0)); // pescoço
  head.add(at(box(0.9, 0.84, 0.82, M.skin, 0.08), 0, 0.5, 0));
  for (const s of [-1, 1]) {
    head.add(
      at(box(0.17, 0.15, 0.02, M.white, 0.01), 0.17 * s, 0.45, 0.415),
      at(box(0.09, 0.13, 0.02, M.eye, 0.01), 0.15 * s, 0.44, 0.425),
      at(box(0.03, 0.03, 0.01, M.shine, 0.005), 0.13 * s, 0.48, 0.435),
    );
    const brow = at(box(0.2, 0.045, 0.02, mat(0xb8860b), 0.01), 0.17 * s, 0.57, 0.42);
    brow.rotation.z = -0.22 * s; // expressão determinada
    head.add(brow, at(box(0.07, 0.14, 0.12, M.skin, 0.02), 0.47 * s, 0.46, 0));
  }
  head.add(at(box(0.12, 0.025, 0.02, mat(0x8a3b22), 0.008), 0, 0.23, 0.415));
  // bandana
  head.add(at(box(0.95, 0.17, 0.87, M.navy, 0.03), 0, 0.72, 0));
  const plate = at(new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.17, 0.04, 2, 0.015),
    [M.metal, M.metal, M.metal, M.metal, new THREE.MeshStandardMaterial({ map: plateTexture(), metalness: 0.85, roughness: 0.32 }), M.metal]), 0, 0.72, 0.445);
  head.add(plate, at(box(0.16, 0.12, 0.1, M.navy, 0.03), 0, 0.72, -0.46));
  const tails = [];
  for (const s of [-1, 1]) {
    const tail = new THREE.Group();
    tail.position.set(0.05 * s, 0.72, -0.48);
    let parent = tail;
    const segs = [];
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : -0.11;
      seg.add(at(box(0.08, 0.12, 0.03, M.navy, 0.01), 0, -0.055, 0));
      parent.add(seg);
      segs.push(seg);
      parent = seg;
    }
    tail.rotation.set(1.1, 0.35 * s, 0.4 * s);
    head.add(tail);
    tails.push({ segs, s });
  }
  // cabelo facetado
  const hrnd = mulberry32(7);
  const up = new THREE.Vector3(0, 1, 0);
  head.add(at(box(1.0, 0.36, 0.94, M.hair, 0.08), 0, 0.93, -0.02));
  const addSpike = (dir, len, r, origin) => {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(r, len, 4), hrnd() < 0.5 ? M.hair : M.hair2);
    spike.quaternion.setFromUnitVectors(up, dir.normalize());
    spike.rotateY(hrnd() * Math.PI);
    spike.position.copy(origin).addScaledVector(dir, len * 0.45);
    head.add(spike);
  };
  for (let i = 0; i < 34; i++) {
    const th = hrnd() * Math.PI * 2;
    const ph = 0.25 + hrnd() * 1.15;
    const dir = new THREE.Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph) + 0.15, Math.sin(ph) * Math.cos(th) * 0.9);
    if (dir.z > 0.55 && dir.y < 0.7) dir.z *= 0.3; // não cobre o rosto
    addSpike(dir, 0.38 + hrnd() * 0.3, 0.2 + hrnd() * 0.08, new THREE.Vector3(dir.x * 0.34, 0.98 + dir.y * 0.1, dir.z * 0.32));
  }
  for (let i = 0; i < 7; i++) { // franja sobre a bandana
    const x = -0.36 + i * 0.12;
    addSpike(new THREE.Vector3(x * 0.6, -0.5 - hrnd() * 0.3, 0.9), 0.3 + hrnd() * 0.1, 0.11 + hrnd() * 0.03, new THREE.Vector3(x, 0.88, 0.38));
  }
  head.rotation.set(0.05, -0.1, 0.04);

  hero.traverse((o) => { if (o.isMesh && !o.material.isMeshBasicMaterial) { o.castShadow = true; o.receiveShadow = true; } });

  // ---- Anéis de fogo
  const ringMatA = ringMaterial(0xff6a00, 1);
  const ringMatB = ringMaterial(0xffa21a, 0.7);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.07, 8, 220), ringMatA);
  ringA.position.y = FLOOR + 1.75; ringA.rotation.set(1.28, 0.2, 0);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.045, 8, 220), ringMatB);
  ringB.position.y = FLOOR + 1.55; ringB.rotation.set(1.75, -0.35, 0.3);
  rig.add(ringA, ringB);

  // ---- Estilhaços flutuantes
  const shardGeo = new THREE.TetrahedronGeometry(0.07, 0);
  const shardMats = [new THREE.MeshBasicMaterial({ color: 0xff7a1a }), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.4, metalness: 0.6, flatShading: true })];
  const shards = [];
  const srnd = mulberry32(21);
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Mesh(shardGeo, shardMats[srnd() < 0.6 ? 0 : 1]);
    const r = 1.4 + srnd() * 1.6, a = srnd() * Math.PI * 2, y = FLOOR + 0.4 + srnd() * 3.4;
    m.userData = { r, a, y, sp: 0.1 + srnd() * 0.25, rs: 0.5 + srnd() * 2 };
    m.scale.setScalar(0.6 + srnd() * 1.4);
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    rig.add(m);
    shards.push(m);
  }

  // ---- Plataforma hexagonal com neon
  const stage = new THREE.Group();
  stage.position.y = FLOOR;
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x15161b, metalness: 0.75, roughness: 0.35, flatShading: true });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.0, 0.2, 6), metalDark);
  top.position.y = -0.1; top.receiveShadow = true;
  const inset = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.02, 6), new THREE.MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.6, roughness: 0.5 }));
  inset.position.y = 0.005; inset.receiveShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.65, 0.28, 6), metalDark);
  base.position.y = -0.34;
  stage.add(top, inset, base);
  const neon = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
  const hexEdges = (radius, y, thick, height) => {
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      const p0 = new THREE.Vector3(Math.sin(a0) * radius, y, Math.cos(a0) * radius);
      const p1 = new THREE.Vector3(Math.sin(a1) * radius, y, Math.cos(a1) * radius);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(p0.distanceTo(p1) * 0.86, height, thick), neon);
      bar.position.copy(p0).add(p1).multiplyScalar(0.5);
      bar.rotation.y = Math.atan2(p1.x - p0.x, p1.z - p0.z) - Math.PI / 2;
      stage.add(bar);
    }
  };
  hexEdges(1.94, 0.005, 0.04, 0.02);
  hexEdges(1.45, 0.02, 0.025, 0.012);
  hexEdges(2.62, -0.34, 0.05, 0.06);
  stage.rotation.y = Math.PI / 6;
  rig.add(stage);

  const grid = new THREE.GridHelper(26, 52, 0xff7700, 0x26262c);
  grid.material.transparent = true; grid.material.opacity = 0.2; grid.material.depthWrite = false;
  grid.position.y = FLOOR - 0.5;
  scene.add(grid);

  // ---- Faíscas
  const COUNT = mode === 'app' ? 600 : 1200;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(COUNT * 3), pSeed = new Float32Array(COUNT), pCol = new Float32Array(COUNT * 3);
  const rnd = mulberry32(42);
  const cA = new THREE.Color(0xff7a1a), cB = new THREE.Color(0xffc04a), cC = new THREE.Color(0xff3d00);
  for (let i = 0; i < COUNT; i++) {
    const r = 1.2 + rnd() * 4.5, a = rnd() * Math.PI * 2;
    pPos.set([Math.cos(a) * r, rnd() * 7, Math.sin(a) * r - 0.5], i * 3);
    pSeed[i] = rnd();
    const c = rnd() < 0.55 ? cA : rnd() < 0.6 ? cB : cC;
    pCol.set([c.r, c.g, c.b], i * 3);
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
  const pMat = particleMaterial(pr);
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  scene.add(particles);

  // ---- Pós-processamento
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Modelo externo opcional
  fetch('/api/model').then((r) => r.json()).then(({ url }) => {
    if (!url) return;
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      const b = new THREE.Box3().setFromObject(model);
      const s = 4.2 / b.getSize(new THREE.Vector3()).y;
      model.scale.setScalar(s);
      b.setFromObject(model);
      const c = b.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -b.min.y, -c.z);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      body.clear();
      body.add(model);
    });
  }).catch(() => {});

  // ------------------------------------------------------------------ interação
  const pose = { x: 0, y: 0, z: 0, rotY: 0, rotX: 0, scale: 1, camY: 0.35 };
  const target = { ...pose };
  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  let sway = 0, spinBoost = 0, spinTarget = 0, fire = 1, fireTarget = 1;

  addEventListener('pointermove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    camera.position.z = w / h < 0.8 ? 13.5 : w / h < 1.2 ? 11 : 9.5;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let last = performance.now(), elapsed = 0, ready = false, running = true;

  function tick() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (elapsed += dt);
    const k = 1 - Math.pow(0.0025, dt);
    for (const key in pose) pose[key] += (target[key] - pose[key]) * k;
    mouseS.lerp(mouse, 1 - Math.pow(0.02, dt));
    if (!reduced) sway += dt * 0.08;
    spinBoost += (spinTarget - spinBoost) * (1 - Math.pow(0.04, dt));
    fire += (fireTarget - fire) * (1 - Math.pow(0.05, dt));

    rig.position.set(pose.x, pose.y, pose.z);
    rig.rotation.y = pose.rotY + mouseS.x * 0.55 + Math.sin(sway) * 0.25 + spinBoost;
    rig.rotation.x = pose.rotX + mouseS.y * 0.1;
    rig.scale.setScalar(pose.scale);
    camera.position.x = mouseS.x * 0.35;
    camera.position.y = pose.camY - mouseS.y * 0.2;
    camera.lookAt(pose.x * 0.35, pose.y * 0.5 + 0.1, 0);

    if (!reduced) {
      body.position.y = Math.sin(t * 2.2) * 0.025; // respiração
      torso.rotation.z = Math.sin(t * 2.2) * 0.012;
      head.rotation.y = -0.1 + Math.sin(t * 0.9) * 0.1 - mouseS.x * 0.2;
      head.rotation.x = 0.05 + mouseS.y * 0.08;
      arms[1].shoulder.rotation.z = 0.62 + Math.sin(t * 2.2) * 0.03;
      for (const { segs, s } of tails) segs.forEach((seg, i) => { seg.rotation.x = Math.sin(t * 4 + i * 0.9 + s) * 0.18; seg.rotation.z = Math.sin(t * 3 + i) * 0.1 * s; });
      for (const m of shards) {
        const u = m.userData;
        const a = u.a + t * u.sp;
        m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * u.sp * 3 + u.a) * 0.15, Math.sin(a) * u.r);
        m.rotation.set(t * u.rs, t * u.rs * 0.7, 0);
      }
    }
    ringA.rotation.z = t * 0.35; ringB.rotation.z = -t * 0.25;
    ringMatA.uniforms.uTime.value = t; ringMatB.uniforms.uTime.value = t;
    ringMatA.uniforms.uStrength.value = fire; ringMatB.uniforms.uStrength.value = fire * 0.7;
    bladeGlow.opacity = 0.45 + Math.sin(t * 7) * 0.12;
    glowLight.intensity = 4 + fire * 3 + Math.sin(t * 9) * 1;
    neon.color.setHSL(0.07, 1, 0.52 + Math.sin(t * 2) * 0.06);
    pMat.uniforms.uTime.value = reduced ? 0 : t;

    composer.render();
    if (!ready) { ready = true; onReady?.(); }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); }
  });

  return {
    setPose(p) { Object.assign(target, p); },
    setAura(strength) { fireTarget = 0.6 + strength * 0.8; },
    spin() { spinTarget += Math.PI * 2; fireTarget = 1.8; setTimeout(() => (fireTarget = 1), 900); },
    pulse() { target.scale = pose.scale * 1.05; fireTarget = 1.5; setTimeout(() => { target.scale /= 1.05; fireTarget = 1; }, 260); },
  };
}
