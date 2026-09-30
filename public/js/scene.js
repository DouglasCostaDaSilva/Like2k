// LikeSystem — cena 3D: traje ninja laranja e preto "vestido" por um shinobi invisível.
// Tudo é procedural (sem assets externos). Se existir /models/outfit.glb, ele substitui
// o traje procedural automaticamente (use um modelo escaneado/fotogramétrico para ultra realismo).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ORANGE = 0xf55a06;
const BLACK = 0x121216;
const Z_SCALE = 0.62; // achata o tronco (profundidade)

// ------------------------------------------------------------------ texturas procedurais
function fabricMaps(anisotropy) {
  const size = 512;
  const h = new Float32Array(size * size);
  const rnd = mulberry32(7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const twill = Math.sin(((x + y * 2) * Math.PI * 2) / 8); // sarja diagonal
      const weave = Math.sin((x * Math.PI * 2) / 4) * Math.sin((y * Math.PI * 2) / 4);
      h[y * size + x] = 0.5 + 0.28 * twill + 0.12 * weave + (rnd() - 0.5) * 0.22;
    }
  }
  const normal = document.createElement('canvas');
  const rough = document.createElement('canvas');
  normal.width = normal.height = rough.width = rough.height = size;
  const nctx = normal.getContext('2d');
  const rctx = rough.getContext('2d');
  const nimg = nctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      nimg.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
      const r = 200 + (at(x, y) - 0.5) * 90;
      rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = r;
      rimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  const mk = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(7, 7);
    t.anisotropy = anisotropy;
    return t;
  };
  return { normal: mk(normal), rough: mk(rough) };
}

function spiralTexture({ size = 512, color = '#d91c1c', ring = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineWidth = size * 0.07;
  g.beginPath();
  for (let a = 0; a <= Math.PI * 5.2; a += 0.02) {
    const r = size * 0.028 * a;
    const x = cx + Math.cos(a) * r;
    const y = cx + Math.sin(a) * r;
    a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  if (ring) {
    g.lineWidth = size * 0.055;
    g.beginPath();
    g.arc(cx, cx, size * 0.44, 0, Math.PI * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function engravingNormal() {
  // gravação em espiral na placa metálica da bandana (mapa de normal a partir de altura)
  const w = 512, hgt = 192;
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, hgt);
  g.strokeStyle = '#fff'; g.lineWidth = 11; g.lineCap = 'round';
  g.beginPath();
  for (let a = 0; a <= Math.PI * 4.6; a += 0.02) {
    const r = 4.6 * a;
    const x = w / 2 + Math.cos(a) * r, y = hgt / 2 + Math.sin(a) * r;
    a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.stroke();
  g.beginPath(); g.moveTo(w / 2 + 64, hgt / 2 + 8); g.quadraticCurveTo(w / 2 + 90, hgt / 2 + 40, w / 2 + 60, hgt / 2 + 62); g.stroke();
  const src = g.getImageData(0, 0, w, hgt).data;
  const out = g.createImageData(w, hgt);
  const H = (x, y) => src[((Math.min(hgt - 1, Math.max(0, y)) * w) + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * -3, dy = (H(x, y + 1) - H(x, y - 1)) * -3;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return new THREE.CanvasTexture(c);
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ geometria do traje
function torsoProfile() {
  const pts = [
    [0.655, -1.39], [0.705, -1.475], [0.738, -1.43], [0.728, -1.3], [0.71, -1.05], [0.68, -0.72], [0.71, -0.32], [0.79, 0.08],
    [0.84, 0.42], [0.84, 0.66], [0.77, 0.88], [0.6, 1.02], [0.44, 1.1], [0.37, 1.13],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.SplineCurve(pts).getSpacedPoints(90);
}

function shapeTorso(geo) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const theta = Math.atan2(v.x, v.z); // 0 = frente
    const y = v.y;
    // ombros mais largos, tronco achatado
    const shoulder = smooth(0.35, 0.8, y) * (1 - smooth(0.92, 1.1, y));
    v.x *= 1 + 0.1 * shoulder;
    v.z *= Z_SCALE * (1 + 0.06 * Math.cos(theta)); // peito levemente à frente
    // dobras do tecido: verticais na cintura + horizontais perto da barra
    const waist = smooth(-1.2, -0.6, y) * (1 - smooth(-0.2, 0.3, y));
    const chest = smooth(-0.3, 0.2, y) * (1 - smooth(0.7, 1.0, y));
    const fold = Math.sin(theta * 7 + y * 2.3) * 0.03 * waist
      + Math.sin(theta * 4 - y * 6 + 1.3) * 0.012 * chest
      + Math.sin(theta * 13 - y * 5) * 0.006;
    const hem = Math.sin(y * 26 + theta * 2) * 0.006 * (1 - smooth(-1.4, -1.0, y));
    const f = 1 + fold + hem;
    v.x *= f; v.z *= f;
    pos.setXYZ(i, v.x, v.y, v.z);
    // oclusão de cavidade: vincos e axilas mais escuros
    let shade = Math.min(1.08, Math.max(0.62, 1 + (f - 1) * 7));
    const side = Math.abs(v.x) / 0.85;
    shade *= 1 - 0.4 * Math.exp(-((side - 0.98) ** 2) / 0.006 - ((y - 0.62) ** 2) / 0.05);
    shade *= 1 - 0.3 * smooth(1.0, 1.12, y); // sombra sob a gola
    shade *= 1 - 0.18 * (1 - smooth(-1.48, -1.36, y)); // dobra da barra
    colors.set([shade, shade, shade], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function sleeveGeometry(len, tStart, tEnd) {
  const prof = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = tStart + ((tEnd - tStart) * i) / n;
    let r = 0.3 - 0.085 * smooth(0, len, t) + 0.018 * smooth(len - 0.12, len, t);
    // rugas no cotovelo
    r += 0.012 * Math.sin(t * 24) * Math.exp(-((t - 0.95) ** 2) / 0.05);
    prof.push(new THREE.Vector2(r, -t));
  }
  prof.reverse(); // Lathe espera y crescente para normais para fora
  const geo = new THREE.LatheGeometry(prof, 72);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const theta = Math.atan2(v.x, v.z);
    const t = -v.y;
    const bunch = Math.exp(-((t - 0.95) ** 2) / 0.06) + 0.6 * Math.exp(-((t - 1.7) ** 2) / 0.02);
    const wr = 1 + 0.02 * Math.sin(theta * 5 + t * 9) * smooth(0.3, 1.2, t) + 0.014 * Math.sin(theta * 3 - t * 30) * bunch;
    pos.setXYZ(i, v.x * wr, v.y, v.z * wr * 0.92);
    let shade = Math.min(1.08, Math.max(0.6, 1 + (wr - 1) * 8));
    shade *= 1 - 0.3 * (1 - smooth(0, 0.18, t)); // junção com o ombro
    colors.set([shade, shade, shade], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function ribbonGeometry(w, h, seg) {
  const g = new THREE.PlaneGeometry(w, h, 1, seg);
  g.translate(0, -h / 2, 0);
  g.userData.base = g.attributes.position.array.slice();
  return g;
}

// ------------------------------------------------------------------ shaders
const auraMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff7a1a) }, uStrength: { value: 0.55 } },
  vertexShader: /* glsl */`
    uniform float uTime; varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){
      vec3 p = position + normal * (0.05 + 0.03 * sin(uTime*3.0 + position.y*6.0));
      vec4 mv = modelViewMatrix * vec4(p,1.0);
      vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform vec3 uColor; uniform float uStrength; varying vec3 vN; varying vec3 vV; varying float vY;
    void main(){
      float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
      float flicker = 0.75 + 0.25 * sin(uTime*7.0 + vY*14.0);
      gl_FragColor = vec4(uColor * f * flicker * uStrength, f * uStrength);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
});

const orbMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); vP=position; gl_Position=projectionMatrix*mv; }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){
      float f = pow(1.0 - abs(dot(vN,vV)), 1.6);
      vec3 p = normalize(vP);
      float a = atan(p.z, p.x);
      float swirl = sin(a*6.0 + p.y*10.0 - uTime*9.0) * 0.5 + 0.5;
      float swirl2 = sin(a*3.0 - p.y*7.0 + uTime*6.0) * 0.5 + 0.5;
      float lines = smoothstep(0.82, 1.0, swirl) + smoothstep(0.88, 1.0, swirl2)*0.7;
      vec3 col = mix(vec3(0.05,0.28,1.0), vec3(0.55,0.85,1.0), lines);
      float alpha = clamp(f*1.1 + lines*0.5, 0.0, 1.0);
      gl_FragColor = vec4(col * (0.18 + f*0.9 + lines*0.75), alpha);
    }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
});

function particleMaterial(pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPR: { value: pixelRatio } },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uPR; attribute float aSeed; attribute vec3 aColor; varying vec3 vColor; varying float vA;
      void main(){
        vec3 p = position;
        float h = mod(p.y + uTime * (0.18 + aSeed*0.35), 7.0) - 3.0;
        p.y = h;
        p.x += sin(uTime*0.6 + aSeed*20.0) * 0.25;
        p.z += cos(uTime*0.5 + aSeed*15.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_PointSize = (14.0 + aSeed*26.0) * uPR / -mv.z;
        vColor = aColor; vA = smoothstep(-3.0,-2.0,h) * (1.0 - smoothstep(2.6,4.0,h));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vA;
      void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d); gl_FragColor = vec4(vColor*a*1.6, a*vA); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

// ------------------------------------------------------------------ montagem
export function createScene(canvas, { mode = 'landing', onReady } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio || 1, mode === 'app' ? 1.5 : 2);
  renderer.setPixelRatio(pr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040406);
  scene.fog = new THREE.FogExp2(0x040406, 0.075);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.35, 9.5);

  // Luzes cinematográficas
  scene.add(new THREE.HemisphereLight(0x8aa0ff, 0x1a0c05, 0.35));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.6);
  key.position.set(3.5, 5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 4; key.shadow.camera.bottom = -3;
  key.shadow.radius = 5; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key);
  const rimL = new THREE.SpotLight(0xff5a00, 60, 20, 0.5, 0.6, 1.4);
  rimL.position.set(-4.5, 3, -4); scene.add(rimL);
  const rimR = new THREE.SpotLight(0x3b7bff, 45, 20, 0.5, 0.6, 1.4);
  rimR.position.set(4.5, 2, -4); scene.add(rimR);
  const fill = new THREE.PointLight(0xff8a3d, 6, 8, 2);
  fill.position.set(-2, -1, 3); scene.add(fill);

  const maps = fabricMaps(renderer.capabilities.getMaxAnisotropy());
  const cloth = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.86, roughnessMap: maps.rough, normalMap: maps.normal, normalScale: new THREE.Vector2(0.85, 0.85),
    sheen: 0.8, sheenRoughness: 0.5, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffd0a0), 0.3), ...extra,
  });
  const mOrange = cloth(ORANGE, { vertexColors: true }); // geometrias com sombreamento de cavidade
  const mBlack = cloth(BLACK, { vertexColors: true, sheenColor: new THREE.Color(0x444a66), roughness: 0.9 });
  const mBlackPlain = cloth(BLACK, { sheenColor: new THREE.Color(0x444a66), roughness: 0.9 });
  const mStitch = cloth(0xc94a04, { roughness: 0.95 });
  const mLining = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1, side: THREE.BackSide });
  const mMetal = new THREE.MeshPhysicalMaterial({ color: 0xcfd3da, metalness: 1, roughness: 0.22, clearcoat: 0.6 });
  const mDarkMetal = new THREE.MeshStandardMaterial({ color: 0x2a2c33, metalness: 0.9, roughness: 0.35 });

  const rig = new THREE.Group(); // recebe pose (scroll/mouse)
  const outfit = new THREE.Group(); // traje procedural
  rig.add(outfit);
  scene.add(rig);

  const castAll = (o) => o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

  // ---- Tronco (parte laranja + ombreira preta)
  const prof = torsoProfile();
  const split = prof.findIndex((p) => p.y > 0.46);
  const torsoLow = shapeTorso(new THREE.LatheGeometry(prof.slice(0, split + 1), 128));
  const torsoHigh = shapeTorso(new THREE.LatheGeometry(prof.slice(split), 128));
  const torsoMesh = new THREE.Mesh(torsoLow, mOrange);
  const yokeMesh = new THREE.Mesh(torsoHigh, mBlack);
  const liningLow = new THREE.Mesh(torsoLow, mLining); liningLow.scale.setScalar(0.985);
  outfit.add(torsoMesh, yokeMesh, liningLow);
  torsoLow.userData.base = torsoLow.attributes.position.array.slice();

  // costura entre laranja e preto + barra
  const highPts = prof.length - split;
  const ringPts = [];
  for (let i = 0; i < 128; i++) ringPts.push(new THREE.Vector3().fromBufferAttribute(torsoHigh.attributes.position, i * highPts).multiplyScalar(1.004));
  const seam = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ringPts, true), 256, 0.011, 8, true), mBlackPlain);
  outfit.add(seam);

  // ---- Recortes e bolsos costurados (seguem a superfície via raycast)
  outfit.updateMatrixWorld(true);
  const surf = new THREE.Raycaster();
  const onSurface = (theta, y) => {
    const dir = new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta));
    surf.set(new THREE.Vector3(Math.sin(theta) * 3, y, Math.cos(theta) * 3), dir);
    const hit = surf.intersectObject(torsoMesh, false)[0];
    return hit ? hit.point.addScaledVector(dir, -0.006) : null;
  };
  const stitchLine = (fn, n, radius) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const p = fn(i / n); if (p) pts.push(p); }
    if (pts.length > 3) outfit.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, radius, 6), mStitch));
  };
  for (const s of [-1, 1]) {
    stitchLine((u) => onSurface(s * (0.55 + 0.08 * u), 0.44 - u * 1.4), 30, 0.007); // recorte princesa
    stitchLine((u) => onSurface(s * (0.3 + u * 0.55), -0.58 - u * 0.34), 24, 0.009); // bolso
    stitchLine((u) => onSurface(s * 2.25, 0.44 - u * 1.4), 30, 0.007); // recorte lateral traseiro
  }

  // ---- Gola alta
  const collarOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.38, 0.36, 72, 4, true, 0.22, Math.PI * 2 - 0.44), cloth(ORANGE));
  const collarInner = new THREE.Mesh(collarOuter.geometry, mLining);
  for (const c of [collarOuter, collarInner]) { c.position.y = 1.27; c.scale.set(1, 1, 0.82); }
  const collarRim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 8, 90, Math.PI * 2 - 0.44), mBlackPlain);
  collarRim.rotation.set(Math.PI / 2, 0, Math.PI / 2 + 0.22); collarRim.position.y = 1.45; collarRim.scale.set(1, 0.82, 1);
  outfit.add(collarOuter, collarInner, collarRim);

  // ---- Zíper frontal com dentes instanciados
  const frontPts = [];
  for (let i = 0; i < prof.length; i += 3) {
    const p = prof[i];
    if (p.y > 1.08) break;
    frontPts.push(new THREE.Vector3(0, p.y, p.x * Z_SCALE * 1.06 + 0.004));
  }
  frontPts.push(new THREE.Vector3(0, 1.45, 0.36));
  const zipCurve = new THREE.CatmullRomCurve3(frontPts);
  const tape = new THREE.Mesh(new THREE.TubeGeometry(zipCurve, 160, 0.018, 8), mBlackPlain);
  tape.scale.set(1.6, 1, 1);
  const teethN = 190;
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.032, 0.008, 0.012), mMetal, teethN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < teethN; i++) {
    const t = i / (teethN - 1);
    const p = zipCurve.getPointAt(t);
    const tan = zipCurve.getTangentAt(t);
    q.setFromUnitVectors(up, tan);
    p.x += (i % 2 ? 0.006 : -0.006);
    p.z += 0.012;
    m4.compose(p, q, new THREE.Vector3(1, 1, 1));
    teeth.setMatrixAt(i, m4);
  }
  const pullT = 0.82;
  const pull = new THREE.Group();
  const slider = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.08, 0.03, 3, 0.01), mMetal);
  const tab = new THREE.Mesh(new RoundedBoxGeometry(0.04, 0.13, 0.012, 3, 0.005), mMetal);
  tab.position.set(0, -0.09, 0.02); tab.rotation.x = 0.25;
  pull.add(slider, tab);
  pull.position.copy(zipCurve.getPointAt(pullT)).add(new THREE.Vector3(0, 0, 0.03));
  outfit.add(tape, teeth, pull);

  // ---- Mangas
  const LEN = 1.85, SPLIT_T = 0.42;
  const sleeves = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0.8 * side, 0.83, 0);
    arm.rotation.set(-0.08, 0, 0.36 * side);
    const upper = new THREE.Mesh(sleeveGeometry(LEN, 0, SPLIT_T), mBlack);
    const lower = new THREE.Mesh(sleeveGeometry(LEN, SPLIT_T, LEN), mOrange);
    const lin = new THREE.Mesh(lower.geometry, mLining); lin.scale.setScalar(0.97);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mBlackPlain);
    cap.scale.set(1, 0.55, 0.92);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.224, 0.028, 12, 80), cloth(0xe85a05));
    cuff.rotation.x = Math.PI / 2; cuff.position.y = -LEN; cuff.scale.set(1, 0.92, 1);
    const seamS = new THREE.Mesh(new THREE.TorusGeometry(0.278, 0.012, 8, 80), mBlackPlain);
    seamS.rotation.x = Math.PI / 2; seamS.position.y = -SPLIT_T; seamS.scale.set(1, 0.92, 1);
    arm.add(upper, lower, lin, cap, cuff, seamS);
    outfit.add(arm);
    sleeves.push({ arm, lower, side });
  }

  // ---- Bandana ninja flutuando onde estaria a cabeça
  const headband = new THREE.Group();
  headband.position.set(0, 1.98, 0.02);
  headband.rotation.x = -0.08;
  const bandMat = cloth(0x1b2140, { sheenColor: new THREE.Color(0x5566aa) });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 72, 1, true), bandMat);
  band.scale.set(1, 1, 0.92);
  const bandIn = new THREE.Mesh(band.geometry, mLining); bandIn.scale.copy(band.scale);
  const plateNormal = engravingNormal();
  const plateMat = new THREE.MeshPhysicalMaterial({ color: 0xd9dde4, metalness: 1, roughness: 0.28, normalMap: plateNormal, normalScale: new THREE.Vector2(1.4, 1.4), clearcoat: 0.4 });
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.165, 0.03, 4, 0.012), plateMat);
  plate.position.set(0, 0, 0.285);
  headband.add(band, bandIn, plate);
  for (const [x, y] of [[-0.2, 0.055], [0.2, 0.055], [-0.2, -0.055], [0.2, -0.055]]) {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), mDarkMetal);
    rivet.position.set(x, y, 0.302); headband.add(rivet);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), bandMat);
  knot.position.set(0, 0, -0.28); knot.scale.set(1.4, 0.8, 0.6);
  headband.add(knot);
  const tails = [];
  const tailMat = bandMat.clone();
  tailMat.side = THREE.DoubleSide;
  for (const s of [-1, 1]) {
    const tail = new THREE.Mesh(ribbonGeometry(0.08, 0.55, 20), tailMat);
    tail.position.set(0.04 * s, -0.01, -0.3);
    tail.rotation.set(0.95, 0.2 * s, 0.3 * s);
    headband.add(tail);
    tails.push({ mesh: tail, s });
  }
  outfit.add(headband);

  // ---- Aura de chakra (fresnel aditivo)
  const aura = new THREE.Group();
  const auraMat = auraMaterial();
  aura.add(new THREE.Mesh(torsoLow, auraMat), new THREE.Mesh(torsoHigh, auraMat));
  outfit.add(aura);

  // ---- Esfera de energia na mão direita
  outfit.updateMatrixWorld(true);
  const handPos = new THREE.Vector3(0, -LEN - 0.3, 0.05);
  sleeves[1].arm.localToWorld(handPos);
  const orb = new THREE.Group();
  orb.position.copy(handPos).add(new THREE.Vector3(0.15, 0, 0.35));
  const orbMat = orbMaterial();
  const orbShell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 64, 48), orbMat);
  const orbCore = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 24), new THREE.MeshBasicMaterial({ color: 0x9fd0ff }));
  const orbLight = new THREE.PointLight(0x4aa3ff, 8, 4, 2);
  orb.add(orbShell, orbCore, orbLight);
  outfit.add(orb);

  // ---- Símbolos em espiral (decals nas costas e no ombro)
  const spiralMat = new THREE.MeshPhysicalMaterial({
    map: spiralTexture(), transparent: true, roughness: 0.85, sheen: 0.6, sheenColor: new THREE.Color(0xff6666),
    polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, normalMap: maps.normal, normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const ray = new THREE.Raycaster();
  const helper = new THREE.Object3D();
  function addDecal(mesh, from, dir, size, rotZ = 0) {
    ray.set(from, dir.clone().normalize());
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit) return;
    const n = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
    helper.position.copy(hit.point);
    helper.lookAt(hit.point.clone().add(n));
    helper.rotateZ(rotZ);
    const geo = new DecalGeometry(mesh, hit.point, helper.rotation.clone(), new THREE.Vector3(size, size, size));
    const decal = new THREE.Mesh(geo, spiralMat);
    outfit.worldToLocal(decal.position);
    outfit.add(decal);
  }
  outfit.updateMatrixWorld(true);
  addDecal(torsoMesh, new THREE.Vector3(0, -0.05, -3), new THREE.Vector3(0, 0, 1), 0.95);
  {
    const a = sleeves[0].arm;
    const p = new THREE.Vector3(0, -0.72, 0);
    a.localToWorld(p);
    addDecal(sleeves[0].lower, p.clone().add(new THREE.Vector3(-2, 0, 0.4)), new THREE.Vector3(2, 0, -0.4), 0.3);
  }

  castAll(outfit);
  for (const o of [aura, orb]) o.traverse((c) => { c.castShadow = false; c.receiveShadow = false; });

  // ---- Plataforma
  const stage = new THREE.Group();
  stage.position.y = -2.45;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.25, 0.12, 128), new THREE.MeshPhysicalMaterial({ color: 0x0b0b0f, metalness: 0.8, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 }));
  disc.receiveShadow = true;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a0d });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.12, 0.012, 8, 200), ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.062;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.006, 8, 200), new THREE.MeshBasicMaterial({ color: 0x3b7bff }));
  ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.062;
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,120,30,0.9)'); grd.addColorStop(0.4, 'rgba(255,90,10,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.07;
  stage.add(disc, ring, ring2, glow);
  rig.add(stage);

  // ---- Partículas de chakra
  const COUNT = mode === 'app' ? 700 : 1400;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(COUNT * 3), pSeed = new Float32Array(COUNT), pCol = new Float32Array(COUNT * 3);
  const rnd = mulberry32(42);
  const cA = new THREE.Color(0xff7a1a), cB = new THREE.Color(0x3b8bff), cC = new THREE.Color(0xffd08a);
  for (let i = 0; i < COUNT; i++) {
    const r = 0.9 + rnd() * 5.5, a = rnd() * Math.PI * 2;
    pPos.set([Math.cos(a) * r, rnd() * 7, Math.sin(a) * r - 1], i * 3);
    pSeed[i] = rnd();
    const c = rnd() < 0.62 ? cA : rnd() < 0.7 ? cB : cC;
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- Modelo externo opcional (ultra realismo)
  fetch('/api/model').then((r) => r.json()).then(({ url }) => {
    if (!url) return;
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const s = 3.9 / size.y;
      model.scale.setScalar(s);
      box.setFromObject(model);
      model.position.sub(box.getCenter(new THREE.Vector3())).add(new THREE.Vector3(0, 0.1, 0));
      castAll(model);
      outfit.clear();
      outfit.add(model);
    });
  }).catch(() => {});

  // ------------------------------------------------------------------ interação
  const pose = { x: 0, y: 0, z: 0, rotY: 0, rotX: 0, scale: 1, camY: 0.35 };
  const target = { ...pose };
  const mouse = new THREE.Vector2(), mouseS = new THREE.Vector2();
  let spin = 0;

  addEventListener('pointermove', (e) => {
    mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  }, { passive: true });

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    // mantém o traje inteiro visível em telas estreitas
    camera.position.z = w / h < 0.8 ? 13.5 : w / h < 1.2 ? 11 : 9.5;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  let last = performance.now(), elapsed = 0;
  let ready = false, running = true;
  const baseHem = torsoLow.userData.base;

  function tick() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (elapsed += dt);
    const k = 1 - Math.pow(0.0025, dt); // amortecimento independente de FPS

    for (const key in pose) pose[key] += (target[key] - pose[key]) * k;
    mouseS.lerp(mouse, 1 - Math.pow(0.02, dt));
    if (!reduced) spin += dt * 0.08;

    rig.position.set(pose.x, pose.y + (reduced ? 0 : Math.sin(t * 1.1) * 0.06), pose.z);
    rig.rotation.y = pose.rotY + mouseS.x * 0.55 + Math.sin(spin) * 0.25;
    rig.rotation.x = pose.rotX + mouseS.y * 0.12;
    rig.scale.setScalar(pose.scale);
    camera.position.x = mouseS.x * 0.35;
    camera.position.y = pose.camY - mouseS.y * 0.2;
    camera.lookAt(pose.x * 0.35, pose.y * 0.5 + 0.1, 0);

    // barra do casaco balança com o movimento (tecido)
    if (!reduced) {
      const pos = torsoLow.attributes.position;
      const swayX = (target.rotY - pose.rotY) * 0.6 + mouseS.x * 0.03;
      for (let i = 0; i < pos.count; i++) {
        const bx = baseHem[i * 3], by = baseHem[i * 3 + 1], bz = baseHem[i * 3 + 2];
        const w = 1 - smooth(-1.48, -0.8, by);
        if (w <= 0) continue;
        const theta = Math.atan2(bx, bz);
        const ripple = Math.sin(theta * 5 + t * 2.4) * 0.018 + Math.sin(theta * 9 - t * 3.1) * 0.008;
        const f = 1 + ripple * w;
        pos.setXYZ(i, bx * f + swayX * w * 0.12, by + Math.sin(theta * 3 + t * 1.7) * 0.012 * w, bz * f);
      }
      pos.needsUpdate = true;
      torsoLow.computeVertexNormals();
    }

    // pontas da bandana ao vento
    for (const { mesh, s } of tails) {
      const g = mesh.geometry, arr = g.attributes.position.array, base = g.userData.base;
      for (let i = 0; i < arr.length; i += 3) {
        const d = -base[i + 1];
        arr[i] = base[i] + Math.sin(t * 3.2 + d * 5 + s) * 0.06 * d;
        arr[i + 2] = base[i + 2] - Math.sin(t * 2.6 + d * 4) * 0.08 * d - d * 0.25;
      }
      g.attributes.position.needsUpdate = true;
      g.computeVertexNormals();
    }

    auraMat.uniforms.uTime.value = t;
    orbMat.uniforms.uTime.value = t;
    orbShell.rotation.y = t * 1.4;
    orb.scale.setScalar(1 + Math.sin(t * 5) * 0.04);
    orbLight.intensity = 7 + Math.sin(t * 9) * 2;
    pMat.uniforms.uTime.value = reduced ? 0 : t;
    ring.material.color.setHSL(0.065, 1, 0.5 + Math.sin(t * 2) * 0.08);
    stage.rotation.y = -rig.rotation.y * 0.3;

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
    setAura(strength) { auraMat.uniforms.uStrength.value = strength; },
    pulse() { target.scale = pose.scale * 1.06; setTimeout(() => (target.scale /= 1.06), 260); },
  };
}
