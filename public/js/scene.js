// LikeSystem — arte principal viva: a ilustração do shinobi em "foto 3D" (malha deslocada por
// mapa de profundidade) com câmera passeando sozinha, personagem flutuando, fogo em movimento,
// anéis de fogo 3D girando em volta dele, estilhaços em órbita, faíscas, painéis holográficos
// com brilho e falhas de sinal, entrada cinematográfica e inclinação por mouse/giroscópio.

import * as THREE from 'three';

export const HERO_IMAGE = 'img/hero.jpg';
export const HERO_DEPTH = 'img/hero-depth.png';
const ASPECT = 1024 / 559;

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
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const heroMaterial = (map, depth) => new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: map }, uDepth: { value: depth }, uTime: { value: 0 }, uFire: { value: 1 },
    uDepthAmt: { value: 0.95 }, uMouse: { value: new THREE.Vector2() }, uCrop: { value: 0 }, uIntro: { value: 0 },
  },
  vertexShader: /* glsl */`
    uniform sampler2D uDepth; uniform float uTime; uniform float uDepthAmt; uniform float uCrop;
    varying vec2 vUv; varying vec2 vArt; varying float vD;
    void main(){
      vUv = uv;
      vArt = vec2(mix(uv.x, 0.3 + uv.x * 0.42, uCrop), uv.y); // recorte só do personagem
      float d = texture2D(uDepth, vArt).r;
      vD = d;
      float hero = smoothstep(0.5, 0.85, d);
      vec3 p = position;
      p.z += d * uDepthAmt;
      p.y += sin(uTime * 1.6) * 0.045 * hero;          // personagem flutua
      p.z += sin(uTime * 1.6 + 1.2) * 0.05 * hero;     // e respira em profundidade
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap; uniform float uTime; uniform float uFire; uniform vec2 uMouse; uniform float uCrop; uniform float uIntro;
    varying vec2 vUv; varying vec2 vArt; varying float vD;
    ${NOISE}
    void main(){
      vec2 uv = vArt + uMouse * (vD - 0.3) * 0.006;
      vec3 base = texture2D(uMap, uv).rgb;

      // fogo em movimento: pixels laranja/amarelos brilhantes escorrem para cima com ruído
      float fire = smoothstep(0.2, 0.6, base.r - base.b) * smoothstep(0.55, 0.95, max(base.r, base.g));
      vec2 flow = vec2(fbm(uv * vec2(38.0, 22.0) + vec2(0.0, -uTime * 2.4)), fbm(uv * vec2(30.0, 18.0) + vec2(5.2, -uTime * 3.1))) - 0.5;
      vec3 col = texture2D(uMap, uv + flow * 0.009 * fire).rgb;
      float flick = fbm(uv * 14.0 + vec2(uTime * 0.7, -uTime * 2.0));
      col *= 1.0 + fire * uFire * (0.1 + 0.45 * flick);
      col += vec3(1.0, 0.45, 0.05) * fire * pow(flick, 3.0) * 0.35 * uFire;

      // painéis holográficos: faixa de luz varrendo + falha de sinal de vez em quando
      float panels = (1.0 - smoothstep(0.26, 0.32, vArt.x)) + smoothstep(0.68, 0.74, vArt.x);
      panels *= step(vD, 0.8) * (1.0 - uCrop);
      float sweepPos = fract(uTime * 0.16) * 2.2 - 0.6;
      float band = exp(-pow((vArt.y * 0.8 + vArt.x * 0.35 - sweepPos) * 22.0, 2.0));
      col += vec3(1.0, 0.55, 0.12) * band * 0.35 * panels;
      float g = step(0.965, fract(uTime * 0.23)) * panels;
      if (g > 0.0) {
        float row = floor(vArt.y * 45.0);
        float shift = (hash(vec2(row, floor(uTime * 30.0))) - 0.5) * 0.02;
        col = vec3(texture2D(uMap, uv + vec2(shift + 0.004, 0.0)).r, texture2D(uMap, uv + vec2(shift, 0.0)).g, texture2D(uMap, uv + vec2(shift - 0.004, 0.0)).b);
      }
      col += vec3(0.9, 0.5, 0.15) * panels * 0.03 * step(0.5, fract(vArt.y * 180.0 + uTime * 2.0)); // linhas de varredura

      // entrada: revela de baixo para cima com uma linha de fogo
      float reveal = uIntro * 1.25 - 0.1;
      float edge = smoothstep(reveal, reveal - 0.08, 1.0 - vArt.y);
      col += vec3(1.0, 0.5, 0.1) * exp(-pow((1.0 - vArt.y - reveal) * 30.0, 2.0)) * (1.0 - uIntro) * 3.0;

      // bordas somem no fundo (sem cara de cartão): superelipse suave
      vec2 q = abs(vUv - 0.5) * 2.0;
      float ex = mix(6.0, 2.6, uCrop);
      float r = pow(pow(q.x, ex) + pow(q.y, ex), 1.0 / ex);
      float alpha = smoothstep(1.0, mix(0.8, 0.62, uCrop), r) * edge;
      gl_FragColor = vec4(col, alpha);
    }`,
  transparent: true,
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
      gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.93, 0.7), v * v) * v * uStrength * 3.2, v);
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
        p.x += sin(uTime * 0.8 + aSeed * 30.0) * 0.35;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (9.0 + aSeed * 26.0) * uPR / -mv.z;
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

export function createScene(canvas, { mode = 'landing', onReady, image = HERO_IMAGE, depth = HERO_DEPTH } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, mode === 'app' ? 1.5 : 2);
  renderer.setPixelRatio(pr);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070a);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.2, 9.5);
  let baseZ = 9.5;

  const rig = new THREE.Group();
  scene.add(rig);

  // ---- Arte principal com profundidade
  const loaded = { map: false, depth: false };
  let ready = false, introStart = 0;
  const check = () => {
    if (loaded.map && loaded.depth && !ready) { ready = true; introStart = performance.now(); onReady?.(); }
  };
  const loader = new THREE.TextureLoader();
  const map = loader.load(image, () => { loaded.map = true; check(); });
  const depthTex = loader.load(depth, () => { loaded.depth = true; check(); });
  for (const t of [map, depthTex]) { t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  setTimeout(() => { loaded.map = loaded.depth = true; check(); }, 6000);

  const W = 6.4, H = W / ASPECT;
  const heroMat = heroMaterial(map, depthTex);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 256, 140), heroMat);
  rig.add(art);

  // ---- Efeitos 3D em volta do personagem
  const fx = new THREE.Group();
  fx.position.set(0.05, 0.12, 0);
  rig.add(fx);
  const ringMatA = ringMaterial(0xff6a00, 1);
  const ringMatB = ringMaterial(0xffb030, 0.8);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.07, 10, 260), ringMatA);
  ringA.position.z = 0.75; ringA.rotation.set(1.2, 0.25, 0);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.045, 10, 260), ringMatB);
  ringB.position.z = 0.7; ringB.rotation.set(1.85, -0.4, 0.3);
  ringA.renderOrder = ringB.renderOrder = 2;
  fx.add(ringA, ringB);

    const shardMats = [
    new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
    new THREE.MeshBasicMaterial({ color: 0xffc04a }),
    new THREE.MeshBasicMaterial({ color: 0xff4d00 }),
  ];
  const shardGeo = new THREE.TetrahedronGeometry(0.05, 0);
  const shards = [];
  const srnd = mulberry32(21);
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(shardGeo, shardMats[Math.floor(srnd() * 3)]);
    m.userData = { r: 1.0 + srnd() * 1.1, a: srnd() * Math.PI * 2, y: (srnd() - 0.5) * 2.4, sp: (0.15 + srnd() * 0.35) * (srnd() < 0.5 ? 1 : -1), rs: 0.6 + srnd() * 2.4, z: 0.8 };
    m.scale.setScalar(0.6 + srnd() * 1.6);
    fx.add(m);
    shards.push(m);
  }

  // ---- Faíscas
  const COUNT = mode === 'app' ? 380 : 800;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(COUNT * 3), pSeed = new Float32Array(COUNT), pCol = new Float32Array(COUNT * 3);
  const rnd = mulberry32(42);
  const cols = [new THREE.Color(0xff7a1a), new THREE.Color(0xffb640), new THREE.Color(0xff4a00)];
  for (let i = 0; i < COUNT; i++) {
    pPos.set([(rnd() - 0.5) * 7.5, rnd() * 6, 0.4 + rnd() * 2.8], i * 3);
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
  const pose = { x: 0, y: 0, z: 0, rotY: 0, rotX: 0, scale: 1, camY: 0.2, crop: 0 };
  const target = { ...pose };
  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  let fire = 1, fireTarget = 1, boost = 3, wiggle = 0;

  addEventListener('pointermove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });
  // celular: inclina com o giroscópio (quando o navegador permite)
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
    const intro = ready ? (reduced ? 1 : ease((now - introStart) / 1800)) : 0;

    // câmera passeando sozinha + mouse/giroscópio
    const idleY = Math.sin(t * 0.35) * 0.16 + Math.sin(t * 0.13) * 0.06;
    const idleX = Math.sin(t * 0.27) * 0.05;
    const tiltY = Math.sin(pose.rotY) * 0.2 + idleY + mouseS.x * 0.3 + Math.sin(t * 9) * wiggle * 0.08;
    rig.position.set(pose.x, pose.y, pose.z);
    rig.rotation.set(pose.rotX * 0.6 + idleX + mouseS.y * 0.12, tiltY, 0);
    rig.scale.setScalar(pose.scale * (0.9 + 0.1 * intro));
    camera.position.set(mouseS.x * 0.3 + Math.sin(t * 0.21) * 0.25, pose.camY - mouseS.y * 0.15, baseZ + Math.sin(t * 0.18) * 0.35 + (1 - intro) * 1.5);
    camera.lookAt(pose.x * 0.35, pose.y * 0.5, 0);

    art.scale.x = 1 - pose.crop * 0.58;
    heroMat.uniforms.uCrop.value = pose.crop;
    heroMat.uniforms.uTime.value = t;
    heroMat.uniforms.uFire.value = fire + (1 - intro) * 1.5;
    heroMat.uniforms.uMouse.value.copy(mouseS);
    heroMat.uniforms.uIntro.value = intro;

    fx.scale.setScalar(1 - pose.crop * 0.08);
    ringA.rotation.z = t * 0.6; ringB.rotation.z = -t * 0.45;
    ringA.rotation.x = 1.2 + Math.sin(t * 0.5) * 0.08;
    const rs = fire * intro;
    ringMatA.uniforms.uTime.value = t; ringMatB.uniforms.uTime.value = t;
    ringMatA.uniforms.uStrength.value = rs; ringMatB.uniforms.uStrength.value = rs * 0.8;
    for (const m of shards) {
      const u = m.userData;
      const a = u.a + t * u.sp;
      m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.8 + u.a) * 0.12, u.z + Math.sin(a) * u.r * 0.6);
      m.rotation.set(t * u.rs, t * u.rs * 0.7, 0);
      m.visible = intro > 0.3;
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
