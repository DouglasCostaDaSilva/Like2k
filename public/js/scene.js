// LikeSystem — arte principal em "foto 3D": a ilustração do shinobi ganha volume real
// (malha deslocada por um mapa de profundidade), inclina com o mouse e a rolagem,
// respira, tem o fogo tremulando e faíscas voando na frente.

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

const heroMaterial = (map, depth) => new THREE.ShaderMaterial({
  uniforms: {
    uMap: { value: map }, uDepth: { value: depth }, uTime: { value: 0 }, uFire: { value: 1 },
    uDepthAmt: { value: 0.7 }, uMouse: { value: new THREE.Vector2() }, uCrop: { value: 0 },
  },
  vertexShader: /* glsl */`
    uniform sampler2D uDepth; uniform float uTime; uniform float uDepthAmt; uniform float uCrop;
    varying vec2 vUv; varying vec2 vArt; varying float vD;
    void main(){
      vUv = uv;
      vArt = vec2(mix(uv.x, 0.3 + uv.x * 0.42, uCrop), uv.y); // recorte só do personagem
      float d = texture2D(uDepth, vArt).r;
      vD = d;
      vec3 p = position;
      p.z += d * uDepthAmt + sin(uTime * 2.2) * 0.02 * smoothstep(0.5, 0.9, d); // respiração
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uMap; uniform float uTime; uniform float uFire; uniform vec2 uMouse; uniform float uCrop;
    varying vec2 vUv; varying vec2 vArt; varying float vD;
    void main(){
      vec2 uv = vArt + uMouse * (vD - 0.3) * 0.006; // paralaxe fina extra
      vec3 col = texture2D(uMap, uv).rgb;
      // fogo e neon tremulando: realça tons laranja
      float orange = smoothstep(0.25, 0.7, col.r - col.b) * smoothstep(0.35, 0.8, col.r);
      float flick = 0.5 + 0.5 * sin(uTime * 7.0 + vUv.x * 18.0 + vUv.y * 9.0);
      col *= 1.0 + orange * uFire * (0.06 + 0.12 * flick);
      // bordas somem no fundo escuro
      float e = mix(0.07, 0.2, uCrop);
      float fx = smoothstep(0.0, e, vUv.x) * smoothstep(1.0, 1.0 - e, vUv.x);
      float fy = smoothstep(0.0, 0.09, vUv.y) * smoothstep(1.0, 0.95, vUv.y);
      gl_FragColor = vec4(col, fx * fy);
    }`,
  transparent: true,
});

function particleMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: pixelRatio }, uBoost: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPR; uniform float uBoost; attribute float aSeed; attribute vec3 aColor;
      varying vec3 vColor; varying float vA;
      void main(){
        vec3 p = position;
        float h = mod(p.y + uTime * (0.2 + aSeed * 0.45) * uBoost, 6.0) - 3.0;
        p.y = h;
        p.x += sin(uTime * 0.7 + aSeed * 30.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (8.0 + aSeed * 20.0) * uPR / -mv.z;
        vColor = aColor;
        vA = smoothstep(-3.0, -2.3, h) * (1.0 - smoothstep(1.8, 3.0, h)) * (0.4 + aSeed * 0.6);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vColor * a * 1.6, a * vA); }`,
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

  const rig = new THREE.Group();
  scene.add(rig);

  // ---- Arte principal com profundidade
  const loader = new THREE.TextureLoader();
  const map = loader.load(image, () => { loaded.map = true; check(); });
  const depthTex = loader.load(depth, () => { loaded.depth = true; check(); });
  for (const t of [map, depthTex]) { t.colorSpace = THREE.NoColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const W = 6.4, H = W / ASPECT;
  const heroMat = heroMaterial(map, depthTex);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 256, 140), heroMat);
  rig.add(art);
  const loaded = { map: false, depth: false };
  let ready = false;
  function check() { if (loaded.map && loaded.depth && !ready) { ready = true; onReady?.(); } }
  setTimeout(() => { if (!ready) { ready = true; onReady?.(); } }, 5000);

  // ---- Faíscas na frente e em volta da arte
  const COUNT = mode === 'app' ? 360 : 700;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(COUNT * 3), pSeed = new Float32Array(COUNT), pCol = new Float32Array(COUNT * 3);
  const rnd = mulberry32(42);
  const cols = [new THREE.Color(0xff7a1a), new THREE.Color(0xffb640), new THREE.Color(0xff4a00)];
  for (let i = 0; i < COUNT; i++) {
    pPos.set([(rnd() - 0.5) * 7, rnd() * 6, 0.3 + rnd() * 2.6], i * 3);
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
  let fire = 1, fireTarget = 1, boost = 1, wiggle = 0;

  addEventListener('pointermove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 0.8 ? 13.5 : w / h < 1.2 ? 11 : 9.5;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let last = performance.now(), elapsed = 0, running = true;

  function tick() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (elapsed += dt);
    const k = 1 - Math.pow(0.0025, dt);
    for (const key in pose) pose[key] += (target[key] - pose[key]) * k;
    mouseS.lerp(mouse, 1 - Math.pow(0.03, dt));
    fire += (fireTarget - fire) * (1 - Math.pow(0.05, dt));
    boost += (1 - boost) * (1 - Math.pow(0.1, dt));
    wiggle *= Math.pow(0.08, dt);

    // a pose de cada seção vira uma inclinação diferente da arte (rotY é o ângulo da seção)
    const tiltY = Math.sin(pose.rotY) * 0.22 + mouseS.x * 0.28 + Math.sin(t * 9) * wiggle * 0.08;
    rig.position.set(pose.x, pose.y + (reduced ? 0 : Math.sin(t * 1.1) * 0.04), pose.z);
    rig.rotation.set(pose.rotX * 0.6 + mouseS.y * 0.12, tiltY, 0);
    rig.scale.setScalar(pose.scale);
    camera.position.x = mouseS.x * 0.3;
    camera.position.y = pose.camY - mouseS.y * 0.15;
    camera.lookAt(pose.x * 0.35, pose.y * 0.5, 0);

    heroMat.uniforms.uCrop.value = pose.crop;
    art.scale.x = 1 - pose.crop * 0.58;
    heroMat.uniforms.uTime.value = reduced ? 0 : t;
    heroMat.uniforms.uFire.value = fire;
    heroMat.uniforms.uMouse.value.copy(mouseS);
    pMat.uniforms.uTime.value = reduced ? 0 : t;
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
    spin() { fireTarget = 2.2; boost = 4; wiggle = 1; setTimeout(() => (fireTarget = 1), 900); },
    pulse() { target.scale = pose.scale * 1.04; fireTarget = 1.6; setTimeout(() => { target.scale /= 1.04; fireTarget = 1; }, 260); },
  };
}
