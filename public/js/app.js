import { api, int, brl, dt, esc } from './common.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let scene = null;
import('./scene.js')
  .then(({ createScene }) => { scene = createScene($('#stage'), { mode: 'app' }); applyPose(current); })
  .catch((err) => console.warn('3D indisponível:', err));

const state = { me: null, rules: null, global: null, stats: null, settings: null, player: null };
let current = null;

// ------------------------------------------------------------------ ícones e menu
const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  dashboard: icon('<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>'),
  send: icon('<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>'),
  buy: icon('<path d="M3 7h18l-2 12H5L3 7z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>'),
  history: icon('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  clients: icon('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 3.5a4 4 0 0 1 0 8"/><path d="M22 21a7 7 0 0 0-4-6.3"/>'),
  requests: icon('<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 11-5.7"/><path d="M19 15v6M16 18h6"/>'),
  orders: icon('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  sends: icon('<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
};
ICONS.overview = ICONS.dashboard;

const MENUS = {
  client: [['dashboard', 'Painel'], ['send', 'Enviar likes'], ['buy', 'Comprar estoque'], ['history', 'Histórico']],
  admin: [['overview', 'Visão geral'], ['send', 'Enviar likes'], ['clients', 'Clientes'], ['requests', 'Solicitações'], ['orders', 'Pedidos'], ['sends', 'Envios'], ['settings', 'Configurações']],
};

// Ângulo do traje 3D para cada tela — ele gira ao trocar de tela.
const VIEW_ANGLE = { dashboard: -0.45, overview: -0.45, send: 0.55, buy: Math.PI + 0.3, history: 1.4, clients: -1.2, requests: 2.2, orders: Math.PI - 0.4, sends: 0.9, settings: -2.4 };
let rotY = -0.45;

function applyPose(view) {
  if (!scene || !view) return;
  let target = VIEW_ANGLE[view] ?? 0;
  while (target < rotY + 0.4) target += Math.PI * 2; // sempre gira para frente
  if (target - rotY > Math.PI * 2 + 0.4) target -= Math.PI * 2;
  rotY = target;
  const narrow = innerWidth < 860;
  scene.setPose(narrow
    ? { x: 0, y: 1.1, rotY, rotX: 0.05, scale: 0.75, camY: 0.35 }
    : { x: 3.5, y: -0.1, rotY, rotX: 0.04, scale: 0.84, camY: 0.35 });
}

function renderMenu() {
  const items = MENUS[state.me.role];
  $('#menu').innerHTML = items.map(([id, label]) =>
    `<button data-go="${id}">${ICONS[id]}<span>${label}</span><span class="badge hidden" data-badge="${id}"></span></button>`).join('');
}

function setBadge(id, n) {
  const b = $(`[data-badge="${id}"]`);
  if (!b) return;
  b.textContent = n;
  b.classList.toggle('hidden', !n);
}

const LOADERS = {};

function go(view) {
  const allowed = MENUS[state.me.role].map(([id]) => id);
  if (!allowed.includes(view)) view = allowed[0];
  current = view;
  $$('.view').forEach((v) => v.classList.toggle('on', v.dataset.view === view));
  $$('#menu button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  $('#side').classList.remove('open');
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  applyPose(view);
  scrollTo({ top: 0, behavior: 'smooth' });
  LOADERS[view]?.();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (t) { e.preventDefault(); go(t.dataset.go); }
});
$('#menuToggle').addEventListener('click', () => $('#side').classList.toggle('open'));
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; });
addEventListener('resize', () => applyPose(current));

// ------------------------------------------------------------------ utilidades de UI
function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4800);
}

function alertBox(el, msg, kind = 'error') {
  if (!msg) { el.className = 'alert'; return; }
  el.textContent = msg;
  el.className = `alert ${kind} show`;
}

const pill = (status) => {
  const label = { success: 'Enviado', error: 'Erro', pending: 'Pendente', unknown: 'Verificar', active: 'Ativo', blocked: 'Bloqueado', paid: 'Pago', rejected: 'Recusado', canceled: 'Cancelado' }[status] || status;
  return `<span class="pill ${esc(status)}">${esc(label)}</span>`;
};

function table(head, rows, empty = 'Nada por aqui ainda.') {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function modal({ title, text = '', body = '', okText = 'Confirmar', danger = false, onOk }) {
  const m = $('#modal');
  $('#mTitle').textContent = title;
  $('#mText').textContent = text;
  $('#mBody').innerHTML = `${body}<div class="alert" id="mMsg" style="margin-top:12px"></div>`;
  const ok = $('#mOk');
  ok.textContent = okText;
  ok.className = `btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`;
  m.classList.add('show');
  const close = () => { m.classList.remove('show'); ok.onclick = null; };
  $('#mCancel').onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  ok.onclick = async () => {
    ok.disabled = true;
    try { await onOk?.($('#mBody')); close(); } catch (err) { alertBox($('#mMsg'), err.message); } finally { ok.disabled = false; }
  };
  setTimeout(() => $('#mBody input')?.focus(), 50);
}

function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<i class="spinner"></i>${label || ''}`; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
}

// ------------------------------------------------------------------ dados base
async function loadMe() {
  const r = await api('/api/me');
  Object.assign(state, { me: r.user, rules: r.rules, global: r.global, stats: r.stats, settings: r.settings });
  $('#mockBanner').classList.toggle('hidden', !r.mock);
  $('#meName').textContent = r.user.username;
  $('#meRole').textContent = r.user.role === 'admin' ? 'Administrador' : 'Cliente';
  $('#avatar').textContent = r.user.username[0].toUpperCase();
  $('#helloName').textContent = r.user.username;
  return r;
}

function renderStockKpis() {
  const { me, global, stats } = state;
  $('#kStock').textContent = int(me.stock);
  $('#kGlobal').textContent = global.remaining == null ? 'indisponível' : int(global.remaining);
  $('#kGlobalDot').classList.toggle('off', global.remaining == null);
  $('#kGlobalHint').textContent = global.error ? 'API temporariamente indisponível' : 'likes disponíveis na plataforma';
  $('#kToday').textContent = int(stats.sentToday);
  $('#kTotal').textContent = int(stats.sentTotal);
  $('#kCount').textContent = `${int(stats.sendsCount)} envios`;
}

const sendRow = (s, withUser = false) => `<tr>
  <td>${dt(s.createdAt)}</td>
  ${withUser ? `<td>${esc(s.username)}</td>` : ''}
  <td class="mono">${esc(s.targetId)}</td>
  <td>${esc(s.nickname || '—')}</td>
  <td class="num">${int(s.status === 'success' ? s.likesSent : s.amount)}</td>
  <td>${pill(s.status)}${s.error ? `<span class="err-text" title="${esc(s.error)}">${esc(s.error)}</span>` : ''}</td>
</tr>`;
const SEND_HEAD = ['Data', 'ID', 'Nick', 'Likes', 'Status'];

// ------------------------------------------------------------------ cliente: painel
LOADERS.dashboard = async () => {
  await loadMe();
  renderStockKpis();
  const { sends } = await api('/api/sends');
  $('#recentSends').innerHTML = table(SEND_HEAD, sends.slice(0, 8).map((s) => sendRow(s)), 'Você ainda não fez envios. <a href="#send" data-go="send" class="grad">Enviar agora →</a>');
};

LOADERS.history = async () => {
  const { sends } = await api('/api/sends');
  $('#hTable').innerHTML = table(SEND_HEAD, sends.map((s) => sendRow(s)));
};

// ------------------------------------------------------------------ enviar likes
const sId = $('#sId'), sAmount = $('#sAmount'), sRange = $('#sRange');

function sendMax() {
  const r = state.rules;
  let max = r.maxPerSend;
  if (state.me.role === 'client') max = Math.min(max, state.me.stock);
  if (state.player && state.player.uid === sId.value) max = Math.min(max, state.player.dailyLimit - state.player.usedToday);
  return Math.max(0, max);
}

function renderSend() {
  const max = sendMax();
  if (Number(sAmount.value) > max) sAmount.value = max;
  const amount = Math.max(0, Math.min(Number(sAmount.value) || 0, max));
  sRange.max = Math.max(1, max);
  sAmount.max = Math.max(1, max);
  sRange.value = amount;
  sRange.style.setProperty('--p', `${max ? (amount / max) * 100 : 0}%`);
  $('#sChips').innerHTML = [100, 500, 1000, 2000].map((n) => `<button type="button" class="chip ${amount === Math.min(n, max) ? 'on' : ''}" data-n="${n}" ${n > max && n !== 2000 ? 'disabled' : ''}>${n === 2000 ? 'Máximo' : int(n)}</button>`).join('');
  const isClient = state.me.role === 'client';
  const p = state.player && state.player.uid === sId.value ? state.player : null;
  $('#sSummary').innerHTML = `
    <div><span class="muted">ID</span><b class="mono">${esc(sId.value || '—')}</b></div>
    <div><span class="muted">Limite diário deste ID</span><b>${p ? `${int(p.dailyLimit - p.usedToday)} de ${int(p.dailyLimit)} restantes` : `${int(state.rules.dailyLimitPerUid)}/dia`}</b></div>
    ${isClient
      ? `<div><span class="muted">Seu estoque</span><b>${int(state.me.stock)}</b></div>
         <div class="total"><span>Estoque após o envio</span><b class="grad">${int(state.me.stock - amount)}</b></div>`
      : `<div class="total"><span>Envio administrativo</span><b class="grad">${int(amount)} likes</b></div>`}`;
  $('#sBtn').disabled = !amount || !/^\d{5,15}$/.test(sId.value);
  $('#sBtn').textContent = amount ? `Enviar ${int(amount)} likes` : isClient && state.me.stock === 0 ? 'Sem estoque — compre mais' : 'Enviar likes';
}

sId.addEventListener('input', () => { sId.value = sId.value.replace(/\D/g, ''); $('#sPlayer').classList.remove('show'); renderSend(); });
sAmount.addEventListener('input', renderSend);
sRange.addEventListener('input', () => { sAmount.value = sRange.value; renderSend(); });
$('#sChips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-n]');
  if (c) { sAmount.value = Math.min(Number(c.dataset.n), sendMax()); renderSend(); }
});

function renderPlayer() {
  const p = state.player;
  const left = p.dailyLimit - p.usedToday;
  const box = $('#sPlayer');
  box.innerHTML = `<div class="pic">${esc((p.nickname || '?')[0]).toUpperCase()}</div>
    <div><strong>${esc(p.nickname || 'Jogador')}</strong><span>${esc(p.region || '—')}${p.level ? ` · nível ${p.level}` : ''}${p.liked != null ? ` · ${int(p.liked)} likes no perfil` : ''}</span></div>
    <div class="left"><strong class="${left ? '' : 'err-text'}">${int(left)}</strong><span>restantes hoje</span></div>`;
  box.classList.add('show');
}

async function checkPlayer() {
  const uid = sId.value;
  if (!/^\d{5,15}$/.test(uid)) { alertBox($('#sMsg'), 'Digite um ID válido (somente números).'); return null; }
  const btn = $('#sCheck');
  busy(btn, true);
  alertBox($('#sMsg'));
  try {
    state.player = await api(`/api/player/${uid}`);
    renderPlayer();
    scene?.pulse();
    renderSend();
    return state.player;
  } catch (err) {
    alertBox($('#sMsg'), err.message);
    return null;
  } finally {
    busy(btn, false);
  }
}
$('#sCheck').addEventListener('click', checkPlayer);
sId.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checkPlayer(); } });

$('#sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = sId.value;
  const amount = Number(sAmount.value);
  if (!state.player || state.player.uid !== uid) { if (!(await checkPlayer())) return; }
  if (amount < 1 || amount > sendMax()) { alertBox($('#sMsg'), `Quantidade permitida: 1 a ${int(sendMax())}.`); return; }
  const nick = state.player?.nickname;
  modal({
    title: 'Confirmar envio',
    text: `Enviar ${int(amount)} likes para ${nick ? `${nick} ` : ''}(ID ${uid})?`,
    okText: 'Enviar agora',
    onOk: async () => {
      const btn = $('#sBtn');
      busy(btn, true, ' Enviando…');
      try {
        const r = await api('/api/send', { method: 'POST', body: { target_id: uid, amount } });
        state.me.stock = r.stock;
        if (state.player?.uid === uid) { state.player.usedToday = r.usedToday; renderPlayer(); }
        alertBox($('#sMsg'), `✔ ${int(r.send.likesSent)} likes enviados para ${r.send.nickname || uid}.`, 'ok');
        toast(`${int(r.send.likesSent)} likes enviados!`);
        scene?.spin();
      } catch (err) {
        if (err.data?.stock != null) state.me.stock = err.data.stock;
        alertBox($('#sMsg'), err.message);
        toast(err.message, 'error');
      } finally {
        busy(btn, false);
        renderSend();
        loadSendRecent();
      }
    },
  });
});

async function loadSendRecent() {
  if (state.me.role === 'admin') {
    const { sends } = await api('/api/admin/sends');
    $('#sRecent').innerHTML = table(['Data', 'Usuário', ...SEND_HEAD.slice(1)], sends.slice(0, 10).map((s) => sendRow(s, true)));
  } else {
    const { sends } = await api('/api/sends');
    $('#sRecent').innerHTML = table(SEND_HEAD, sends.slice(0, 10).map((s) => sendRow(s)));
  }
}

LOADERS.send = async () => {
  await loadMe();
  renderSend();
  loadSendRecent();
  setTimeout(() => sId.focus(), 300);
};

// ------------------------------------------------------------------ comprar estoque
const bLikes = $('#bLikes'), bRange = $('#bRange');

function renderBuy() {
  const r = state.rules;
  const likes = Number(bLikes.value) || 0;
  const valid = likes >= r.minPurchase && likes % r.packSize === 0 && likes <= r.maxPurchase;
  const packs = Math.floor(likes / r.packSize);
  bRange.value = Math.min(likes, Number(bRange.max));
  bRange.style.setProperty('--p', `${((bRange.value - bRange.min) / (bRange.max - bRange.min)) * 100}%`);
  $('#bChips').innerHTML = [20000, 50000, 100000, 200000].map((n) => `<button type="button" class="chip ${likes === n ? 'on' : ''}" data-n="${n}">${int(n / 1000)}K</button>`).join('');
  $('#bSummary').innerHTML = `
    <div><span class="muted">Pacotes de 2.000</span><b>${int(packs)}</b></div>
    <div><span class="muted">Preço por pacote</span><b>${brl(r.pricePerPackCents)}</b></div>
    <div><span class="muted">Estoque após a aprovação</span><b>${int(state.me.stock + (valid ? likes : 0))}</b></div>
    <div class="total"><span>Total</span><b class="grad">${valid ? brl(packs * r.pricePerPackCents) : '—'}</b></div>`;
  alertBox($('#bMsg'), valid || !likes ? '' : likes < r.minPurchase ? `O mínimo é ${int(r.minPurchase)} likes.` : likes % r.packSize ? 'Use múltiplos de 2.000 likes.' : `Máximo de ${int(r.maxPurchase)} likes por pedido.`);
}
bLikes.addEventListener('input', renderBuy);
bLikes.addEventListener('change', () => {
  const r = state.rules;
  bLikes.value = Math.max(r.minPurchase, Math.round((Number(bLikes.value) || 0) / r.packSize) * r.packSize);
  renderBuy();
});
bRange.addEventListener('input', () => { bLikes.value = bRange.value; renderBuy(); });
$('#bChips').addEventListener('click', (e) => { const c = e.target.closest('[data-n]'); if (c) { bLikes.value = c.dataset.n; renderBuy(); } });

function pixBox(order) {
  const s = state.settings;
  return `<strong>Pedido #${order.id} · ${int(order.likes)} likes · ${brl(order.priceCents)}</strong>
    ${s.pixKey ? `<div><span class="muted">Chave PIX${s.pixHolder ? ` — ${esc(s.pixHolder)}` : ''}</span><code>${esc(s.pixKey)}</code></div>` : '<span class="muted">O administrador enviará os dados de pagamento.</span>'}
    ${s.pixKey ? '<button type="button" class="btn btn-sm" data-copy>Copiar chave PIX</button>' : ''}
    <span class="muted" style="font-size:13px">${esc(s.paymentNote)}${s.contact ? ` Contato: ${esc(s.contact)}` : ''}</span>`;
}
$('#bPix').addEventListener('click', (e) => {
  if (e.target.closest('[data-copy]')) navigator.clipboard?.writeText(state.settings.pixKey).then(() => toast('Chave PIX copiada.'));
});

$('#buyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('#buyForm button[type=submit]');
  busy(btn, true, ' Gerando…');
  try {
    const { order } = await api('/api/orders', { method: 'POST', body: { likes: Number(bLikes.value) } });
    $('#bPix').innerHTML = pixBox(order);
    $('#bPix').classList.remove('hidden');
    toast('Pedido criado! Faça o pagamento para liberar o estoque.');
    scene?.pulse();
    loadOrders();
  } catch (err) {
    alertBox($('#bMsg'), err.message);
  } finally {
    busy(btn, false);
  }
});

async function loadOrders() {
  const { orders } = await api('/api/orders');
  $('#bOrders').innerHTML = table(['#', 'Likes', 'Valor', 'Status', 'Data', ''], orders.map((o) => `<tr>
    <td>#${o.id}</td><td class="num">${int(o.likes)}</td><td class="num">${brl(o.priceCents)}</td><td>${pill(o.status)}</td><td>${dt(o.createdAt)}</td>
    <td>${o.status === 'pending' ? `<div class="actions"><button class="btn btn-xs" data-pay="${o.id}">Pagar</button><button class="btn btn-xs btn-danger" data-cancel="${o.id}">Cancelar</button></div>` : ''}</td></tr>`), 'Nenhum pedido ainda.');
  $('#bOrders').onclick = async (e) => {
    const pay = e.target.closest('[data-pay]');
    const cancel = e.target.closest('[data-cancel]');
    if (pay) {
      const o = orders.find((x) => x.id === Number(pay.dataset.pay));
      $('#bPix').innerHTML = pixBox(o);
      $('#bPix').classList.remove('hidden');
    }
    if (cancel) {
      modal({ title: 'Cancelar pedido', text: `Cancelar o pedido #${cancel.dataset.cancel}?`, okText: 'Cancelar pedido', danger: true, onOk: async () => {
        await api(`/api/orders/${cancel.dataset.cancel}/cancel`, { method: 'POST' });
        $('#bPix').classList.add('hidden');
        loadOrders();
      } });
    }
  };
}

LOADERS.buy = async () => {
  await loadMe();
  renderBuy();
  loadOrders();
};

// ------------------------------------------------------------------ admin: visão geral
async function loadOverview(refresh = false) {
  const o = await api(`/api/admin/overview${refresh ? '?refresh=1' : ''}`);
  const g = o.global;
  $('#mockBanner').classList.toggle('hidden', !o.mock);
  $('#oRemaining').textContent = g.remaining == null ? 'indisponível' : int(g.remaining);
  $('#oDot').classList.toggle('off', g.remaining == null);
  $('#oPlan').textContent = g.error && g.remaining == null ? g.error : `${g.plan === 'daily' ? 'Plano diário' : 'Plano estoque'}${g.expiry ? ` · expira ${new Date(`${g.expiry}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}`;
  $('#oMeter').style.width = g.stockLimit ? `${Math.min(100, (g.remaining / g.stockLimit) * 100)}%` : '0';
  $('#oAllocated').textContent = int(g.allocated);
  $('#oFree').textContent = g.free == null ? '—' : int(g.free);
  $('#oFree').style.color = g.free != null && g.free < 0 ? 'var(--red)' : '';
  $('#oToday').textContent = int(o.today.likes);
  $('#oTodayHint').textContent = `${int(o.today.sends)} envios · ${int(o.today.errors)} erros`;
  $('#oRevenue').textContent = brl(o.revenueCents);
  $('#oClients').textContent = int(o.counts.clients);
  $('#oClientsHint').textContent = `${int(o.counts.active)} ativos`;
  setBadge('orders', o.counts.pendingOrders);
  setBadge('requests', o.counts.requests);

  const [{ orders }, { users }] = await Promise.all([api('/api/admin/orders'), api('/api/admin/users')]);
  const pend = orders.filter((x) => x.status === 'pending').slice(0, 6);
  $('#oOrders').innerHTML = table(['#', 'Cliente', 'Likes', 'Valor', ''], pend.map((x) => `<tr><td>#${x.id}</td><td>${esc(x.username)}</td><td class="num">${int(x.likes)}</td><td class="num">${brl(x.priceCents)}</td>
    <td><div class="actions"><button class="btn btn-xs btn-ok" data-approve="${x.id}">Aprovar</button></div></td></tr>`), 'Nenhum pedido pendente.');
  const reqs = users.filter((u) => u.status === 'pending').slice(0, 6);
  $('#oRequests').innerHTML = table(['Usuário', 'Contato', ''], reqs.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.contact)}</td>
    <td><div class="actions"><button class="btn btn-xs btn-ok" data-req-approve="${u.id}">Aprovar</button><button class="btn btn-xs btn-danger" data-req-reject="${u.id}">Recusar</button></div></td></tr>`), 'Nenhuma solicitação.');
}
LOADERS.overview = () => loadOverview();
$('#refreshOverview').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  busy(btn, true, ' Atualizando…');
  try { await loadOverview(true); toast('Saldo da API atualizado.'); } catch (err) { toast(err.message, 'error'); } finally { busy(btn, false); }
});

// ações de pedidos e solicitações (compartilhadas entre telas)
document.addEventListener('click', (e) => {
  const approve = e.target.closest('[data-approve]');
  const reject = e.target.closest('[data-reject]');
  const reqA = e.target.closest('[data-req-approve]');
  const reqR = e.target.closest('[data-req-reject]');
  const refresh = () => LOADERS[current]?.();
  if (approve) {
    const id = approve.dataset.approve;
    const doApprove = (force) => api(`/api/admin/orders/${id}/approve`, { method: 'POST', body: { force } });
    modal({ title: `Aprovar pedido #${id}`, text: 'Confirme que o pagamento foi recebido. O estoque individual do cliente será creditado.', okText: 'Aprovar', onOk: async () => {
      try { await doApprove(false); } catch (err) {
        if (!err.data?.needsForce) throw err;
        setTimeout(() => modal({ title: 'Estoque global baixo', text: err.message, okText: 'Aprovar mesmo assim', danger: true, onOk: async () => { await doApprove(true); toast('Pedido aprovado.'); refresh(); } }), 50);
        return;
      }
      toast('Pedido aprovado e estoque creditado.');
      refresh();
    } });
  }
  if (reject) {
    modal({ title: `Recusar pedido #${reject.dataset.reject}`, okText: 'Recusar', danger: true, onOk: async () => {
      await api(`/api/admin/orders/${reject.dataset.reject}/reject`, { method: 'POST' }); refresh();
    } });
  }
  if (reqA) api(`/api/admin/requests/${reqA.dataset.reqApprove}/approve`, { method: 'POST' }).then(() => { toast('Acesso aprovado.'); refresh(); }).catch((err) => toast(err.message, 'error'));
  if (reqR) modal({ title: 'Recusar solicitação', text: 'O cadastro será removido.', okText: 'Recusar', danger: true, onOk: async () => {
    await api(`/api/admin/requests/${reqR.dataset.reqReject}/reject`, { method: 'POST' }); refresh();
  } });
});

// ------------------------------------------------------------------ admin: clientes
let clients = [];
function renderClients() {
  const q = $('#cSearch').value.trim().toLowerCase();
  const list = clients.filter((u) => u.status !== 'pending' && (!q || u.username.toLowerCase().includes(q) || u.contact.toLowerCase().includes(q)));
  $('#cCount').textContent = `${int(list.length)} clientes · ${int(list.reduce((a, u) => a + u.stock, 0))} likes alocados`;
  $('#cTable').innerHTML = table(['Usuário', 'Status', 'Estoque', 'Contato', 'Último login', ''], list.map((u) => `<tr>
    <td><strong>${esc(u.username)}</strong></td><td>${pill(u.status)}</td><td class="num">${int(u.stock)}</td><td>${esc(u.contact || '—')}</td><td>${dt(u.lastLoginAt)}</td>
    <td><div class="actions">
      <button class="btn btn-xs" data-stock="${u.id}">Estoque</button>
      <button class="btn btn-xs" data-pass="${u.id}">Senha</button>
      <button class="btn btn-xs ${u.status === 'active' ? 'btn-danger' : 'btn-ok'}" data-toggle="${u.id}">${u.status === 'active' ? 'Bloquear' : 'Ativar'}</button>
      <button class="btn btn-xs btn-danger" data-del="${u.id}" aria-label="Excluir">✕</button>
    </div></td></tr>`), 'Nenhum cliente cadastrado.');
}
LOADERS.clients = async () => { clients = (await api('/api/admin/users')).users; renderClients(); };
$('#cSearch').addEventListener('input', renderClients);

$('#cForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { user } = await api('/api/admin/users', { method: 'POST', body: { username: $('#cUser').value, password: $('#cPass').value, stock: Number($('#cStock').value) || 0, contact: $('#cContact').value } });
    alertBox($('#cMsg'), `Acesso criado: ${user.username}`, 'ok');
    e.target.reset();
    LOADERS.clients();
  } catch (err) { alertBox($('#cMsg'), err.message); }
});

$('#cTable').addEventListener('click', (e) => {
  const find = (attr) => { const b = e.target.closest(`[${attr}]`); return b && clients.find((u) => u.id === Number(b.getAttribute(attr))); };
  const patch = (u, body) => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
  let u;
  if ((u = find('data-stock'))) {
    modal({
      title: `Estoque de ${u.username}`, text: `Estoque atual: ${int(u.stock)} likes. Use valores negativos para remover.`,
      body: `<div class="field"><label>Ajuste (likes)</label><input class="input mono" id="mDelta" type="number" step="2000" value="20000" /></div>
        <div class="chips" style="margin-top:10px">${[20000, 50000, 100000, -2000].map((n) => `<button type="button" class="chip" onclick="document.getElementById('mDelta').value=${n};document.getElementById('mDelta').dispatchEvent(new Event('input'))">${n > 0 ? '+' : ''}${int(n)}</button>`).join('')}</div>
        <p class="muted" id="mNew" style="margin:12px 0 0"></p>`,
      okText: 'Aplicar',
      onOk: async () => { await patch(u, { stockDelta: Number($('#mDelta').value) }); toast('Estoque atualizado.'); LOADERS.clients(); },
    });
    const upd = () => { $('#mNew').textContent = `Novo estoque: ${int(u.stock + (Number($('#mDelta').value) || 0))} likes`; };
    $('#mDelta').addEventListener('input', upd); upd();
  } else if ((u = find('data-pass'))) {
    modal({ title: `Nova senha para ${u.username}`, body: '<div class="field"><label>Senha</label><input class="input" id="mPass" minlength="6" /></div>', okText: 'Salvar',
      onOk: async () => { await patch(u, { password: $('#mPass').value }); toast('Senha alterada.'); } });
  } else if ((u = find('data-toggle'))) {
    patch(u, { status: u.status === 'active' ? 'blocked' : 'active' }).then(() => LOADERS.clients()).catch((err) => toast(err.message, 'error'));
  } else if ((u = find('data-del'))) {
    modal({ title: `Excluir ${u.username}?`, text: `O acesso e o estoque de ${int(u.stock)} likes serão removidos. Esta ação não pode ser desfeita.`, okText: 'Excluir', danger: true,
      onOk: async () => { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); LOADERS.clients(); } });
  }
});

LOADERS.requests = async () => {
  const { users } = await api('/api/admin/users');
  const reqs = users.filter((u) => u.status === 'pending');
  setBadge('requests', reqs.length);
  $('#rTable').innerHTML = table(['Usuário', 'Contato', 'Pedido em', ''], reqs.map((u) => `<tr><td><strong>${esc(u.username)}</strong></td><td>${esc(u.contact)}</td><td>${dt(u.createdAt)}</td>
    <td><div class="actions"><button class="btn btn-xs btn-ok" data-req-approve="${u.id}">Aprovar</button><button class="btn btn-xs btn-danger" data-req-reject="${u.id}">Recusar</button></div></td></tr>`), 'Nenhuma solicitação pendente.');
};

LOADERS.orders = async () => {
  const { orders } = await api('/api/admin/orders');
  setBadge('orders', orders.filter((o) => o.status === 'pending').length);
  $('#ordTable').innerHTML = table(['#', 'Cliente', 'Likes', 'Valor', 'Status', 'Criado', ''], orders.map((o) => `<tr>
    <td>#${o.id}</td><td>${esc(o.username)}</td><td class="num">${int(o.likes)}</td><td class="num">${brl(o.priceCents)}</td><td>${pill(o.status)}</td><td>${dt(o.createdAt)}</td>
    <td>${o.status === 'pending' ? `<div class="actions"><button class="btn btn-xs btn-ok" data-approve="${o.id}">Aprovar</button><button class="btn btn-xs btn-danger" data-reject="${o.id}">Recusar</button></div>` : ''}</td></tr>`), 'Nenhum pedido.');
};

// ------------------------------------------------------------------ admin: envios
let sendSrc = 'local';
LOADERS.sends = async () => {
  $('#aSends').innerHTML = '<div class="empty">Carregando…</div>';
  try {
    if (sendSrc === 'local') {
      const { sends } = await api('/api/admin/sends');
      $('#aSends').innerHTML = table(['Data', 'Usuário', ...SEND_HEAD.slice(1)], sends.map((s) => sendRow(s, true)));
    } else {
      const { logs } = await api('/api/admin/remote-logs?limit=100&days=30');
      $('#aSends').innerHTML = table(['Log', 'ID', 'Likes', 'Status', 'Origem', 'Data'], (logs || []).map((l) => `<tr><td>#${l.log_id}</td><td class="mono">${esc(l.target_id)}</td>
        <td class="num">${int(l.likes_sent)}</td><td>${pill(l.status)}</td><td>${esc(l.action)}</td><td>${dt(l.timestamp)}</td></tr>`));
    }
  } catch (err) { $('#aSends').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
};
$$('[data-src]').forEach((b) => b.addEventListener('click', () => {
  sendSrc = b.dataset.src;
  $$('[data-src]').forEach((x) => x.classList.toggle('on', x === b));
  LOADERS.sends();
}));

// ------------------------------------------------------------------ admin: configurações
LOADERS.settings = async () => {
  const { settings } = await api('/api/admin/settings');
  $('#stPix').value = settings.pixKey; $('#stHolder').value = settings.pixHolder; $('#stContact').value = settings.contact; $('#stNote').value = settings.paymentNote;
};
$('#setForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/settings', { method: 'PUT', body: { pixKey: $('#stPix').value, pixHolder: $('#stHolder').value, contact: $('#stContact').value, paymentNote: $('#stNote').value } });
    alertBox($('#stMsg'), 'Configurações salvas.', 'ok');
  } catch (err) { alertBox($('#stMsg'), err.message); }
});

// ------------------------------------------------------------------ inicialização
(async () => {
  try { await loadMe(); } catch { location.href = '/#acesso'; return; }
  renderMenu();
  go(location.hash.slice(1) || MENUS[state.me.role][0][0]);
  if (state.me.role === 'admin') api('/api/admin/overview').then((o) => { setBadge('orders', o.counts.pendingOrders); setBadge('requests', o.counts.requests); }).catch(() => {});
  addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== current) go(v); });
  // Mantém o estoque global atualizado
  setInterval(() => { if (!document.hidden && (current === 'dashboard')) LOADERS.dashboard().catch(() => {}); }, 60000);
})();

// Sessão expirada em qualquer chamada → volta para o login
addEventListener('unhandledrejection', (e) => { if (e.reason?.status === 401) location.href = '/#acesso'; });
