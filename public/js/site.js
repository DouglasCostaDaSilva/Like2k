import { api, $, $$, brl, num, esc, toast, busy } from './common.js';

const state = { config: null, player: null, plan: null };

// ---------- menu ----------
const navToggle = $('#navToggle');
const navLinks = $('#navLinks');
navToggle.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => { if (!e.target.closest('.nav')) navLinks.classList.remove('open'); });
$$('.nav-links a').forEach((a) => a.addEventListener('click', () => navLinks.classList.remove('open')));

// ---------- animações de entrada ----------
const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12 });
$$('.reveal').forEach((el) => io.observe(el));

// contador do coração
(function counter() {
  const el = $('#heroCounter');
  let v = 0;
  const target = 2000;
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 1800);
    v = Math.round(target * (1 - Math.pow(1 - p, 3)));
    el.textContent = `+${num(v)}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})();

// ---------- configuração ----------
function planCard(p, pick) {
  const total = num(p.totalLikes);
  return `<label class="plan glass ${pick ? 'pick' : ''}" data-id="${esc(p.id)}">
    ${pick ? `<input type="radio" name="plan" value="${esc(p.id)}" />` : ''}
    ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
    <h3>${esc(p.name)}</h3>
    <div class="price"><span class="grad">${esc(p.price)}</span></div>
    <p class="muted">${esc(p.description || '')}</p>
    <ul>
      <li><b>${total}</b> likes no total</li>
      <li><b>${num(p.likesPerDay || 2000)}</b> por dia${p.days > 1 ? ` · ${p.days} dias` : ''}</li>
      <li>Envio automático após o PIX</li>
    </ul>
    ${pick ? '' : `<a href="#comprar" class="btn btn-primary btn-block" data-choose="${esc(p.id)}">Escolher</a>`}
  </label>`;
}

async function loadConfig() {
  state.config = await api('/api/config');
  const c = state.config;
  document.title = `${c.siteName} — 2.000 likes no Free Fire`;
  if (c.tagline) $('#tagline').textContent = c.tagline;
  const first = c.plans.find((p) => p.days === 1) || c.plans[0];
  if (first) $('#heroPrice').textContent = first.price;
  $('#plansGrid').innerHTML = c.plans.map((p) => planCard({ ...p, likesPerDay: c.likesPerDay }, false)).join('');
  $('#plansPick').innerHTML = c.plans.map((p) => planCard({ ...p, likesPerDay: c.likesPerDay }, true)).join('');
  if (c.notice) { $('#notice').textContent = c.notice; $('#notice').hidden = false; }
  if (c.whatsapp) {
    const href = `https://wa.me/${c.whatsapp.length <= 11 ? '55' + c.whatsapp : c.whatsapp}?text=${encodeURIComponent(`Olá! Vim pelo site ${c.siteName}.`)}`;
    for (const id of ['#whatsLink', '#whatsFab']) { $(id).href = href; $(id).hidden = false; }
  }
  if (!c.paymentsReady) showError('Pagamento PIX ainda não configurado. Fale com o suporte.');
  $$('[data-choose]').forEach((a) => a.addEventListener('click', () => choosePlan(a.dataset.choose)));
  $$('#plansPick input[name=plan]').forEach((r) => r.addEventListener('change', () => choosePlan(r.value)));
  if (first) choosePlan(first.id, true);
}

function choosePlan(id, silent) {
  state.plan = state.config.plans.find((p) => p.id === id) || null;
  $$('#plansPick .plan').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  const r = $(`#plansPick input[value="${id}"]`);
  if (r) r.checked = true;
  updateSummary();
  if (!silent) $('[data-step="3"]').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateSummary() {
  $('#sumPlan').textContent = state.plan ? state.plan.name : '—';
  $('#sumPlayer').textContent = state.player ? `${state.player.nickname} (${state.player.uid})` : '—';
  $('#sumTotal').textContent = state.plan ? state.plan.price : '—';
  $('#btnBuy').disabled = !(state.plan && state.player && state.config?.paymentsReady);
}

function showError(msg) {
  const el = $('#checkoutError');
  el.textContent = msg || '';
  el.hidden = !msg;
}

// ---------- verificação do ID ----------
$('#formUid').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = $('#uid').value.replace(/\D/g, '');
  $('#uid').value = uid;
  if (uid.length < 6) return toast('Digite um ID válido (só números).', 'bad');
  const btn = $('#btnVerify');
  busy(btn, true, 'Buscando…');
  state.player = null;
  updateSummary();
  const box = $('#player');
  try {
    const { player, usedToday, likesPerDay } = await api(`/api/player/${uid}`);
    state.player = player;
    const left = Math.max(0, likesPerDay - usedToday);
    box.innerHTML = `
      <div class="avatar">${esc(player.nickname.slice(0, 2).toUpperCase())}</div>
      <div class="info">
        <strong>${esc(player.nickname)}</strong>
        <span class="muted">ID ${esc(player.uid)}${player.level ? ` · Nível ${player.level}` : ''}${player.region ? ` · ${esc(player.region)}` : ''}</span>
        <span class="muted">${num(player.likes)} likes no perfil${usedToday ? ` · hoje ainda cabem ${num(left)}` : ''}</span>
      </div>
      <span class="badge ok">ID verificado</span>`;
    box.hidden = false;
    if (usedToday >= likesPerDay) toast('Esse ID já recebeu 2.000 likes hoje. O envio será feito amanhã.', 'warn');
    updateSummary();
    $('[data-step="2"]').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    box.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    box.hidden = false;
  } finally {
    busy(btn, false);
  }
});
$('#uid').addEventListener('input', () => { if (state.player && $('#uid').value !== state.player.uid) { state.player = null; $('#player').hidden = true; updateSummary(); } });

// ---------- compra ----------
$('#btnBuy').addEventListener('click', async () => {
  if (!state.plan || !state.player) return;
  const btn = $('#btnBuy');
  busy(btn, true, 'Gerando PIX…');
  showError('');
  try {
    const { order } = await api('/api/orders', { method: 'POST', body: { uid: state.player.uid, planId: state.plan.id, contact: $('#contact').value.trim() } });
    try { localStorage.setItem('like2k:last', order.code); } catch {}
    location.href = `/pedido/${order.code}`;
  } catch (err) {
    showError(err.message);
    busy(btn, false);
  }
});

// ---------- acompanhar ----------
$('#formTrack').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#track').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 6) return toast('Código inválido.', 'bad');
  location.href = `/pedido/${code}`;
});
try { const last = localStorage.getItem('like2k:last'); if (last) $('#track').value = last; } catch {}

loadConfig().catch((err) => showError(err.message));
