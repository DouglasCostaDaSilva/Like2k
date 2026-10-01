import { api, $, $$, brl, num, esc, when, badge, toast, busy } from './common.js';

const state = { tab: 'overview', settings: null };

// ---------- login ----------
async function boot() {
  const me = await api('/admin/api/me');
  if (me.admin) showApp(); else showLogin();
}
function showLogin() { $('#login').hidden = false; $('#app').hidden = true; }
function showApp() { $('#login').hidden = true; $('#app').hidden = false; openTab(state.tab); }

$('#formLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  busy(btn, true, 'Entrando…');
  $('#loginError').hidden = true;
  try {
    await api('/admin/api/login', { method: 'POST', body: { username: $('#loginUser').value, password: $('#loginPass').value } });
    showApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
    $('#loginError').hidden = false;
  } finally { busy(btn, false); }
});
$('#btnLogout').addEventListener('click', async () => { await api('/admin/api/logout', { method: 'POST', body: {} }); showLogin(); });

// ---------- abas ----------
const loaders = { overview: loadOverview, orders: loadOrders, deliveries: loadDeliveries, send: () => {}, settings: loadSettings };
function openTab(name) {
  state.tab = name;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => { t.hidden = t.dataset.tab !== name; });
  Promise.resolve(loaders[name]()).catch(fail);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
function fail(err) { if (err.status === 401) showLogin(); else toast(err.message, 'bad'); }
const confirmAction = (msg) => window.confirm(msg);

// ---------- visão geral ----------
async function loadOverview(refresh = false) {
  const o = await api(`/admin/api/overview${refresh ? '?refresh=1' : ''}`);
  $('#modeTag').textContent = o.mock ? 'MODO SIMULADO' : `PIX: ${o.provider}`;
  const alerts = [];
  if (o.mock) alerts.push(['warn', 'Modo simulado ativo (MOCK=1): nenhum like real é enviado e o PIX é fictício.']);
  if (!o.apiReady) alerts.push(['bad', 'LIKE_API_KEY não configurada: os envios vão falhar.']);
  if (!o.paymentsReady) alerts.push(['bad', 'MP_ACCESS_TOKEN não configurado: o site não consegue gerar PIX.']);
  if (o.failed) alerts.push(['bad', `${o.failed} envio(s) falharam e precisam de reenvio (aba Envios).`]);
  if (o.balanceError) alerts.push(['warn', `Saldo da API indisponível: ${o.balanceError}`]);
  $('#alerts').innerHTML = alerts.map(([k, t]) => `<div class="alert ${k}">${esc(t)}</div>`).join('');
  const c = o.counts;
  $('#tiles').innerHTML = [
    ['Vendas hoje', brl(o.today.amount), `${o.today.count} pedido(s)`],
    ['Likes enviados hoje', num(o.today.likes), ''],
    ['Total vendido', brl(o.total.amount), `${o.total.count} pedido(s) pagos`],
    ['Likes enviados (total)', num(o.total.likes), ''],
    ['Na fila', num(o.queued), 'envios agendados'],
    ['Aguardando PIX', num(c.pending || 0), `${num(c.expired || 0)} expirados`],
  ].map(([l, v, s]) => `<div class="tile glass"><span>${l}</span><strong>${v}</strong>${s ? `<small>${esc(s)}</small>` : ''}</div>`).join('');
  const max = Math.max(1, ...o.days.map((d) => d.amount));
  $('#bars').innerHTML = o.days.map((d) => `<div title="${d.day}: ${brl(d.amount)} (${d.count})"><i style="height:${Math.round((d.amount / max) * 100)}%"></i><b>${d.day.slice(8)}/${d.day.slice(5, 7)}</b></div>`).join('');
  const b = o.balance;
  $('#balance').innerHTML = b ? [
    ['Likes disponíveis', num(b.remaining)],
    ['Plano', esc(b.plan_type || '—')],
    ['Estoque total', b.stock_limit ? num(b.stock_limit) : '—'],
    ['Usados hoje', b.daily_limit ? `${num(b.used_today)} / ${num(b.daily_limit)}` : num(b.used_today || 0)],
    ['Validade', esc(b.expiry_date || '—')],
  ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('') : `<p class="muted">${esc(o.balanceError || 'Sem dados.')}</p>`;
}
$('#btnRefresh').addEventListener('click', () => loadOverview(true).catch(fail));

// ---------- pedidos ----------
async function loadOrders() {
  const status = $('#orderStatus').value;
  const q = $('#orderSearch').value.trim();
  const { orders, total } = await api(`/admin/api/orders?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  const tb = $('#ordersTable tbody');
  if (!orders.length) { tb.innerHTML = `<tr><td colspan="8" class="empty">Nenhum pedido.</td></tr>`; return; }
  tb.innerHTML = orders.map((o) => {
    const sent = o.deliveries.filter((d) => d.status === 'sent').length;
    const actions = [`<a class="btn" href="/pedido/${o.code}" target="_blank" rel="noopener">Abrir</a>`];
    if (o.status === 'pending' || o.status === 'expired') actions.push(`<button class="btn btn-primary" data-confirm="${o.code}">Confirmar pago</button>`, `<button class="btn" data-cancel="${o.code}">Cancelar</button>`);
    return `<tr>
      <td><b>${o.code}</b>${o.paidBy === 'manual' ? ' <span class="muted small">(manual)</span>' : ''}</td>
      <td>${esc(o.nickname || '—')}<br><span class="muted small">${o.uid}${o.contact ? ` · ${esc(o.contact)}` : ''}</span></td>
      <td>${esc(o.plan.name)}</td><td>${o.amount}</td><td>${badge(o.status)}</td>
      <td>${o.deliveries.length ? `${sent}/${o.deliveries.length}` : '—'}</td>
      <td>${when(o.createdAt)}</td><td>${actions.join('')}</td></tr>`;
  }).join('') + (total > orders.length ? `<tr><td colspan="8" class="empty">Mostrando ${orders.length} de ${total}. Use a busca para refinar.</td></tr>` : '');
}
$('#orderStatus').addEventListener('change', () => loadOrders().catch(fail));
let searchTimer;
$('#orderSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadOrders().catch(fail), 300); });
$('#ordersTable').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-confirm]');
  const x = e.target.closest('[data-cancel]');
  try {
    if (c && confirmAction(`Confirmar o pagamento do pedido ${c.dataset.confirm} manualmente? Os envios começam na hora.`)) {
      busy(c, true, '…');
      await api(`/admin/api/orders/${c.dataset.confirm}/confirm`, { method: 'POST', body: {} });
      toast('Pedido confirmado. Envios na fila.');
      await loadOrders();
    } else if (x && confirmAction(`Cancelar o pedido ${x.dataset.cancel}?`)) {
      await api(`/admin/api/orders/${x.dataset.cancel}/cancel`, { method: 'POST', body: {} });
      toast('Pedido cancelado.');
      await loadOrders();
    }
  } catch (err) { fail(err); }
});

// ---------- envios ----------
async function loadDeliveries() {
  const status = $('#deliveryStatus').value;
  const { deliveries, total } = await api(`/admin/api/deliveries?status=${encodeURIComponent(status)}`);
  const tb = $('#deliveriesTable tbody');
  if (!deliveries.length) { tb.innerHTML = `<tr><td colspan="9" class="empty">Nenhum envio.</td></tr>`; return; }
  tb.innerHTML = deliveries.map((d) => {
    const actions = [];
    if (d.status === 'failed' || d.status === 'queued') actions.push(`<button class="btn btn-primary" data-retry="${d.id}">${d.status === 'failed' ? 'Reenviar' : 'Enviar agora'}</button>`);
    if (d.status === 'queued') actions.push(`<button class="btn" data-cancel="${d.id}">Cancelar</button>`);
    return `<tr>
      <td>${d.id}</td>
      <td>${d.uid}<br><span class="muted small">${esc(d.nickname || '')}</span></td>
      <td>${d.code ? `<a href="/pedido/${d.code}" target="_blank" rel="noopener"><b>${d.code}</b></a>` : '<span class="muted">manual</span>'}</td>
      <td>${d.day}</td><td>${d.status === 'sent' ? num(d.likesSent) : num(d.amount)}</td><td>${badge(d.status)}</td>
      <td>${d.status === 'sent' ? when(d.sentAt) : d.status === 'queued' ? `previsto ${when(d.dueAt)}` : when(d.createdAt)}</td>
      <td class="wrap-text">${esc(d.error || '')}${d.attempts > 1 ? ` <span class="small">(${d.attempts} tentativas)</span>` : ''}</td>
      <td>${actions.join('')}</td></tr>`;
  }).join('') + (total > deliveries.length ? `<tr><td colspan="9" class="empty">Mostrando ${deliveries.length} de ${total}.</td></tr>` : '');
}
$('#deliveryStatus').addEventListener('change', () => loadDeliveries().catch(fail));
$('#deliveriesTable').addEventListener('click', async (e) => {
  const r = e.target.closest('[data-retry]');
  const x = e.target.closest('[data-cancel]');
  try {
    if (r) {
      busy(r, true, 'Enviando…');
      const { delivery } = await api(`/admin/api/deliveries/${r.dataset.retry}/retry`, { method: 'POST', body: {} });
      toast(delivery.status === 'sent' ? `Enviado: ${num(delivery.likesSent)} likes.` : `Não enviado: ${delivery.error}`, delivery.status === 'sent' ? 'ok' : 'warn');
      await loadDeliveries();
    } else if (x && confirmAction('Cancelar esse envio? O cliente não receberá esse dia.')) {
      await api(`/admin/api/deliveries/${x.dataset.cancel}/cancel`, { method: 'POST', body: {} });
      await loadDeliveries();
    }
  } catch (err) { fail(err); }
});

// ---------- envio manual ----------
$('#btnSendCheck').addEventListener('click', async () => {
  const uid = $('#sendUid').value.replace(/\D/g, '');
  const box = $('#sendPlayer');
  busy($('#btnSendCheck'), true, '…');
  try {
    const { player, usedToday } = await api(`/admin/api/player/${uid}`);
    box.innerHTML = `<div class="info"><strong>${esc(player.nickname)}</strong><span class="muted">ID ${player.uid}${player.level ? ` · Nível ${player.level}` : ''} · ${num(player.likes)} likes · hoje já recebeu ${num(usedToday)}</span></div>`;
    box.hidden = false;
  } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; box.hidden = false; }
  finally { busy($('#btnSendCheck'), false); }
});
$('#formSend').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = $('#sendUid').value.replace(/\D/g, '');
  const amount = Number($('#sendAmount').value);
  if (!confirmAction(`Enviar ${num(amount)} likes para o ID ${uid}?`)) return;
  busy($('#btnSend'), true, 'Enviando…');
  try {
    const { delivery } = await api('/admin/api/send', { method: 'POST', body: { uid, amount } });
    $('#sendResult').innerHTML = `<div class="alert" style="margin-top:14px;border-color:rgba(48,212,127,.4);background:rgba(48,212,127,.1);color:var(--ok)">Enviados ${num(delivery.likesSent)} likes para ${esc(delivery.nickname || uid)}.</div>`;
  } catch (err) {
    $('#sendResult').innerHTML = `<div class="alert bad" style="margin-top:14px">${esc(err.message)}</div>`;
  } finally { busy($('#btnSend'), false); }
});

// ---------- configurações ----------
function planRow(p = { id: '', name: '', days: 1, priceCents: 990, tag: '', description: '', active: true }) {
  return `<tr>
    <td><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''}></td>
    <td><input data-f="id" value="${esc(p.id)}" maxlength="20" placeholder="2k"></td>
    <td><input data-f="name" value="${esc(p.name)}" maxlength="40" placeholder="2K Likes"></td>
    <td><input data-f="days" type="number" min="1" max="365" value="${p.days}"></td>
    <td><input data-f="price" type="number" min="1" step="0.01" value="${(p.priceCents / 100).toFixed(2)}"></td>
    <td><input data-f="tag" value="${esc(p.tag || '')}" maxlength="20" placeholder="Mais vendido"></td>
    <td><input data-f="description" value="${esc(p.description || '')}" maxlength="140"></td>
    <td><button class="btn" type="button" data-remove>Remover</button></td></tr>`;
}
async function loadSettings() {
  const { settings } = await api('/admin/api/settings');
  state.settings = settings;
  $('#sSiteName').value = settings.siteName;
  $('#sWhatsapp').value = settings.whatsapp || '';
  $('#sTagline').value = settings.tagline || '';
  $('#sNotice').value = settings.notice || '';
  $('#plansTable tbody').innerHTML = settings.plans.map(planRow).join('');
  const o = await api('/admin/api/overview');
  $('#integrations').innerHTML = [
    ['API de likes', o.apiReady ? '<span class="badge ok">configurada</span>' : '<span class="badge bad">falta LIKE_API_KEY</span>'],
    ['PIX (Mercado Pago)', o.paymentsReady ? `<span class="badge ok">${esc(o.provider)}</span>` : '<span class="badge bad">falta MP_ACCESS_TOKEN</span>'],
    ['Webhook', `<code>${esc(location.origin)}/webhooks/mercadopago</code>`],
  ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}
$('#btnAddPlan').addEventListener('click', () => $('#plansTable tbody').insertAdjacentHTML('beforeend', planRow()));
$('#plansTable').addEventListener('click', (e) => { const b = e.target.closest('[data-remove]'); if (b) b.closest('tr').remove(); });
$('#btnResetPlans').addEventListener('click', async () => {
  if (!confirmAction('Restaurar os planos padrão (2K, 7 dias, 30 dias)?')) return;
  try { await api('/admin/api/settings/reset-plans', { method: 'POST', body: {} }); await loadSettings(); toast('Planos restaurados.'); } catch (err) { fail(err); }
});
$('#formSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plans = $$('#plansTable tbody tr').map((tr) => {
    const f = (n) => tr.querySelector(`[data-f="${n}"]`);
    return { active: f('active').checked, id: f('id').value, name: f('name').value, days: Number(f('days').value), priceCents: Math.round(Number(f('price').value) * 100), tag: f('tag').value, description: f('description').value };
  });
  const body = { siteName: $('#sSiteName').value, whatsapp: $('#sWhatsapp').value, tagline: $('#sTagline').value, notice: $('#sNotice').value, plans };
  $('#settingsError').hidden = true;
  busy(e.submitter, true, 'Salvando…');
  try {
    await api('/admin/api/settings', { method: 'PUT', body });
    toast('Configurações salvas.');
    await loadSettings();
  } catch (err) {
    $('#settingsError').textContent = err.message;
    $('#settingsError').hidden = false;
  } finally { busy(e.submitter, false); }
});

boot().catch(fail);
