import { api, $, $$, num, esc, when, toast, busy } from './common.js';

const state = { config: null, player: null, server: 'BR' };

// ---------- menu ----------
const navToggle = $('#navToggle');
const navLinks = $('#navLinks');
navToggle.addEventListener('click', () => { navToggle.setAttribute('aria-expanded', String(navLinks.classList.toggle('open'))); });
document.addEventListener('click', (e) => { if (!e.target.closest('.nav')) navLinks.classList.remove('open'); });
$$('.nav-links a').forEach((a) => a.addEventListener('click', () => navLinks.classList.remove('open')));

// ---------- animações ----------
const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12 });
$$('.reveal').forEach((el) => io.observe(el));

function countTo(el, target, prefix = '+') {
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 1500);
    el.textContent = `${prefix}${num(Math.round(target * (1 - Math.pow(1 - p, 3))))}`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
countTo($('#heroCounter'), 105);

// ---------- configuração ----------
function showError(msg) { const el = $('#formError'); el.textContent = msg || ''; el.hidden = !msg; }

async function loadConfig() {
  state.config = await api('/api/config');
  const c = state.config;
  document.title = `${c.siteName} — Acompanhe seus likes no Free Fire`;
  if (c.tagline) $('#tagline').textContent = c.tagline;
  $('#server').innerHTML = c.servers.map((s) => `<option value="${s.code}" ${s.code === c.defaultServer ? 'selected' : ''}>${esc(s.label)} (${s.code})</option>`).join('');
  if (c.notice) { $('#notice').textContent = c.notice; $('#notice').hidden = false; }
  if (c.whatsapp) {
    const href = `https://wa.me/${c.whatsapp.length <= 11 ? '55' + c.whatsapp : c.whatsapp}?text=${encodeURIComponent(`Olá! Vim pelo site ${c.siteName}.`)}`;
    for (const id of ['#whatsLink', '#whatsFab']) { $(id).href = href; $(id).hidden = false; }
  }
  try {
    const last = JSON.parse(localStorage.getItem('like2k:last') || 'null');
    if (last?.uid) { $('#uid').value = last.uid; if (c.servers.some((s) => s.code === last.server)) $('#server').value = last.server; }
  } catch {}
}

// ---------- consulta ----------
function renderPlayer(data) {
  const p = data.player;
  state.player = p;
  $('#player').innerHTML = `
    <div class="avatar">${esc((p.nickname || '?').slice(0, 2).toUpperCase())}</div>
    <div class="info">
      <strong>${esc(p.nickname || 'Sem nick')}</strong>
      <span class="muted">ID ${esc(p.uid)}${p.level ? ` · Nível ${p.level}` : ''} · ${esc(p.region || p.server)}</span>
    </div>
    <span class="badge ok">ID verificado</span>`;
  $('#likesNow').textContent = num(p.likes);
  $('#likesGiven').textContent = `+${num(data.totalGiven)}`;
  $('#todayState').innerHTML = data.receivedToday ? '<span class="badge ok">já recebeu</span>' : '<span class="badge info">disponível</span>';
  $('#sendBox').hidden = !(state.config.publicSend && !data.receivedToday);
  $('#resultStep').hidden = false;
  renderHistory(data.history);
}

function renderHistory(list) {
  $('#historyStep').hidden = !list.length;
  $('#history').innerHTML = list.map((s) => `
    <li class="${s.status === 'ok' ? 'sent' : s.status === 'error' ? 'failed' : 'queued'}">
      <span class="dot"></span>
      <div>
        <strong>${s.status === 'ok' ? `+${num(s.given)} likes` : s.status === 'error' ? 'Falhou' : 'Sem alteração'} · ${esc(s.server)}</strong>
        <span class="muted">${when(s.at)}${s.before != null ? ` · ${num(s.before)} → ${num(s.after)}` : ''}</span>
        ${s.error ? `<span class="muted small">${esc(s.error)}</span>` : ''}
      </div>
    </li>`).join('');
}

$('#formUid').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = $('#uid').value.replace(/\D/g, '');
  const server = $('#server').value;
  $('#uid').value = uid;
  if (uid.length < 6) return showError('Digite um ID válido (só números).');
  showError('');
  $('#sendResult').hidden = true;
  const btn = $('#btnVerify');
  busy(btn, true, 'Consultando…');
  try {
    const data = await api(`/api/player?uid=${uid}&server=${server}`);
    state.server = server;
    try { localStorage.setItem('like2k:last', JSON.stringify({ uid, server })); } catch {}
    renderPlayer(data);
    $('#resultStep').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    $('#resultStep').hidden = true;
    $('#historyStep').hidden = true;
    showError(err.message);
  } finally { busy(btn, false); }
});

// ---------- envio ----------
$('#btnSend').addEventListener('click', async () => {
  if (!state.player) return;
  const btn = $('#btnSend');
  busy(btn, true, 'Enviando likes… isso leva alguns segundos');
  $('#sendResult').hidden = true;
  try {
    const { send, history, totalGiven } = await api('/api/send', { method: 'POST', body: { uid: state.player.uid, server: state.server } });
    const box = $('#sendResult');
    if (send.status === 'ok') {
      box.innerHTML = `<div class="big-result"><span class="grad" id="givenCounter">+0</span><p>likes enviados para <b>${esc(send.nickname || state.player.nickname)}</b></p></div>
        <div class="before-after"><div><span class="muted">Antes</span><strong>${num(send.before)}</strong></div><div class="arrow">→</div><div><span class="muted">Depois</span><strong class="grad">${num(send.after)}</strong></div></div>`;
      box.hidden = false;
      countTo($('#givenCounter'), send.given);
      $('#likesNow').textContent = num(send.after);
      $('#likesGiven').textContent = `+${num(totalGiven)}`;
      $('#todayState').innerHTML = '<span class="badge ok">já recebeu</span>';
      $('#sendBox').hidden = true;
      toast(`+${num(send.given)} likes!`, 'ok');
    } else {
      box.innerHTML = `<p class="error">${esc(send.error || 'A API não conseguiu enviar agora.')}</p>`;
      box.hidden = false;
    }
    renderHistory(history);
  } catch (err) {
    $('#sendResult').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    $('#sendResult').hidden = false;
  } finally { busy(btn, false); }
});

loadConfig().catch((err) => showError(err.message));
