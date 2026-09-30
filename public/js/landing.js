import { createScene } from './scene.js';
import { api, brl, int } from './common.js';

const loader = document.getElementById('loader');
const doneLoading = () => loader.classList.add('done');
setTimeout(doneLoading, 6000); // nunca prende o usuário na tela de carregamento

let scene = null;
try {
  scene = createScene(document.getElementById('stage'), { mode: 'landing', onReady: () => setTimeout(doneLoading, 250) });
} catch (err) {
  console.warn('WebGL indisponível:', err);
  doneLoading();
}

// ---------- poses do traje conforme o scroll ----------
const sections = [...document.querySelectorAll('[data-pose]')];
const isNarrow = () => innerWidth < 860;
const poses = () => (isNarrow()
  ? {
      hero: { x: 0, y: 1.3, rotY: 0, rotX: 0.02, scale: 0.76, camY: 0.2 },
      steps: { x: 0, y: 1.1, rotY: 0.4, rotX: 0.04, scale: 0.62, camY: 0.2 },
      pricing: { x: 0, y: 1.1, rotY: -0.4, rotX: 0.02, scale: 0.62, camY: 0.2 },
      access: { x: 0, y: 1.1, rotY: 0.1, rotX: 0.04, scale: 0.62, camY: 0.2 },
    }
  : {
      hero: { x: 2.55, y: -0.2, rotY: -0.3, rotX: 0.02, scale: 0.96, camY: 0.2 },
      steps: { x: -2.5, y: -0.2, rotY: 0.45, rotX: 0.04, scale: 0.96, camY: 0.2 },
      pricing: { x: 2.6, y: -0.2, rotY: -0.5, rotX: -0.02, scale: 0.96, camY: 0.15 },
      access: { x: 2.5, y: -0.2, rotY: -0.2, rotX: 0.03, scale: 0.96, camY: 0.2 },
    });

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

function updatePose() {
  if (!scene) return;
  const P = poses();
  const mid = scrollY + innerHeight / 2;
  let i = 0;
  while (i < sections.length - 1 && sections[i + 1].offsetTop + sections[i + 1].offsetHeight / 2 < mid) i++;
  const a = sections[i], b = sections[Math.min(i + 1, sections.length - 1)];
  const ca = a.offsetTop + a.offsetHeight / 2, cb = b.offsetTop + b.offsetHeight / 2;
  const t = a === b ? 0 : ease(Math.min(1, Math.max(0, (mid - ca) / (cb - ca))));
  const pa = P[a.dataset.pose], pb = P[b.dataset.pose];
  const pose = {};
  for (const k in pa) pose[k] = lerp(pa[k], pb[k], t);
  scene.setPose(pose);
  scene.setAura(b.dataset.pose === 'access' ? lerp(0.55, 0.9, t) : 0.55);
}
addEventListener('scroll', updatePose, { passive: true });
addEventListener('resize', updatePose);
updatePose();

// ---------- revelação de conteúdo ----------
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

// ---------- calculadora ----------
const range = document.getElementById('calcRange');
const calc = () => {
  const likes = Number(range.value);
  document.getElementById('calcLikes').textContent = `${int(likes)} likes`;
  document.getElementById('calcPrice').textContent = brl(Math.round((likes / 2000) * 880));
  range.style.setProperty('--p', `${((likes - range.min) / (range.max - range.min)) * 100}%`);
};
range.addEventListener('input', calc);
calc();

document.getElementById('year').textContent = new Date().getFullYear();

// ---------- login / solicitação ----------
const loginBox = document.getElementById('loginBox');
const requestBox = document.getElementById('requestBox');
document.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => {
  const toRequest = b.dataset.switch === 'request';
  loginBox.classList.toggle('hidden', toRequest);
  requestBox.classList.toggle('hidden', !toRequest);
  scene?.pulse();
}));

function show(el, msg, kind = 'error') {
  el.textContent = msg;
  el.className = `alert ${kind} show`;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button');
  const err = document.getElementById('loginErr');
  err.className = 'alert error';
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    await api('/api/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
    scene?.spin();
    await new Promise((r) => setTimeout(r, 450));
    location.href = '/app';
  } catch (ex) {
    show(err, ex.message);
    btn.disabled = false; btn.textContent = 'Entrar no painel';
  }
});

document.getElementById('requestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button');
  const msg = document.getElementById('reqMsg');
  btn.disabled = true;
  try {
    const r = await api('/api/auth/request', { method: 'POST', body: { username: f.username.value, password: f.password.value, contact: f.contact.value } });
    show(msg, r.message, 'ok');
    f.reset();
  } catch (ex) {
    show(msg, ex.message);
  } finally {
    btn.disabled = false;
  }
});

// Já logado? vai direto ao painel.
api('/api/me').then(() => {
  const cta = document.querySelector('.nav .btn-primary');
  cta.textContent = 'Painel';
  cta.href = '/app';
}).catch(() => {});
