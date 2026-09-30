// LikeSystem — cena 3D com personagem de verdade: um shinobi 3D com esqueleto e animações
// (parado, andando, correndo), roupa laranja e preta, cabelo loiro espetado, bandana e rosto anime,
// em sombreamento de desenho (toon + contorno). Ele anda pela plataforma hexagonal, vira para o
// mouse, corre quando um envio dá certo e tem aura de chakra, anéis de fogo, estilhaços e faíscas.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

// No arquivo único (sem servidor) o modelo vem embutido na janela principal.
const MODEL_URL = (() => { try { return window.parent.__LS_MODEL || 'models/ninja.glb'; } catch { return 'models/ninja.glb'; } })();

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
`;

const NO_OUTLINE = { visible: false };
const noOutline = (m) => { m.userData.outlineParameters = NO_OUTLINE; return m; };

// sombreamento de anime: 3 faixas de luz
function toonGradient() {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

// ---- roupa pintada por região do corpo (coordenadas da pose de referência, normalizadas pela altura)
function outfitMaterial(gradientMap) {
  const col = (hex) => new THREE.Color(hex);
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap });
  const uniforms = {
    cSkin: { value: col(0xf6c9a4) }, cDark: { value: col(0x3d3f4a) }, cOrange: { value: col(0xf2711c) },
    cZip: { value: col(0xb9bcc4) }, cWhite: { value: col(0xe9e9e9) }, cSandal: { value: col(0x4a4d55) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBind;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = aBind;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBind;
        uniform vec3 cSkin, cDark, cOrange, cZip, cWhite, cSandal;
        vec3 zone(vec3 b){
          float h = b.y, ax = abs(b.x), z = b.z;
          if (ax > 0.372) return cSkin;                              // mãos
          if (h > 0.848) return cSkin;                               // cabeça
          if (h > 0.785 && ax < 0.07) return cDark;                  // gola alta
          if (h > 0.70 && ax > 0.1) return cDark;                    // mangas
          if (h > 0.515) {                                           // jaqueta
            if (z > 0.0 && ax < 0.0045 && h < 0.8) return cZip;
            if (z > -0.005 && ax > 0.011 && ax < 0.085 && h > 0.56 && h < 0.735) return cOrange;
            return cDark;
          }
          if (h > 0.07) {                                            // calça
            if (b.x < -0.02 && h > 0.33 && h < 0.372) return (h > 0.346 && h < 0.356) ? cDark : cWhite; // faixa na coxa
            return cOrange;
          }
          if (z > 0.055 && h < 0.03) return cSkin;                   // dedos
          return cSandal;                                            // sandálias
        }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( zone(vBind), opacity );');
  };
  m.userData.outlineParameters = { thickness: 0.0045, color: [0.05, 0.03, 0.03] };
  return m;
}

// ---- aura de chakra que acompanha o corpo (casca inflada, brilho nas bordas)
function auraMaterial() {
  return noOutline(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFire: { value: 1 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <skinning_pars_vertex>
      uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vH;
      void main(){
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        transformed += normalize(objectNormal) * (0.02 + 0.01 * sin(uTime * 7.0 + position.y * 18.0));
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vN = normalize(normalMatrix * objectNormal); vV = normalize(-mv.xyz); vH = transformed.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uFire; varying vec3 vN; varying vec3 vV; varying float vH;
      ${NOISE}
      void main(){
        float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
        float flick = 0.6 + 0.6 * noise(vec2(vH * 6.0 - uTime * 4.0, uTime));
        float a = f * flick * uFire;
        gl_FragColor = vec4(mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.8, 0.3), f) * a * 1.4, a);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

const ringMaterial = (color, strength) => noOutline(new THREE.ShaderMaterial({
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
}));

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

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const radialTexture = (stops) => canvasTexture(256, 256, (g) => {
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, c] of stops) grd.addColorStop(o, c);
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
});

// placa da bandana com a espiral gravada
const plateTexture = () => canvasTexture(256, 110, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#eef1f5'); grd.addColorStop(0.55, '#aeb4bd'); grd.addColorStop(1, '#d8dde3');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#41464f'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath();
  for (let a = 0; a <= Math.PI * 4.4; a += 0.03) { const r = 3.1 * a; const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r; a === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
  g.stroke();
  g.strokeStyle = '#555b64'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  for (const [x, y] of [[16, 16], [w - 16, 16], [16, h - 16], [w - 16, h - 16]]) { g.fillStyle = '#6a7079'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
});

// rosto de anime desenhado numa textura transparente
const faceTexture = () => canvasTexture(512, 256, (g, w) => {
  const eye = (cx, flip) => {
    g.save(); g.translate(cx, 128); g.scale(flip, 1);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(0, 6, 46, 30, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f7de0'; g.beginPath(); g.ellipse(-4, 8, 22, 26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1b3f8a'; g.beginPath(); g.ellipse(-4, 12, 11, 14, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-12, 0, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1d140f'; g.lineWidth = 8; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-48, 0); g.quadraticCurveTo(-5, -30, 46, -8); g.stroke(); // pálpebra
    g.lineWidth = 9; g.strokeStyle = '#b8860b';
    g.beginPath(); g.moveTo(-46, -48); g.lineTo(40, -30); g.stroke(); // sobrancelha determinada
    g.restore();
  };
  eye(w / 2 - 92, 1);
  eye(w / 2 + 92, -1);
  g.strokeStyle = '#5c2b1e'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(w / 2 - 26, 232); g.quadraticCurveTo(w / 2, 238, w / 2 + 26, 230); g.stroke(); // boca
});

const whiskerTexture = () => canvasTexture(256, 128, (g) => {
  g.strokeStyle = '#6b3b24'; g.lineWidth = 5; g.lineCap = 'round';
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const y = 44 + i * 18, x0 = 128 + side * 70, x1 = 128 + side * 118;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y + (i - 1) * 5); g.stroke();
  }
});

export function createScene(canvas, { mode = 'landing', onReady } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, mode === 'app' ? 1.5 : 2);
  renderer.setPixelRatio(pr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const effect = new OutlineEffect(renderer, { defaultThickness: 0.004, defaultColor: [0.05, 0.03, 0.03] });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070a);
  scene.fog = new THREE.FogExp2(0x07070a, 0.05);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.2, 9.5);
  let baseZ = 9.5;

  scene.add(new THREE.HemisphereLight(0xfff0e0, 0x2a1408, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.5, 6, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 4, bottom: -3 });
  key.shadow.bias = -0.0008;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff7a2a, 1.6);
  rim.position.set(-4, 3, -5); scene.add(rim);
  const fireLight = new THREE.PointLight(0xff6a00, 10, 8, 2);
  fireLight.position.set(0, -1.2, 1.5); scene.add(fireLight);

  const rig = new THREE.Group();
  scene.add(rig);
  const FLOOR = -2.05;
  const HEIGHT = 4.1; // altura do personagem na cena

  const hero = new THREE.Group(); // posição/rotação do personagem sobre a plataforma
  hero.position.y = FLOOR;
  rig.add(hero);

  // ---- plataforma hexagonal com neon
  const stage = new THREE.Group();
  stage.position.y = FLOOR;
  const metalDark = noOutline(new THREE.MeshStandardMaterial({ color: 0x16171c, metalness: 0.75, roughness: 0.35, flatShading: true }));
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.2, 6), metalDark);
  top.position.y = -0.1; top.receiveShadow = true;
  const inset = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.02, 6), noOutline(new THREE.MeshStandardMaterial({ color: 0x101015, metalness: 0.6, roughness: 0.5 })));
  inset.position.y = 0.005; inset.receiveShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.28, 6), metalDark);
  base.position.y = -0.34;
  stage.add(top, inset, base);
  const neon = noOutline(new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
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
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), noOutline(new THREE.MeshBasicMaterial({
    map: radialTexture([[0, 'rgba(255,110,20,0.5)'], [0.45, 'rgba(255,80,0,0.14)'], [1, 'rgba(0,0,0,0)']]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })));
  pool.rotation.x = -Math.PI / 2; pool.position.y = FLOOR + 0.025;
  rig.add(stage, pool);

  const grid = new THREE.GridHelper(26, 52, 0xff7700, 0x26262c);
  grid.material.transparent = true; grid.material.opacity = 0.18; grid.material.depthWrite = false;
  grid.position.y = FLOOR - 0.5;
  scene.add(grid);

  const beam = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 7), noOutline(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uTime; varying vec2 vUv;
      void main(){ float x = 1.0 - abs(vUv.x - 0.5) * 2.0; float a = pow(x, 3.0) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y)) * (0.16 + 0.04 * sin(uTime * 1.7));
      gl_FragColor = vec4(vec3(1.0, 0.45, 0.1) * a, a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })));
  beam.position.set(0, FLOOR + 3.2, -1.6);
  rig.add(beam);

  // ---- anéis de fogo e estilhaços
  const fx = new THREE.Group();
  fx.position.y = FLOOR + 2.0;
  rig.add(fx);
  const ringMatA = ringMaterial(0xff6a00, 1);
  const ringMatB = ringMaterial(0xffb030, 0.8);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.06, 10, 260), ringMatA);
  ringA.rotation.set(1.25, 0.25, 0);
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.65, 0.04, 10, 260), ringMatB);
  ringB.rotation.set(1.8, -0.35, 0.3);
  ringB.position.y = -0.4;
  fx.add(ringA, ringB);
  const shardMats = [0xff7a1a, 0xffc04a, 0xff4d00].map((color) => noOutline(new THREE.MeshBasicMaterial({ color })));
  const shardGeo = new THREE.TetrahedronGeometry(0.05, 0);
  const shards = [];
  const srnd = mulberry32(21);
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(shardGeo, shardMats[Math.floor(srnd() * 3)]);
    m.userData = { r: 1.3 + srnd() * 1.0, a: srnd() * Math.PI * 2, y: (srnd() - 0.5) * 3.2, sp: (0.15 + srnd() * 0.35) * (srnd() < 0.5 ? 1 : -1), rs: 0.6 + srnd() * 2.4 };
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

  // ------------------------------------------------------------------ personagem 3D
  let mixer = null, current = null, ready = false, introStart = 0;
  const actions = {};
  const auraMats = [];
  const gradientMap = toonGradient();
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });

  function playAction(name, fade = 0.35, timeScale = 1) {
    const next = actions[name];
    if (!next) return;
    if (next === current) { next.setEffectiveTimeScale(timeScale); return; }
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(timeScale).fadeIn(fade).play();
    if (current) current.fadeOut(fade);
    current = next;
  }

  function dressUp(model) {
    // mede o corpo na pose de referência, sem a rotação da cena
    const saved = { p: rig.position.clone(), r: rig.rotation.clone(), s: rig.scale.clone() };
    rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.setScalar(1);
    scene.updateMatrixWorld(true);

    const outfit = outfitMaterial(gradientMap);
    const skinned = [];
    model.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const v = new THREE.Vector3();
    let maxY = 0;
    const binds = skinned.map((mesh) => {
      const pos = mesh.geometry.attributes.position;
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv); // pose de repouso do esqueleto
        arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
        maxY = Math.max(maxY, v.y);
      }
      return arr;
    });

    const head = new THREE.Box3();
    const w = new THREE.Vector3();
    skinned.forEach((mesh, k) => {
      const arr = binds[k];
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (arr[i * 3 + 1] / maxY > 0.86) head.expandByPoint(mesh.getVertexPosition(i, w).applyMatrix4(mesh.matrixWorld));
      }
      for (let i = 0; i < arr.length; i++) arr[i] /= maxY;
      mesh.geometry.setAttribute('aBind', new THREE.BufferAttribute(arr, 3));
      mesh.material = outfit;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      // aura: casca que segue o mesmo esqueleto
      const auraMat = auraMaterial();
      auraMats.push(auraMat);
      const aura = new THREE.SkinnedMesh(mesh.geometry, auraMat);
      aura.bind(mesh.skeleton, mesh.bindMatrix);
      aura.frustumCulled = false;
      mesh.parent.add(aura);
    });

    const bone = (n) => model.getObjectByName(`mixamorig:${n}`) || model.getObjectByName(`mixamorig${n}`);
    const c = head.getCenter(new THREE.Vector3());
    const size = head.getSize(new THREE.Vector3());
    const rx = size.x / 2, ry = size.y / 2, rz = size.z / 2;
    const headGroup = new THREE.Group();
    headGroup.position.copy(c);
    scene.add(headGroup);

    const skin = toon(0xf6c9a4);
    for (const s of [-1, 1]) { // orelhas
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin);
      ear.scale.set(rx * 0.16, ry * 0.3, rz * 0.26);
      ear.position.set(s * rx * 0.98, -ry * 0.02, -rz * 0.05);
      headGroup.add(ear);
    }
    // rosto e marcas nas bochechas
    const face = new THREE.Mesh(new THREE.PlaneGeometry(rx * 1.75, rx * 0.88), noOutline(new THREE.MeshBasicMaterial({ map: faceTexture(), transparent: true, depthWrite: false })));
    face.position.set(0, -ry * 0.1, rz * 1.12);
    const whiskers = new THREE.Mesh(new THREE.PlaneGeometry(rx * 1.5, rx * 0.75), noOutline(new THREE.MeshBasicMaterial({ map: whiskerTexture(), transparent: true, depthWrite: false })));
    whiskers.position.set(0, -ry * 0.42, rz * 1.04);
    headGroup.add(face, whiskers);
    // bandana
    const bandMat = toon(0x1f2233, { side: THREE.DoubleSide });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), bandMat);
    band.scale.set(rx * 1.07, ry * 0.26, rz * 1.07);
    band.position.y = ry * 0.28;
    const metal = toon(0xaeb4bd);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(rx * 1.05, ry * 0.3, rz * 0.08),
      [metal, metal, metal, metal, new THREE.MeshToonMaterial({ map: plateTexture(), gradientMap }), metal]);
    plate.position.set(0, ry * 0.28, rz * 1.06);
    headGroup.add(band, plate);
    const tails = [];
    for (const s of [-1, 1]) { // fitas da bandana
      const geo = new THREE.BoxGeometry(rx * 0.22, ry * 0.9, rz * 0.04);
      geo.translate(0, -ry * 0.45, 0);
      const tail = new THREE.Mesh(geo, bandMat);
      tail.position.set(s * rx * 0.12, ry * 0.28, -rz * 1.08);
      tail.rotation.set(0.5, 0, s * 0.25);
      headGroup.add(tail);
      tails.push({ tail, s });
    }
    // cabelo espetado
    const hairA = toon(0xffd21f), hairB = toon(0xf4b400);
    const upV = new THREE.Vector3(0, 1, 0);
    const hr = mulberry32(5);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairA);
    cap.scale.set(rx * 1.14, ry * 1.0, rz * 1.16);
    cap.position.y = ry * 0.3;
    // parte de trás e nuca cobertas de cabelo
    const back = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16, Math.PI, Math.PI, 0, Math.PI * 0.78), hairA);
    back.scale.set(rx * 1.1, ry * 1.12, rz * 1.12);
    back.position.set(0, ry * 0.12, -rz * 0.05);
    headGroup.add(cap, back);
    for (let i = 0; i < 70; i++) {
      const th = hr() * Math.PI * 2;
      const back = Math.cos(th) < 0; // atrás: mechas descem até a nuca
      const ph = 0.15 + hr() * (back ? 1.85 : 1.35);
      const dir = new THREE.Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph) + (back ? 0.1 : 0.35), Math.sin(ph) * Math.cos(th));
      if (dir.z > 0.5 && dir.y < 0.9) dir.z *= 0.35; // deixa o rosto livre
      dir.normalize();
      const len = rx * (0.8 + hr() * 0.8);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(rx * (0.3 + hr() * 0.16), len, 5), hr() < 0.6 ? hairA : hairB);
      spike.quaternion.setFromUnitVectors(upV, dir);
      spike.position.set(dir.x * rx * 0.85, ry * 0.3 + dir.y * ry * 0.6, dir.z * rz * 0.85).addScaledVector(dir, len * 0.4);
      headGroup.add(spike);
    }
    for (let i = 0; i < 6; i++) { // franja sobre a bandana
      const x = (-0.6 + i * 0.24) * rx;
      const dir = new THREE.Vector3((x / rx) * 0.8, -0.9, 0.55).normalize();
      const len = rx * (0.45 + hr() * 0.2);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(rx * 0.16, len, 5), hairA);
      spike.quaternion.setFromUnitVectors(upV, dir);
      spike.position.set(x, ry * 0.62, rz * 0.9).addScaledVector(dir, len * 0.4);
      headGroup.add(spike);
    }
    headGroup.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    bone('Head').attach(headGroup);

    // porta-kunai na coxa direita
    const legBone = bone('RightUpLeg');
    const hip = legBone.getWorldPosition(new THREE.Vector3());
    const holster = new THREE.Mesh(new THREE.BoxGeometry(rx * 0.35, ry * 0.9, rz * 0.5), toon(0x3d3f4a));
    holster.position.set(hip.x - rx * 0.9, hip.y - ry * 1.6, hip.z + rz * 0.1);
    scene.add(holster);
    legBone.attach(holster);

    rig.position.copy(saved.p); rig.rotation.copy(saved.r); rig.scale.copy(saved.s);
    return tails;
  }

  let tails = [];
  const loader = new GLTFLoader();
  loader.load(MODEL_URL, (gltf) => {
    const model = gltf.scene;
    const raw = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(HEIGHT / raw.getSize(new THREE.Vector3()).y);
    hero.add(model);
    tails = dressUp(model);
    mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      clip.tracks = clip.tracks.filter((tr) => !tr.name.endsWith('.scale')); // permite cabeça maior (estilo anime)
      actions[clip.name] = mixer.clipAction(clip);
    }
    const headBone = model.getObjectByName('mixamorigHead') || model.getObjectByName('mixamorig:Head');
    headBone?.scale.setScalar(1.42);
    playAction('idle', 0);
    ready = true; introStart = performance.now(); onReady?.();
  }, undefined, (err) => { console.warn('Modelo 3D não carregou:', err); ready = true; onReady?.(); });

  // ------------------------------------------------------------------ comportamento
  // parado de frente -> anda uma volta pela plataforma -> volta a ficar de frente (corre ao comemorar)
  const R = 0.72;
  const brain = { state: 'idle', until: 3.5, dir: 1, phase: 0, laps: 1, speed: 2.3, cx: 0, facing: 0 };
  function startLap(run) {
    brain.state = 'lap';
    brain.dir = Math.random() < 0.5 ? 1 : -1;
    brain.cx = -brain.dir * R; // o círculo passa pelo centro da plataforma
    brain.phase = 0;
    brain.laps = run ? 2 : 1;
    brain.speed = run ? 4.2 : 1.55;
    playAction(run ? 'run' : 'walk', 0.3, run ? 0.85 : 0.8);
  }

  // ------------------------------------------------------------------ interação
  const pose = { x: 0, y: 0, z: 0, rotY: 0, rotX: 0, scale: 1, camY: 0.2 };
  const target = { ...pose };
  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  let fire = 1, fireTarget = 1, boost = 3;

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
  const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

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
    const intro = ready ? (reduced ? 1 : ease((now - introStart) / 1500)) : 0;

    // comportamento do personagem
    if (mixer && !reduced) {
      if (brain.state === 'idle') {
        hero.position.x *= Math.pow(0.02, dt);
        hero.position.z *= Math.pow(0.02, dt);
        brain.facing = angleLerp(brain.facing, mouseS.x * 0.6, 1 - Math.pow(0.05, dt)); // vira para o mouse
        if (t > brain.until) startLap(false);
      } else {
        brain.phase += (brain.speed / R) * dt;
        const total = Math.PI * 2 * brain.laps;
        const a = Math.min(brain.phase, total) * brain.dir;
        hero.position.x = brain.cx + brain.dir * R * Math.cos(a);
        hero.position.z = R * Math.sin(a);
        const heading = Math.atan2(-Math.sin(a), brain.dir * Math.cos(a)); // direção do passo
        brain.facing = angleLerp(brain.facing, heading, 1 - Math.pow(0.0005, dt));
        if (brain.phase >= total) {
          brain.state = 'idle';
          brain.until = t + 6 + Math.random() * 5;
          playAction('idle', 0.45);
        }
      }
      hero.rotation.y = brain.facing;
    }
    mixer?.update(reduced ? 0 : dt);
    for (const { tail, s } of tails) {
      tail.rotation.x = 0.5 + Math.sin(t * 4 + s) * 0.15 + (brain.state === 'lap' ? 0.5 : 0);
      tail.rotation.z = s * 0.25 + Math.sin(t * 3) * 0.08;
    }

    // câmera passeando sozinha + pose da seção + mouse/giroscópio
    const idleY = Math.sin(t * 0.35) * 0.25 + Math.sin(t * 0.13) * 0.1;
    rig.position.set(pose.x, pose.y, pose.z);
    rig.rotation.set(pose.rotX * 0.5 + Math.sin(t * 0.27) * 0.04 + mouseS.y * 0.08, Math.sin(pose.rotY) * 0.5 + idleY + mouseS.x * 0.25, 0);
    rig.scale.setScalar(pose.scale * (0.9 + 0.1 * intro));
    camera.position.set(mouseS.x * 0.3 + Math.sin(t * 0.21) * 0.25, pose.camY - mouseS.y * 0.15, baseZ + Math.sin(t * 0.18) * 0.3 + (1 - intro) * 1.5);
    camera.lookAt(pose.x * 0.35, pose.y * 0.5 + 0.05, 0);

    const f = fire * intro;
    for (const m of auraMats) { m.uniforms.uTime.value = t; m.uniforms.uFire.value = f * 0.55; }
    beam.material.uniforms.uTime.value = t;
    fireLight.intensity = 6 + f * 6 + Math.sin(t * 9) * 1.5;
    neon.color.setHSL(0.07, 1, 0.5 + Math.sin(t * 2) * 0.06);
    ringA.rotation.z = t * 0.6; ringB.rotation.z = -t * 0.45;
    ringA.rotation.x = 1.25 + Math.sin(t * 0.5) * 0.08;
    ringMatA.uniforms.uTime.value = t; ringMatB.uniforms.uTime.value = t;
    ringMatA.uniforms.uStrength.value = f; ringMatB.uniforms.uStrength.value = f * 0.8;
    for (const m of shards) {
      const u = m.userData;
      const a = u.a + t * u.sp;
      m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.8 + u.a) * 0.12, Math.sin(a) * u.r * 0.7);
      m.rotation.set(t * u.rs, t * u.rs * 0.7, 0);
      m.visible = intro > 0.4;
    }
    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uBoost.value = boost;

    effect.render(scene, camera);
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
    // comemoração: aura explode e ele corre duas voltas na plataforma
    spin() { fireTarget = 2.4; boost = 5; setTimeout(() => (fireTarget = 1), 1500); if (mixer && !reduced) startLap(true); },
    pulse() { target.scale = pose.scale * 1.04; fireTarget = 1.7; boost = 2.5; setTimeout(() => { target.scale /= 1.04; fireTarget = 1; }, 260); },
  };
}
