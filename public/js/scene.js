// LikeSystem — cena 3D viva: o shinobi (ilustração recortada) com volume por mapa de profundidade,
// em pé numa plataforma hexagonal com neon, aura de chakra em chamas atrás dele, anéis de fogo 3D
// girando em volta, estilhaços em órbita e faíscas. Respira, a câmera passeia sozinha e acompanha
// mouse, rolagem, troca de telas e giroscópio no celular.

import * as THREE from 'three';

export const HERO_CHAR = 'img/hero-char.webp';
export const HERO_DEPTH = 'img/hero-char-depth.png';
export const HERO_GLOW = 'img/hero-char-glow.png';
const CHAR_ASPECT = 444 / 1024; // recorte do personagem
const GLOW_PAD = { w: 644 / 444, h: 1224 / 1024 }; // aura tem margem em volta da silhueta

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE = /* glsl */`
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

// ---- personagem: volume, respiração, luz de fogo e contorno laranja
const charMaterial = (map, depth) => new THREE.ShaderMaterial({
  uniforms: { uMap: { value: map }, uDepth: { value: depth }, uTime: { value: 0 }, uFire: { value: 1 }, uIntro: { value: 0 } },
  vertexShader: /* glsl */`
    uniform sampler2D uDepth; uniform float uTime;
    varying vec2 vUv; varying float vD;
    void main(){
      vUv = uv;
      float d = texture2D(uDepth, uv).r;
      vD = d;
      vec3 p = position;
      float chest = smoothstep(0.42, 0.62, uv.y) * (1.0 - smoothstep(0.8, 0.9, uv.y));
      float breath = sin(uTime * 2.1);
      p.x *= 1.0 + breath * 0.008 * chest;              // peito expande
      p.y += (breath * 0.012) * smoothstep(0.4, 1.0, uv.y); // ombros e cabeça sobem
      p.z += d * 0.34;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap; uniform sampler2D uDepth; uniform float uTime; uniform float uFire; uniform float uIntro;
    varying vec2 vUv; varying float vD;
    ${NOISE}
    void main(){
      vec4 tex = texture2D(uMap, vUv);
      if (tex.a < 0.03) discard;
      vec3 col = tex.rgb;
      // ambientação: sombra fria de cima, luz de fogo quente vindo de baixo e dos lados
      col *= mix(0.82, 1.0, smoothstep(0.0, 0.6, vUv.y));
      float flick = 0.75 + 0.25 * fbm(vec2(uTime * 2.3, vUv.y * 3.0));
      col += vec3(1.0, 0.42, 0.08) * (1.0 - vUv.y) * 0.1 * uFire * flick;
      float dpx = texture2D(uDepth, vUv).r; // por pixel (contorno liso)
      float rim = (1.0 - smoothstep(0.12, 0.4, dpx)) * smoothstep(0.3, 0.9, tex.a);
      col += vec3(1.0, 0.5, 0.12) * rim * 0.75 * uFire * flick;
      // entrada: materializa de baixo para cima com uma linha de chakra
      float reveal = uIntro * 1.2 - 0.1;
      if (vUv.y > reveal + 0.02) discard;
      col += vec3(1.0, 0.6, 0.15) * exp(-pow((vUv.y - reveal) * 40.0, 2.0)) * (1.0 - uIntro) * 4.0;
      gl_FragColor = vec4(col, tex.a);
    }`,
  transparent: true,
});

// ---- aura de chakra: chamas subindo a partir da silhueta
const auraMaterial = (glow) => new THREE.ShaderMaterial({
  uniforms: { uGlow: { value: glow }, uTime: { value: 0 }, uFire: { value: 1 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uGlow; uniform float uTime; uniform float uFire;
    varying vec2 vUv;
    ${NOISE}
    void main(){
      float n = fbm(vUv * vec2(7.0, 4.0) + vec2(0.0, -uTime * 1.6));
      float n2 = fbm(vUv * vec2(14.0, 6.0) + vec2(3.1, -uTime * 2.6));
      // amostra a silhueta mais abaixo => as chamas sobem e se desfazem em línguas
      vec2 warp = vec2((n - 0.5) * 0.08, -0.05 - n2 * 0.1);
      float g = texture2D(uGlow, vUv + warp).r;
      float tongues = smoothstep(0.45, 0.85, n2 + n * 0.35);
      float flames = smoothstep(0.18, 0.7, g) * (0.35 + 0.95 * tongues);
      float inner = smoothstep(0.55, 0.95, texture2D(uGlow, vUv).r);
      vec3 col = mix(vec3(0.9, 0.18, 0.0), vec3(1.0, 0.62, 0.12), smoothstep(0.3, 1.0, flames));
      col = mix(col, vec3(1.0, 0.85, 0.45), smoothstep(0.85, 1.3, flames));
      float a = clamp(flames * 0.8 - inner * 0.25, 0.0, 1.0) * uFire * (0.85 + 0.15 * sin(uTime * 3.0));
      gl_FragColor = vec4(col * a * 1.3, a);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
});

const ringMaterial = (color, strength) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform vec3 uColor; uniform float uStrength; varying vec2 vUv;
    ${NOISE}
    void main(){
      float a = vUv.x * 48.0;
      float flame = noise(vec2(a - uTime * 6.0, 0.0)) * 0.6 + noise(vec2(a * 2.3 + uTime * 9.0, 3.0)) * 0.4;
      float gap = smoothstep(0.2, 0.5, noise(vec2(vUv.x * 7.0 - uTime * 1.2, 7.0)));
      float core = 1.0 - abs(vUv.y - 0.5) * 2.0;
      float v = pow(core, 1.6) * (0.3 + flame) * gap;
      gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.93, 0.7), v * v) * v * uStrength * 3.0, v);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

function particleMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: pixelRatio }, uBoost: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPR; uniform float uBoost; attribute float aSeed; attribute vec3 aColor;
      varying vec3 vColor; varying float vA;
      void main(){
        vec3 p = position;
        float h = mod(p.y + uTime * (0.25 + aSeed * 0.6) * uBoost, 6.0) - 3.0;
        p.y = h;
        p.x += sin(uTime * 0.8 + aSeed * 30.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (9.0 + aSeed * 24.0) * uPR / -mv.z;
        vColor = aColor;
        vA = smoothstep(-3.0, -2.3, h) * (1.0 - smoothstep(1.6, 3.0, h)) * (0.45 + aSeed * 0.55) * (0.6 + 0.4 * sin(uTime * 8.0 + aSeed * 50.0));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vColor * a * 1.8, a * vA); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function createScene(canvas, { mode = 'landing', onReady, image = HERO_CHAR, depth = HERO_DEPTH, glow = HERO_GLOW } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, mode === 'app' ? 1.5 : 2);
  renderer.setPixelRatio(pr);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070a);
  scene.fog = new THREE.FogExp2(0x07070a, 0.05);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.2, 9.5);
  let baseZ = 9.5;

  scene.add(new THREE.HemisphereLight(0xffd2a8, 0x1a0c05, 0.8));
  const key = new THREE.DirectionalLight(0xffe6cc, 1.4);
  key.position.set(2, 5, 5); scene.add(key);
  const fireLight = new THREE.PointLight(0xff6a00, 12, 8, 2);
  fireLight.position.set(0, -1.2, 1.5); scene.add(fireLight);

  const rig = new THREE.Group();
  scene.add(rig);
  const FLOOR = -2.05;

  // ---- texturas
  const loaded = { a: false, b: false, c: false };
  let ready = false, introStart = 0;
  const check = () => { if (loaded.a && loaded.b && loaded.c && !ready) { ready = true; introStart = performance.now(); onReady?.(); } };
  const loader = new THREE.TextureLoader();
  const mapTex = loader.load(image, () => { loaded.a = true; check(); });
  const depthTex = loader.load(depth, () => { loaded.b = true; check(); });
  const glowTex = loader.load(glow, () => { loaded.c = true; check(); });
  for (const t of [mapTex, depthTex, glowTex]) { t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  mapTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  setTimeout(() => { loaded.a = loaded.b = loaded.c = true; check(); }, 6000);

  // ---- personagem + aura
  const CH = 4.25, CW = CH * CHAR_ASPECT;
  const hero = new THREE.Group();
  hero.position.y = FLOOR + CH / 2 - 0.02;
  rig.add(hero);
  const charMat = charMaterial(mapTex, depthTex);
  const character = new THREE.Mesh(new THREE.PlaneGeometry(CW, CH, 120, 260), charMat);
  character.renderOrder = 1;
  const auraMat = auraMaterial(glowTex);
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(CW * GLOW_PAD.w * 1.15, CH * GLOW_PAD.h * 1.08), auraMat);
  aura.position.set(0, CH * 0.03, -0.12);
  hero.add(aura, character);

  // ---- plataforma hexagonal com neon
  const stage = new THREE.Group();
  stage.position.y = FLOOR;
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x16171c, metalness: 0.75, roughness: 0.35, flatShading: true });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.2, 6), metalDark);
  top.position.y = -0.1;
  const inset = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.02, 6), new THREE.MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.6, roughness: 0.5 }));
  inset.position.y = 0.005;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.28, 6), metalDark);
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
  hexEdges(1.74, 0.005, 0.04, 0.02);
  hexEdges(1.3, 0.02, 0.025, 0.012);
  hexEdges(2.37, -0.34, 0.05, 0.06);
  stage.rotation.y = Math.PI / 6;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.9), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = FLOOR + 0.03;
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(255,110,20,0.55)'], [0.45, 'rgba(255,80,0,0.15)'], [1, 'rgba(0,0,0,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  pool.rotation.x = -Math.PI / 2; pool.position.y = FLOOR + 0.025;
  rig.add(stage, pool, shadow);

  const grid = new THREE.GridHelper(26, 52, 0xff7700, 0x26262c);
  grid.material.transparent = true; grid.material.opacity = 0.18; grid.material.depthWrite = false;
  grid.position.y = FLOOR - 0.5;
  scene.add(grid);

  // feixe de luz atrás do personagem
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 7), new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv;
      void main(){ float x = 1.0 - abs(vUv.x - 0.5) * 2.0; float a = pow(x, 3.0) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y)) * (0.16 + 0.04 * sin(uTime * 1.7));
      gl_FragColor = vec4(vec3(1.0, 0.45, 0.1) * a, a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  beam.position.set(0, FLOOR + 3.2, -0.9);
  rig.add(beam);

  // ---- anéis de fogo e estilhaços em volta do personagem
  const fx = new THREE.Group();
  fx.position.y = FLOOR + 2.0;
  rig.add(fx);
  const ringMatA = ringMaterial(0xff6a00, 1);
  const ringMatB = ringMaterial(0xffb030, 0.8);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.06, 10, 260), ringMatA);
  ringA.rotation.set(1.25, 0.25, 0);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.04, 10, 260), ringMatB);
  ringB.rotation.set(1.8, -0.35, 0.3);
  ringB.position.y = -0.4;
  ringA.renderOrder = ringB.renderOrder = 2;
  fx.add(ringA, ringB);
  const shardMats = [0xff7a1a, 0xffc04a, 0xff4d00].map((color) => new THREE.MeshBasicMaterial({ color }));
  const shardGeo = new THREE.TetrahedronGeometry(0.05, 0);
  const shards = [];
  const srnd = mulberry32(21);
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(shardGeo, shardMats[Math.floor(srnd() * 3)]);
    m.userData = { r: 1.1 + srnd() * 1.0, a: srnd() * Math.PI * 2, y: (srnd() - 0.5) * 3.2, sp: (0.15 + srnd() * 0.35) * (srnd() < 0.5 ? 1 : -1), rs: 0.6 + srnd() * 2.4 };
    m.scale.setScalar(0.6 + srnd() * 1.5);
    fx.add(m);
    shards.push(m);
  }

  // ---- faíscas
  const COUNT = mode === 'app' ? 380 : 800;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(COUNT * 3), pSeed = new Float32Array(COUNT), pCol = new Float32Array(COUNT * 3);
  const rnd = mulberry32(42);
  const cols = [new THREE.Color(0xff7a1a), new THREE.Color(0xffb640), new THREE.Color(0xff4a00)];
  for (let i = 0; i < COUNT; i++) {
    const r = 0.8 + rnd() * 3.8, a = rnd() * Math.PI * 2;
    pPos.set([Math.cos(a) * r, rnd() * 6, Math.sin(a) * r * 0.7 + 0.6], i * 3);
    pSeed[i] = rnd();
    const c = cols[Math.floor(rnd() * cols.length)];
    pCol.set([c.r, c.g, c.b], i * 3);
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3));
  const pMat = particleMaterial(pr);
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  rig.add(particles);

  // ------------------------------------------------------------------ interação
  const pose = { x: 0, y: 0, z: 0, rotY: 0, rotX: 0, scale: 1, camY: 0.2 };
  const target = { ...pose };
  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  let fire = 1, fireTarget = 1, boost = 3, wiggle = 0;

  addEventListener('pointermove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
  addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    mouse.set(Math.max(-1, Math.min(1, e.gamma / 25)), Math.max(-1, Math.min(1, (e.beta - 45) / 25)));
  }, { passive: true });

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    baseZ = w / h < 0.8 ? 13.5 : w / h < 1.2 ? 11 : 9.5;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let last = performance.now(), elapsed = 0, running = true;
  const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  function tick() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (elapsed += reduced ? 0 : dt);
    const k = 1 - Math.pow(0.0025, dt);
    for (const key in pose) pose[key] += (target[key] - pose[key]) * k;
    mouseS.lerp(mouse, 1 - Math.pow(0.03, dt));
    fire += (fireTarget - fire) * (1 - Math.pow(0.05, dt));
    boost += (1 - boost) * (1 - Math.pow(0.15, dt));
    wiggle *= Math.pow(0.08, dt);
    const intro = ready ? (reduced ? 1 : ease((now - introStart) / 1700)) : 0;

    // câmera passeando sozinha + pose da seção + mouse/giroscópio
    const idleY = Math.sin(t * 0.35) * 0.22 + Math.sin(t * 0.13) * 0.08;
    const tiltY = Math.sin(pose.rotY) * 0.3 + idleY + mouseS.x * 0.35 + Math.sin(t * 9) * wiggle * 0.1;
    rig.position.set(pose.x, pose.y, pose.z);
    rig.rotation.set(pose.rotX * 0.5 + Math.sin(t * 0.27) * 0.04 + mouseS.y * 0.1, tiltY, 0);
    rig.scale.setScalar(pose.scale * (0.92 + 0.08 * intro));
    hero.rotation.y = -tiltY * 0.35; // personagem acompanha a câmera (não fica de lado demais)
    hero.rotation.z = Math.sin(t * 0.9) * 0.006;
    camera.position.set(mouseS.x * 0.3 + Math.sin(t * 0.21) * 0.25, pose.camY - mouseS.y * 0.15, baseZ + Math.sin(t * 0.18) * 0.3 + (1 - intro) * 1.4);
    camera.lookAt(pose.x * 0.35, pose.y * 0.5 + 0.05, 0);

    const f = fire * (0.4 + 0.6 * intro);
    charMat.uniforms.uTime.value = t; charMat.uniforms.uFire.value = f; charMat.uniforms.uIntro.value = intro;
    auraMat.uniforms.uTime.value = t; auraMat.uniforms.uFire.value = f * intro;
    beam.material.uniforms.uTime.value = t;
    fireLight.intensity = 8 + f * 6 + Math.sin(t * 9) * 1.5;
    neon.color.setHSL(0.07, 1, 0.5 + Math.sin(t * 2) * 0.06);

    ringA.rotation.z = t * 0.6; ringB.rotation.z = -t * 0.45;
    ringA.rotation.x = 1.25 + Math.sin(t * 0.5) * 0.08;
    ringMatA.uniforms.uTime.value = t; ringMatB.uniforms.uTime.value = t;
    ringMatA.uniforms.uStrength.value = f * intro; ringMatB.uniforms.uStrength.value = f * intro * 0.8;
    for (const m of shards) {
      const u = m.userData;
      const a = u.a + t * u.sp;
      m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.8 + u.a) * 0.12, Math.sin(a) * u.r * 0.7);
      m.rotation.set(t * u.rs, t * u.rs * 0.7, 0);
      m.visible = intro > 0.4;
    }
    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uBoost.value = boost;

    renderer.render(scene, camera);
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
    spin() { fireTarget = 2.4; boost = 5; wiggle = 1; setTimeout(() => (fireTarget = 1), 1000); },
    pulse() { target.scale = pose.scale * 1.04; fireTarget = 1.7; boost = 2.5; setTimeout(() => { target.scale /= 1.04; fireTarget = 1; }, 260); },
  };
}
