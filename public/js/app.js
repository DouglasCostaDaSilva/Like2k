import { $, $$, api, brl, int, esc, dt, toCents, moneyMask, status, toast, alertBox, copy, busy, LOGO } from '/js/common.js';

const state = { me: null, mock: false, limits: null };
let current = null;
const LOADERS = {};

// ------------------------------------------------------------------ navegação
const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  home: icon('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
  charges: icon('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M14 21h7v-4"/>'),
  withdrawals: icon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
  integration: icon('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'),
  account: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  merchants: icon('<path d="M3 9h18l-1.5-5h-15z"/><path d="M5 9v11h14V9M9 20v-6h6v6"/>'),
};
const MENUS = {
  merchant: [['home', 'Início', I.home], ['charges', 'Cobranças', I.charges], ['withdrawals', 'Saques', I.withdrawals], ['integration', 'Integração', I.integration], ['account', 'Conta', I.account]],
  admin: [['admin-home', 'Visão geral', I.home], ['admin-merchants', 'Lojistas', I.merchants], ['admin-charges', 'Cobranças', I.charges], ['admin-withdrawals', 'Saques', I.withdrawals]],
};

function renderNav() {
  $('#nav').innerHTML = MENUS[state.me.role].map(([id, label, ic]) => `<button data-go="${id}">${ic}<span>${label}</span><span class="badge hidden" data-badge="${id}"></span></button>`).join('');
}
function setBadge(id, n) { const b = $(`[data-badge="${id}"]`); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } }

function go(view) {
  const allowed = MENUS[state.me.role].map(([id]) => id);
  if (!allowed.includes(view)) view = allowed[0];
  current = view;
  $$('.view').forEach((v) => v.classList.toggle('on', v.dataset.view === view));
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  $('#sidebar').classList.remove('open');
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  scrollTo(0, 0);
  LOADERS[view]?.().catch((err) => toast(err.message, 'error'));
}

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  if (e.target.closest('[data-new-charge]')) { newCharge(); return; }
  const side = $('#sidebar');
  if (side.classList.contains('open') && !side.contains(e.target) && !e.target.closest('#menuBtn')) side.classList.remove('open');
});
$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/entrar'; });
addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== current) go(v); });

// ------------------------------------------------------------------ modal
function openModal({ title, body, foot = '' }) {
  $('#mTitle').textContent = title;
  $('#mBody').innerHTML = body;
  $('#mFoot').innerHTML = foot;
  $('#mFoot').classList.toggle('hidden', !foot);
  $('#modal').classList.add('show');
  setTimeout(() => $('#mBody input:not([disabled])')?.focus(), 50);
}
const closeModal = () => { $('#modal').classList.remove('show'); clearInterval(modalPoll); };
$('#mClose').addEventListener('click', closeModal);
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
let modalPoll = null;

function confirmModal({ title, text, okText = 'Confirmar', danger = false, input = null }) {
  return new Promise((resolve) => {
    openModal({
      title,
      body: `<p style="color:var(--text-2);font-size:14px">${text}</p>${input ? `<div class="field"><label for="cfIn">${input.label}</label><input class="input" id="cfIn" placeholder="${esc(input.placeholder || '')}" value="${esc(input.value || '')}" /></div>` : ''}<div class="alert" id="cfMsg"></div>`,
      foot: `<button class="btn" id="cfNo">Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfYes">${okText}</button>`,
    });
    $('#cfNo').onclick = () => { closeModal(); resolve(null); };
    $('#cfYes').onclick = () => resolve({ value: $('#cfIn')?.value ?? true, done: closeModal, fail: (m) => alertBox($('#cfMsg'), m), btn: $('#cfYes') });
  });
}

// ------------------------------------------------------------------ gráfico (uma série, barras finas, tooltip por barra)
const charts = new Map();
const ro = new ResizeObserver((entries) => { for (const e of entries) { const c = charts.get(e.target); if (c && Math.abs(c.w - e.contentRect.width) > 4) barChart(e.target, c.days, c.opts); } });
function barChart(el, days, opts = {}) {
  const { label = 'Recebido' } = opts;
  // desenha na largura real do cartão: texto sempre em tamanho legível
  const W = Math.max(280, Math.round(el.clientWidth - 2)), H = W < 500 ? 200 : 230, padL = 56, padB = 26, padT = 12;
  charts.set(el, { w: el.clientWidth, days, opts });
  ro.observe(el);
  const every = W < 500 ? 3 : 2;
  const max = Math.max(...days.map((d) => d.amount), 0);
  const nice = (v) => { if (!v) return 10000; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const top = nice(max);
  const step = (W - padL) / days.length;
  const bw = Math.min(26, step * 0.56);
  const y = (v) => H - padB - ((H - padB - padT) * v) / top;
  const ticks = [0, top / 2, top];
  const short = (c) => (c >= 100000 ? `R$ ${int(Math.round(c / 100000))} mil` : brl(c).replace(',00', ''));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} por dia, últimos ${days.length} dias">`;
  for (const t of ticks) svg += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`;
  days.forEach((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const h = Math.max(d.amount ? 3 : 2, H - padB - y(d.amount));
    const yy = H - padB - h;
    const r = Math.min(4, bw / 2);
    // barra com topo arredondado (4px) ancorada na base
    const path = `M${x},${H - padB} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${H - padB} Z`;
    svg += `<rect class="hit" x="${padL + i * step}" y="${padT}" width="${step}" height="${H - padB - padT}" data-i="${i}"/><path class="bar ${d.amount ? '' : 'zero'}" d="${path}" data-b="${i}"/>`;
    if ((days.length - 1 - i) % every === 0) svg += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${d.day.slice(8)}/${d.day.slice(5, 7)}</text>`;
  });
  svg += '</svg>';
  el.innerHTML = `${svg}<div class="tip hidden"></div>`;
  const tip = el.querySelector('.tip');
  const svgEl = el.querySelector('svg');
  const show = (i) => {
    const d = days[i];
    const box = svgEl.getBoundingClientRect(), host = el.getBoundingClientRect();
    const sx = box.width / W, sy = box.height / H;
    const x = (padL + i * step + step / 2) * sx + (box.left - host.left);
    const yy = y(d.amount) * sy + (box.top - host.top) - 8;
    const date = new Date(`${d.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
    tip.innerHTML = `<b>${brl(d.amount)}</b><span>${date}${d.count != null ? ` · ${int(d.count)} PIX` : ''}${d.fees != null ? ` · taxas ${brl(d.fees)}` : ''}</span>`;
    tip.style.left = `${Math.min(Math.max(x, 70), host.width - 70)}px`;
    tip.style.top = `${yy}px`;
    tip.classList.remove('hidden');
    el.querySelectorAll('.bar').forEach((b) => b.classList.toggle('hl', b.dataset.b === String(i)));
  };
  el.querySelectorAll('.hit').forEach((h) => {
    h.addEventListener('mouseenter', () => show(Number(h.dataset.i)));
    h.addEventListener('click', () => show(Number(h.dataset.i)));
  });
  svgEl.addEventListener('mouseleave', () => { tip.classList.add('hidden'); el.querySelectorAll('.bar').forEach((b) => b.classList.remove('hl')); });
}

// ------------------------------------------------------------------ lojista: linhas de cobrança
const chargeRow = (c) => `<div class="row click cols-charge" data-charge="${esc(c.id)}">
  <div class="t"><strong>${esc(c.description || 'Cobrança PIX')}</strong><span>${dt(c.created_at)} · <span class="mono">${esc(c.external_id || c.id)}</span></span></div>
  <div class="t hide-sm"><strong>${esc(c.payer?.name || '—')}</strong><span>${esc(c.payer?.email || '')}</span></div>
  <div class="amt" style="order:3">${brl(c.amount)}<small>líquido ${brl(c.net_amount)}</small></div>
  <div style="order:2">${status(c.status)}</div>
</div>`;
document.addEventListener('click', (e) => { const r = e.target.closest('[data-charge]'); if (r) openCharge(r.dataset.charge); });

LOADERS.home = async () => {
  const o = await api('/api/merchant/overview');
  const u = state.me;
  $('#hello').textContent = `Olá, ${u.name.split(' ')[0]}`;
  $('#hBalance').textContent = brl(o.balance.available);
  $('#hBalanceSub').textContent = o.balance.pendingWithdrawals ? `${brl(o.balance.pendingWithdrawals)} em saques em análise` : 'pronto para sacar';
  $('#hToday').textContent = brl(o.today.amount);
  $('#hTodayCount').textContent = `${int(o.today.count)} ${o.today.count === 1 ? 'PIX pago' : 'PIX pagos'}`;
  $('#hGross').textContent = brl(o.balance.gross);
  $('#hConv').textContent = o.conversion == null ? '—' : `${o.conversion}%`;
  $('#hFee').textContent = `${String(u.feePercent).replace('.', ',')}%`;
  $('#hFeeMin').textContent = `mínimo de ${brl(u.feeMinCents)} por PIX`;
  const sum = o.days.reduce((a, d) => a + d.amount, 0);
  const n = o.days.reduce((a, d) => a + d.count, 0);
  $('#hChartSub').textContent = `${brl(sum)} em ${int(n)} ${n === 1 ? 'PIX pago' : 'PIX pagos'}`;
  barChart($('#hChart'), o.days);
  $('#hRecent').innerHTML = o.recent.length ? o.recent.map((c) => `<div class="row click" style="grid-template-columns:minmax(0,1fr) auto" data-charge="${esc(c.id)}">
      <div class="t"><strong>${esc(c.description || 'Cobrança PIX')}</strong><span>${dt(c.created_at)}</span></div>
      <div class="amt">${brl(c.amount)}<small>${status(c.status)}</small></div></div>`).join('')
    : '<div class="empty"><b>Nenhuma cobrança ainda</b>Crie a primeira e mande o link para o seu cliente.</div>';
  setBadge('charges', o.pending);
};

let cStatus = '', cTimer = null;
LOADERS.charges = async () => {
  const qs = new URLSearchParams({ status: cStatus, q: $('#cSearch').value, days: $('#cDays').value });
  const { charges, total } = await api(`/api/merchant/charges?${qs}`);
  $('#cSub').textContent = `${int(charges.length)} ${charges.length === 1 ? 'cobrança' : 'cobranças'} · ${brl(total)} recebidos no período`;
  $('#cList').innerHTML = charges.length ? charges.map(chargeRow).join('') : '<div class="empty"><b>Nada por aqui</b>Nenhuma cobrança com esses filtros.</div>';
};
$('#cStatus').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; cStatus = b.dataset.s; $$('#cStatus button').forEach((x) => x.classList.toggle('on', x === b)); LOADERS.charges(); });
$('#cSearch').addEventListener('input', () => { clearTimeout(cTimer); cTimer = setTimeout(() => LOADERS.charges(), 300); });
$('#cDays').addEventListener('change', () => LOADERS.charges());

// ------------------------------------------------------------------ nova cobrança
function newCharge() {
  openModal({
    title: 'Nova cobrança PIX',
    body: `<form class="form" id="ncForm">
      <div class="field"><label for="ncAmount">Valor</label><div class="input-money"><span>R$</span><input class="input num" id="ncAmount" inputmode="numeric" placeholder="0,00" required /></div></div>
      <div class="field"><label for="ncDesc">Descrição</label><input class="input" id="ncDesc" maxlength="140" placeholder="Ex.: Pedido #1024" /></div>
      <div class="two"><div class="field"><label for="ncName">Nome do cliente <span class="muted">(opcional)</span></label><input class="input" id="ncName" /></div>
      <div class="field"><label for="ncEmail">E-mail do cliente <span class="muted">(opcional)</span></label><input class="input" id="ncEmail" type="email" /></div></div>
      <div class="field"><label>Validade do PIX</label><div class="chips" id="ncExp"><button type="button" class="chip" data-e="900">15 min</button><button type="button" class="chip on" data-e="1800">30 min</button><button type="button" class="chip" data-e="3600">1 hora</button><button type="button" class="chip" data-e="86400">24 horas</button></div></div>
      <div class="kv" id="ncSum"></div>
      <div class="alert" id="ncMsg"></div>
    </form>`,
    foot: '<button class="btn" id="ncCancel">Cancelar</button><button class="btn btn-primary" id="ncGo">Gerar PIX</button>',
  });
  let exp = 1800;
  const amount = $('#ncAmount');
  moneyMask(amount);
  const sum = () => {
    const v = toCents(amount.value) || 0;
    const fee = v ? Math.min(v, Math.max(state.me.feeMinCents, Math.round((v * state.me.feePercent) / 100))) : 0;
    $('#ncSum').innerHTML = `<div><span>Cliente paga</span><b>${brl(v)}</b></div><div><span>Taxa Zyropay</span><b>− ${brl(fee)}</b></div><div class="total"><span>Você recebe</span><b>${brl(v - fee)}</b></div>`;
  };
  amount.addEventListener('input', sum);
  sum();
  $('#ncExp').addEventListener('click', (e) => { const c = e.target.closest('[data-e]'); if (!c) return; exp = Number(c.dataset.e); $$('#ncExp .chip').forEach((x) => x.classList.toggle('on', x === c)); });
  $('#ncCancel').onclick = closeModal;
  const submit = async () => {
    const btn = $('#ncGo');
    const v = toCents(amount.value);
    if (!(v >= state.limits.minCharge)) { alertBox($('#ncMsg'), `O valor mínimo é ${brl(state.limits.minCharge)}.`); return; }
    busy(btn, true, ' Gerando…');
    try {
      const r = await api('/api/merchant/charges', { method: 'POST', body: { amount: v, description: $('#ncDesc').value, expires_in: exp, payer: { name: $('#ncName').value || undefined, email: $('#ncEmail').value || undefined } } });
      showCharge(r.charge, r.qrImage, true);
      toast('PIX gerado!');
      if (current === 'charges' || current === 'home') LOADERS[current]();
    } catch (err) { alertBox($('#ncMsg'), err.message); busy(btn, false); }
  };
  $('#ncGo').onclick = submit;
  $('#ncForm').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}

// ------------------------------------------------------------------ detalhe da cobrança
async function openCharge(id) {
  openModal({ title: 'Cobrança', body: '<div class="empty"><i class="spinner" style="margin:0 auto"></i></div>' });
  try {
    const r = await api(`/api/merchant/charges/${encodeURIComponent(id)}`);
    showCharge(r.charge, r.qrImage, false, r.webhooks);
  } catch (err) { $('#mBody').innerHTML = `<div class="alert error show">${esc(err.message)}</div>`; }
}

function showCharge(c, qrImage, fresh, webhooks = []) {
  clearInterval(modalPoll);
  const pending = c.status === 'pending';
  openModal({
    title: fresh ? 'PIX gerado' : 'Cobrança',
    body: `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div><div style="font-family:var(--display);font-size:30px;font-weight:700" class="num">${brl(c.amount)}</div><div class="muted" style="font-size:14px">${esc(c.description || 'Cobrança PIX')}</div></div>${status(c.status)}
      </div>
      ${pending && qrImage ? `<div class="qr-box"><img src="${qrImage}" alt="QR Code PIX" /></div>` : ''}
      ${pending ? `<div class="field"><label>PIX copia e cola</label><div class="secret"><code>${esc(c.pix.copy_paste)}</code><button class="btn btn-sm" data-copy="${esc(c.pix.copy_paste)}">Copiar</button></div></div>
      <div class="field"><label>Link de pagamento</label><div class="secret"><code>${esc(c.checkout_url)}</code><button class="btn btn-sm" data-copy="${esc(c.checkout_url)}">Copiar</button></div><span class="hint">Mande este link para o cliente: ele mostra o QR e confirma o pagamento sozinho.</span></div>` : ''}
      <div class="kv">
        <div><span>Taxa</span><b>− ${brl(c.fee)}</b></div>
        <div><span>Você recebe</span><b>${brl(c.net_amount)}</b></div>
        <div><span>Criada em</span><b>${dt(c.created_at)}</b></div>
        <div><span>${c.paid_at ? 'Paga em' : 'Expira em'}</span><b>${dt(c.paid_at || c.expires_at)}</b></div>
        ${c.payer?.name || c.payer?.email ? `<div><span>Pagador</span><b>${esc([c.payer.name, c.payer.email].filter(Boolean).join(' · '))}</b></div>` : ''}
        ${c.external_id ? `<div><span>ID externo</span><b class="mono">${esc(c.external_id)}</b></div>` : ''}
        <div><span>ID</span><b class="mono">${esc(c.id)}</b></div>
      </div>
      ${webhooks.length ? `<div class="kv">${webhooks.map((w) => `<div><span class="mono">${esc(w.event)}</span><b>${status(w.status)}</b></div>`).join('')}</div>` : ''}`,
    foot: [
      pending && state.mock ? '<button class="btn" id="cdSim">Simular pagamento</button>' : '',
      pending ? '<button class="btn btn-danger" id="cdCancel">Cancelar cobrança</button>' : '',
      pending ? `<a class="btn btn-primary" href="${esc(c.checkout_url)}" target="_blank" rel="noopener">Abrir checkout</a>` : '<button class="btn" id="cdClose">Fechar</button>',
    ].join(''),
  });
  $$('#mBody [data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy)));
  $('#cdClose')?.addEventListener('click', closeModal);
  $('#cdSim')?.addEventListener('click', async () => { const r = await api(`/api/merchant/charges/${c.id}/simulate`, { method: 'POST' }); toast('Pagamento simulado.'); showCharge(r.charge, null, false); LOADERS[current]?.(); });
  $('#cdCancel')?.addEventListener('click', async () => {
    try { const r = await api(`/api/merchant/charges/${c.id}/cancel`, { method: 'POST' }); toast('Cobrança cancelada.'); showCharge(r.charge, null, false); LOADERS[current]?.(); } catch (err) { toast(err.message, 'error'); }
  });
  // enquanto estiver aberta e pendente, confere se foi paga
  if (pending) {
    modalPoll = setInterval(async () => {
      if (!$('#modal').classList.contains('show')) return clearInterval(modalPoll);
      const r = await api(`/api/merchant/charges/${c.id}`).catch(() => null);
      if (r && r.charge.status !== 'pending') { toast(r.charge.status === 'paid' ? `PIX de ${brl(r.charge.amount)} recebido!` : 'A cobrança mudou de status.'); showCharge(r.charge, null, false, r.webhooks); LOADERS[current]?.(); }
    }, 4000);
  }
}

// ------------------------------------------------------------------ saques
moneyMask($('#wAmount'));
let wAvailable = 0;
LOADERS.withdrawals = async () => {
  const { withdrawals, balance } = await api('/api/merchant/withdrawals');
  wAvailable = balance.available;
  $('#wAvail').textContent = brl(balance.available);
  $('#wPending').textContent = brl(balance.pendingWithdrawals);
  if (!$('#wKey').value) $('#wKey').value = state.me.pixKey || '';
  $('#wList').innerHTML = withdrawals.length ? withdrawals.map((w) => `<div class="row cols-wd">
      <div class="t"><strong>${esc(w.pixKey)}</strong><span>${w.note ? esc(w.note) : `Saque #${w.id}`}</span></div>
      <div class="t hide-sm"><strong>${dt(w.createdAt)}</strong><span>${w.closedAt ? `finalizado ${dt(w.closedAt)}` : ''}</span></div>
      <div class="amt" style="order:3">${brl(w.amount)}</div><div style="order:2">${status(w.status)}</div></div>`).join('')
    : '<div class="empty"><b>Nenhum saque ainda</b>Quando tiver saldo, peça o saque ao lado.</div>';
};
$('#wAll').addEventListener('click', () => { $('#wAmount').value = (wAvailable / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); });
$('#wForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter || $('#wForm button[type=submit]');
  busy(btn, true, ' Enviando…');
  try {
    await api('/api/merchant/withdrawals', { method: 'POST', body: { amount: toCents($('#wAmount').value), pixKey: $('#wKey').value } });
    alertBox($('#wMsg'), 'Saque solicitado! Você será avisado quando for pago.', 'ok');
    $('#wAmount').value = '';
    LOADERS.withdrawals();
  } catch (err) { alertBox($('#wMsg'), err.message); } finally { busy(btn, false); }
});

// ------------------------------------------------------------------ integração
let secretShown = false;
LOADERS.integration = async () => {
  const u = state.me;
  $('#iKey').textContent = u.apiKeyPrefix || 'Nenhuma chave gerada';
  $('#iKeyNew').textContent = u.apiKeyPrefix ? 'Gerar nova chave' : 'Gerar chave';
  $('#iKeyCopy').classList.add('hidden');
  alertBox($('#iKeyNote'));
  $('#iUrl').value = u.webhookUrl || '';
  secretShown = false;
  $('#iSecret').textContent = 'whsec_••••••••••••••••';
  $('#iSecretShow').textContent = 'Mostrar';
  loadHooks();
};
async function loadHooks() {
  const { deliveries } = await api('/api/merchant/deliveries');
  $('#iHooks').innerHTML = deliveries.length ? deliveries.map((d) => `<div class="row cols-hook">
    <div class="t"><strong class="mono">${esc(d.event)}</strong><span class="mono">${esc(d.ref || '')}</span></div>
    <div class="t hide-sm"><strong>${dt(d.at)}</strong><span>${int(d.attempts)} ${d.attempts === 1 ? 'tentativa' : 'tentativas'}</span></div>
    <div class="amt" style="order:3"><span class="mono" style="font-weight:600">${d.lastCode ? `HTTP ${d.lastCode}` : esc(d.lastError || '—')}</span></div>
    <div style="order:2">${status(d.status === 'delivered' ? 'delivered' : d.status === 'failed' ? 'failed' : 'pending')}</div></div>`).join('')
    : '<div class="empty"><b>Nenhum aviso enviado ainda</b>Cadastre a URL do webhook e clique em “Enviar teste”.</div>';
}
$('#iReload').addEventListener('click', loadHooks);
$('#iKeyNew').addEventListener('click', async () => {
  if (state.me.apiKeyPrefix) {
    const ok = await confirmModal({ title: 'Gerar nova chave', text: 'A chave atual para de funcionar na hora. Atualize seu sistema com a nova chave.', okText: 'Gerar nova', danger: true });
    if (!ok) return;
    ok.done();
  }
  const r = await api('/api/merchant/apikey', { method: 'POST' });
  state.me.apiKeyPrefix = r.prefix;
  $('#iKey').textContent = r.apiKey;
  $('#iKeyCopy').classList.remove('hidden');
  $('#iKeyCopy').onclick = () => copy(r.apiKey, 'Chave copiada');
  $('#iKeyNew').textContent = 'Gerar nova chave';
  alertBox($('#iKeyNote'), 'Copie e guarde esta chave agora. Ela não será mostrada de novo.', 'info');
});
$('#iSecretShow').addEventListener('click', async () => {
  if (secretShown) { secretShown = false; $('#iSecret').textContent = 'whsec_••••••••••••••••'; $('#iSecretShow').textContent = 'Mostrar'; return; }
  const { secret } = await api('/api/merchant/webhook-secret');
  secretShown = true;
  $('#iSecret').textContent = secret;
  $('#iSecretShow').textContent = 'Ocultar';
});
$('#iRotate').addEventListener('click', async () => {
  const ok = await confirmModal({ title: 'Trocar segredo do webhook', text: 'Os próximos avisos serão assinados com o novo segredo. Atualize a validação no seu sistema.', okText: 'Trocar segredo', danger: true });
  if (!ok) return;
  ok.done();
  const { secret } = await api('/api/merchant/webhook-secret', { method: 'POST' });
  secretShown = true;
  $('#iSecret').textContent = secret;
  $('#iSecretShow').textContent = 'Ocultar';
  toast('Segredo trocado.');
});
$('#hookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/merchant/settings', { method: 'PUT', body: { webhookUrl: $('#iUrl').value } });
    state.me = r.user;
    alertBox($('#iMsg'), 'Webhook salvo.', 'ok');
  } catch (err) { alertBox($('#iMsg'), err.message); }
});
$('#iTest').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  busy(btn, true, ' Enviando…');
  try {
    const r = await api('/api/merchant/webhook-test', { method: 'POST' });
    alertBox($('#iMsg'), r.ok ? `Teste entregue (HTTP ${r.code}).` : `Seu servidor não confirmou: ${r.error || `HTTP ${r.code}`}. Vamos tentar de novo automaticamente.`, r.ok ? 'ok' : 'error');
    loadHooks();
  } catch (err) { alertBox($('#iMsg'), err.message); } finally { busy(btn, false); }
});

// ------------------------------------------------------------------ conta
LOADERS.account = async () => {
  const u = state.me;
  $('#aName').value = u.name; $('#aEmail').value = u.email; $('#aDoc').value = u.document; $('#aPhone').value = u.phone; $('#aPix').value = u.pixKey;
  $('#aFee').textContent = `${String(u.feePercent).replace('.', ',')}% (mínimo ${brl(u.feeMinCents)})`;
};
$('#accForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/merchant/settings', { method: 'PUT', body: { name: $('#aName').value, phone: $('#aPhone').value, pixKey: $('#aPix').value } });
    state.me = r.user; paintWho();
    alertBox($('#aMsg'), 'Dados salvos.', 'ok');
  } catch (err) { alertBox($('#aMsg'), err.message); }
});
$('#pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/merchant/settings', { method: 'PUT', body: { currentPassword: $('#pCur').value, newPassword: $('#pNew').value } });
    e.target.reset();
    alertBox($('#pMsg'), 'Senha trocada.', 'ok');
  } catch (err) { alertBox($('#pMsg'), err.message); }
});

// ------------------------------------------------------------------ admin
LOADERS['admin-home'] = async () => {
  const o = await api('/api/admin/overview');
  $('#adTpv').textContent = brl(o.tpv);
  $('#adRev').textContent = brl(o.revenue);
  $('#adRevToday').textContent = `${brl(o.today.fees)} hoje em ${int(o.today.count)} PIX`;
  $('#adOwed').textContent = brl(o.owed);
  $('#adMerch').textContent = int(o.merchants.active);
  $('#adMerchSub').textContent = o.merchants.pending ? `${int(o.merchants.pending)} aguardando aprovação` : 'nenhum cadastro em análise';
  $('#adSub').textContent = `Provedor: ${o.provider === 'mercadopago' ? 'Mercado Pago' : 'simulado (testes)'}`;
  $('#adChartSub').textContent = `${brl(o.days.reduce((a, d) => a + d.amount, 0))} processados · ${brl(o.days.reduce((a, d) => a + d.fees, 0))} em taxas`;
  barChart($('#adChart'), o.days, { label: 'Volume' });
  setBadge('admin-merchants', o.merchants.pending);
  setBadge('admin-withdrawals', o.pendingWithdrawals);
};

let mStatus = '', merchants = [];
LOADERS['admin-merchants'] = async () => {
  merchants = (await api('/api/admin/merchants')).merchants;
  setBadge('admin-merchants', merchants.filter((m) => m.status === 'pending').length);
  const list = merchants.filter((m) => !mStatus || m.status === mStatus);
  $('#mList').innerHTML = list.length ? list.map((m) => `<div class="row cols-merch">
    <div class="t"><strong>${esc(m.name)}</strong><span>${esc(m.email)} · <span class="mono">${esc(m.document)}</span>${m.phone ? ` · ${esc(m.phone)}` : ''}</span></div>
    <div>${m.status === 'pending' ? '<span class="status pending">Em análise</span>' : status(m.status)}</div>
    <div class="hide-sm num">${String(m.feePercent).replace('.', ',')}% · mín. ${brl(m.feeMinCents)}</div>
    <div class="amt">${brl(m.balance.available)}<small>${brl(m.balance.gross)} recebidos</small></div>
    <div class="act">${m.status === 'pending'
      ? `<button class="btn btn-sm btn-primary" data-m-approve="${m.id}">Aprovar</button><button class="btn btn-sm btn-danger" data-m-reject="${m.id}">Recusar</button>`
      : `<button class="btn btn-sm" data-m-fee="${m.id}">Taxa</button><button class="btn btn-sm ${m.status === 'active' ? 'btn-danger' : ''}" data-m-toggle="${m.id}">${m.status === 'active' ? 'Bloquear' : 'Reativar'}</button>`}</div>
  </div>`).join('') : '<div class="empty"><b>Nenhum lojista</b>Os cadastros novos aparecem aqui para aprovação.</div>';
};
$('#mStatus').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; mStatus = b.dataset.s; $$('#mStatus button').forEach((x) => x.classList.toggle('on', x === b)); LOADERS['admin-merchants'](); });
$('#mList').addEventListener('click', async (e) => {
  const find = (a) => { const b = e.target.closest(`[${a}]`); return b && merchants.find((m) => m.id === Number(b.getAttribute(a))); };
  let m;
  try {
    if ((m = find('data-m-approve'))) { await api(`/api/admin/merchants/${m.id}`, { method: 'PATCH', body: { status: 'active' } }); toast(`${m.name} aprovado.`); }
    else if ((m = find('data-m-reject'))) {
      const ok = await confirmModal({ title: 'Recusar cadastro', text: `O cadastro de ${esc(m.name)} será apagado.`, okText: 'Recusar', danger: true });
      if (!ok) return; ok.done();
      await api(`/api/admin/merchants/${m.id}`, { method: 'DELETE' }); toast('Cadastro recusado.');
    } else if ((m = find('data-m-toggle'))) {
      await api(`/api/admin/merchants/${m.id}`, { method: 'PATCH', body: { status: m.status === 'active' ? 'blocked' : 'active' } });
      toast(m.status === 'active' ? 'Lojista bloqueado.' : 'Lojista reativado.');
    } else if ((m = find('data-m-fee'))) {
      openModal({
        title: `Taxa de ${m.name}`,
        body: `<div class="two"><div class="field"><label for="fPct">Percentual (%)</label><input class="input num" id="fPct" inputmode="decimal" value="${String(m.feePercent).replace('.', ',')}" /></div>
          <div class="field"><label for="fMin">Mínimo por PIX</label><div class="input-money"><span>R$</span><input class="input num" id="fMin" inputmode="numeric" value="${(m.feeMinCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}" /></div></div></div><div class="alert" id="fMsg"></div>`,
        foot: '<button class="btn" id="fNo">Cancelar</button><button class="btn btn-primary" id="fOk">Salvar</button>',
      });
      moneyMask($('#fMin'));
      $('#fNo').onclick = closeModal;
      $('#fOk').onclick = async () => {
        try {
          await api(`/api/admin/merchants/${m.id}`, { method: 'PATCH', body: { feePercent: Number($('#fPct').value.replace(',', '.')), feeMinCents: toCents($('#fMin').value) || 0 } });
          closeModal(); toast('Taxa atualizada.'); LOADERS['admin-merchants']();
        } catch (err) { alertBox($('#fMsg'), err.message); }
      };
      return;
    } else return;
    LOADERS['admin-merchants']();
  } catch (err) { toast(err.message, 'error'); }
});

let acStatus = '';
LOADERS['admin-charges'] = async () => {
  const { charges } = await api(`/api/admin/charges?status=${acStatus}`);
  $('#acList').innerHTML = charges.length ? charges.map((c) => `<div class="row cols-charge-admin">
    <div class="t"><strong>${esc(c.description || 'Cobrança PIX')}</strong><span>${dt(c.created_at)} · <span class="mono">${esc(c.id)}</span></span></div>
    <div class="t hide-sm"><strong>${esc(c.merchant)}</strong><span>taxa ${brl(c.fee)}</span></div>
    <div class="amt" style="order:3">${brl(c.amount)}</div>
    <div style="order:2">${status(c.status)}</div>
    <div class="act" style="order:4">${c.status === 'paid' ? `<button class="btn btn-sm btn-danger" data-refund="${esc(c.id)}">Devolver</button>` : ''}</div></div>`).join('')
    : '<div class="empty"><b>Nenhuma cobrança</b></div>';
};
$('#acStatus').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; acStatus = b.dataset.s; $$('#acStatus button').forEach((x) => x.classList.toggle('on', x === b)); LOADERS['admin-charges'](); });
$('#acList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-refund]');
  if (!b) return;
  const ok = await confirmModal({ title: 'Devolver pagamento', text: 'O valor volta para quem pagou e sai do saldo do lojista. Não dá para desfazer.', okText: 'Devolver', danger: true });
  if (!ok) return;
  busy(ok.btn, true);
  try { await api(`/api/admin/charges/${b.dataset.refund}/refund`, { method: 'POST' }); ok.done(); toast('Pagamento devolvido.'); LOADERS['admin-charges'](); } catch (err) { ok.fail(err.message); busy(ok.btn, false); }
});

let awStatus = 'pending', wds = [];
LOADERS['admin-withdrawals'] = async () => {
  wds = (await api('/api/admin/withdrawals')).withdrawals;
  setBadge('admin-withdrawals', wds.filter((w) => w.status === 'pending').length);
  const list = wds.filter((w) => !awStatus || w.status === awStatus);
  $('#awList').innerHTML = list.length ? list.map((w) => `<div class="row cols-wd-admin">
    <div class="t"><strong>${esc(w.merchant)}</strong><span>Saque #${w.id} · ${dt(w.createdAt)}</span></div>
    <div class="t hide-sm"><strong class="mono">${esc(w.pixKey)}</strong><span>${w.note ? esc(w.note) : ''}</span></div>
    <div class="amt">${brl(w.amount)}</div>
    <div>${status(w.status)}</div>
    <div class="act">${w.status === 'pending' ? `<button class="btn btn-sm" data-wcopy="${esc(w.pixKey)}">Copiar chave</button><button class="btn btn-sm btn-primary" data-wpaid="${w.id}">Marcar pago</button><button class="btn btn-sm btn-danger" data-wreject="${w.id}">Recusar</button>` : ''}</div></div>`).join('')
    : '<div class="empty"><b>Nenhum saque aqui</b></div>';
};
$('#awStatus').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; awStatus = b.dataset.s; $$('#awStatus button').forEach((x) => x.classList.toggle('on', x === b)); LOADERS['admin-withdrawals'](); });
$('#awList').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-wcopy]');
  if (c) { copy(c.dataset.wcopy, 'Chave PIX copiada'); return; }
  const p = e.target.closest('[data-wpaid]'), r = e.target.closest('[data-wreject]');
  if (!p && !r) return;
  const w = wds.find((x) => x.id === Number((p || r).getAttribute(p ? 'data-wpaid' : 'data-wreject')));
  const ok = await confirmModal(p
    ? { title: `Confirmar saque de ${brl(w.amount)}`, text: `Confirme que você já fez o PIX de ${brl(w.amount)} para a chave <b class="mono">${esc(w.pixKey)}</b>.`, okText: 'Marcar como pago', input: { label: 'Comprovante / ID da transação (opcional)', placeholder: 'E2E…' } }
    : { title: 'Recusar saque', text: 'O valor volta para o saldo do lojista.', okText: 'Recusar saque', danger: true, input: { label: 'Motivo (o lojista verá)', placeholder: 'Chave PIX inválida' } });
  if (!ok) return;
  try { await api(`/api/admin/withdrawals/${w.id}/${p ? 'paid' : 'reject'}`, { method: 'POST', body: { note: ok.value } }); ok.done(); toast(p ? 'Saque marcado como pago.' : 'Saque recusado.'); LOADERS['admin-withdrawals'](); } catch (err) { ok.fail(err.message); }
});

// ------------------------------------------------------------------ início
function paintWho() {
  const u = state.me;
  $('#whoName').textContent = u.name;
  $('#whoRole').textContent = u.role === 'admin' ? 'Administrador' : u.email;
  $('#av').textContent = (u.name || '?')[0].toUpperCase();
}

(async () => {
  $$('[data-logo]').forEach((el) => { el.innerHTML = `${LOGO}Zyropay`; });
  try {
    const r = await api('/api/me');
    Object.assign(state, { me: r.user, mock: r.mock, limits: r.limits });
  } catch { location.href = '/entrar'; return; }
  $('#mockBanner').classList.toggle('hidden', !state.mock);
  paintWho();
  renderNav();
  go(location.hash.slice(1) || MENUS[state.me.role][0][0]);
  if (state.me.role === 'admin') api('/api/admin/overview').then((o) => { setBadge('admin-merchants', o.merchants.pending); setBadge('admin-withdrawals', o.pendingWithdrawals); }).catch(() => {});
})();
addEventListener('unhandledrejection', (e) => { if (e.reason?.status === 401) location.href = '/entrar'; });
