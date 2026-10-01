import { api, $, $$, num, esc, when, badge, toast, busy } from './common.js';

const state = { tab: 'overview', settings: null, allServers: [] };
const SEND_STATUS = { ok: ['Com likes', 'ok'], nochange: ['Sem alteração', 'warn'], error: ['Falhou', 'bad'], pending: ['Em andamento', 'info'] };
const sbadge = (s) => { const [l, c] = SEND_STATUS[s] || [s, 'muted']; return `<span class="badge ${c}">${l}</span>`; };

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
const loaders = { overview: loadOverview, sends: loadSends, send: loadSendTab, settings: loadSettings };
function openTab(name) {
  state.tab = name;
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => { t.hidden = t.dataset.tab !== name; });
  Promise.resolve(loaders[name]()).catch(fail);
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
function fail(err) { if (err.status === 401) showLogin(); else toast(err.message, 'bad'); }

async function ensureSettings() {
  if (!state.settings) { const r = await api('/admin/api/settings'); state.settings = r.settings; state.allServers = r.allServers; }
  return state.settings;
}
const serverOptions = (codes, selected) => codes.map((c) => { const s = state.allServers.find((x) => x.code === c) || { code: c, label: c }; return `<option value="${c}" ${c === selected ? 'selected' : ''}>${esc(s.label)} (${c})</option>`; }).join('');

// ---------- visão geral ----------
async function loadOverview(refresh = false) {
  const o = await api(`/admin/api/overview${refresh ? '?refresh=1' : ''}`);
  $('#modeTag').textContent = o.mock ? 'MODO SIMULADO' : o.apiUrl;
  const alerts = [];
  if (o.mock) alerts.push(['warn', 'Modo simulado ativo (MOCK=1): nenhum like real é enviado.']);
  if (o.apiError) alerts.push(['bad', `API de likes fora do ar: ${o.apiError}`]);
  if (!o.publicSend) alerts.push(['warn', 'Envio pelo site desativado: visitantes só consultam.']);
  if (o.api && o.api.remains <= 5) alerts.push(['warn', `Limite diário da API quase no fim (${o.api.remains} restantes).`]);
  $('#alerts').innerHTML = alerts.map(([k, t]) => `<div class="alert ${k}">${esc(t)}</div>`).join('');
  $('#tiles').innerHTML = [
    ['Likes enviados hoje', `+${num(o.today.likes)}`, `${o.today.ok} de ${o.today.count} envio(s) com likes`],
    ['Likes enviados (total)', `+${num(o.total.likes)}`, `${num(o.total.count)} envio(s)`],
    ['IDs atendidos', num(o.total.uids), 'perfis que receberam likes'],
    ['Falhas', num(o.counts.error || 0), `${num(o.counts.nochange || 0)} sem alteração`],
    ['Limite da API hoje', o.api ? `${o.api.remains}/${o.api.keyLimit}` : '—', 'envios restantes'],
  ].map(([l, v, s]) => `<div class="tile glass"><span>${l}</span><strong>${v}</strong>${s ? `<small>${esc(s)}</small>` : ''}</div>`).join('');
  const max = Math.max(1, ...o.days.map((d) => d.likes));
  $('#bars').innerHTML = o.days.map((d) => `<div title="${d.day}: +${num(d.likes)} likes (${d.count} envios)"><i style="height:${Math.round((d.likes / max) * 100)}%"></i><b>${d.day.slice(8)}/${d.day.slice(5, 7)}</b></div>`).join('');
  const a = o.api;
  $('#apiStatus').innerHTML = a ? [
    ['Situação', '<span class="badge ok">online</span>'],
    ['No ar há', `${Math.floor(a.uptime / 3600)}h ${Math.floor((a.uptime % 3600) / 60)}min`],
    ['Tokens em cache', num(a.cachedTokens)],
    ['Envios restantes hoje', `${a.remains} / ${a.keyLimit}`],
  ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('') : `<div><span>Situação</span><strong><span class="badge bad">offline</span></strong></div><p class="muted small">${esc(o.apiError || '')}</p>`;
  $('#regionsTable tbody').innerHTML = a ? Object.entries(a.regions).map(([code, r]) => {
    const pct = r.accounts ? Math.round((r.valid / r.accounts) * 100) : 0;
    const health = !r.accounts ? '<span class="badge muted">sem contas</span>' : pct >= 70 ? `<span class="badge ok">${pct}%</span>` : pct > 0 ? `<span class="badge warn">${pct}%</span>` : '<span class="badge bad">0%</span>';
    return `<tr><td><b>${code}</b></td><td>${num(r.accounts)}</td><td>${num(r.valid)}</td><td>${health}</td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty">API indisponível.</td></tr>';
}
$('#btnRefresh').addEventListener('click', () => loadOverview(true).catch(fail));
$('#btnResetLimit').addEventListener('click', async () => {
  if (!window.confirm('Zerar o contador diário de envios da API para este servidor?')) return;
  try { await api('/admin/api/reset-limit', { method: 'POST', body: {} }); toast('Limite zerado.'); await loadOverview(true); } catch (err) { fail(err); }
});

// ---------- envios ----------
async function loadSends() {
  const status = $('#sendStatus').value;
  const q = $('#sendSearch').value.trim();
  const { sends, total } = await api(`/admin/api/sends?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  const tb = $('#sendsTable tbody');
  if (!sends.length) { tb.innerHTML = `<tr><td colspan="9" class="empty">Nenhum envio.</td></tr>`; return; }
  tb.innerHTML = sends.map((s) => `<tr>
      <td>${s.id}</td>
      <td>${s.uid}<br><span class="muted small">${esc(s.nickname || '')}</span></td>
      <td>${esc(s.server)}</td>
      <td>${s.before != null ? `${num(s.before)} → ${num(s.after)}` : '—'}</td>
      <td><b>${s.given ? `+${num(s.given)}` : '0'}</b>${s.tokensUsed ? `<br><span class="muted small">${num(s.tokensUsed)} contas</span>` : ''}</td>
      <td>${sbadge(s.status)}</td>
      <td>${s.by === 'admin' ? 'painel' : 'site'}</td>
      <td>${when(s.at)}${s.elapsed ? `<br><span class="muted small">${s.elapsed.toFixed(1)}s</span>` : ''}</td>
      <td class="wrap-text">${esc(s.error || '')}</td></tr>`).join('') + (total > sends.length ? `<tr><td colspan="9" class="empty">Mostrando ${sends.length} de ${total}. Use a busca para refinar.</td></tr>` : '');
}
$('#sendStatus').addEventListener('change', () => loadSends().catch(fail));
let searchTimer;
$('#sendSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadSends().catch(fail), 300); });

// ---------- envio manual ----------
async function loadSendTab() {
  const s = await ensureSettings();
  if (!$('#sendServer').options.length) $('#sendServer').innerHTML = serverOptions(s.servers, s.defaultServer);
}
$('#btnSendCheck').addEventListener('click', async () => {
  const uid = $('#sendUid').value.replace(/\D/g, '');
  const box = $('#sendPlayer');
  busy($('#btnSendCheck'), true, '…');
  try {
    const { player, receivedToday, totalGiven } = await api(`/admin/api/player?uid=${uid}&server=${$('#sendServer').value}`);
    box.innerHTML = `<div class="info"><strong>${esc(player.nickname)}</strong><span class="muted">ID ${player.uid}${player.level ? ` · Nível ${player.level}` : ''} · ${num(player.likes)} likes · +${num(totalGiven)} pelo site${receivedToday ? ' · já recebeu hoje' : ''}</span></div>`;
    box.hidden = false;
  } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; box.hidden = false; }
  finally { busy($('#btnSendCheck'), false); }
});
$('#formSend').addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = $('#sendUid').value.replace(/\D/g, '');
  const server = $('#sendServer').value;
  if (!window.confirm(`Enviar likes para o ID ${uid} (${server})?`)) return;
  busy($('#btnSend'), true, 'Enviando…');
  $('#sendResult').innerHTML = '';
  try {
    const { send } = await api('/admin/api/send', { method: 'POST', body: { uid, server } });
    $('#sendResult').innerHTML = send.status === 'ok'
      ? `<div class="alert" style="margin-top:14px;border-color:rgba(48,212,127,.4);background:rgba(48,212,127,.1);color:var(--ok)">+${num(send.given)} likes para ${esc(send.nickname || uid)} · ${num(send.before)} → ${num(send.after)} · ${num(send.tokensUsed)} contas em ${send.elapsed.toFixed(1)}s${send.remains != null ? ` · restam ${send.remains} envios hoje` : ''}</div>`
      : `<div class="alert" style="margin-top:14px">${esc(send.error || 'Sem alteração nos likes.')} (${num(send.before)} → ${num(send.after)})</div>`;
  } catch (err) {
    $('#sendResult').innerHTML = `<div class="alert bad" style="margin-top:14px">${esc(err.message)}</div>`;
  } finally { busy($('#btnSend'), false); }
});

// ---------- configurações ----------
async function loadSettings() {
  state.settings = null;
  const s = await ensureSettings();
  $('#sSiteName').value = s.siteName;
  $('#sWhatsapp').value = s.whatsapp || '';
  $('#sTagline').value = s.tagline || '';
  $('#sNotice').value = s.notice || '';
  $('#sPublicSend').checked = Boolean(s.publicSend);
  $('#sDefaultServer').innerHTML = serverOptions(state.allServers.map((x) => x.code), s.defaultServer);
  $('#sServers').innerHTML = state.allServers.map((x) => `<label class="opt"><input type="checkbox" value="${x.code}" ${s.servers.includes(x.code) ? 'checked' : ''}> <span>${esc(x.label)} (${x.code})</span></label>`).join('');
  const o = await api('/admin/api/overview');
  $('#integrations').innerHTML = [
    ['API de likes', o.mock ? '<span class="badge warn">simulada</span>' : o.api ? '<span class="badge ok">online</span>' : '<span class="badge bad">offline</span>'],
    ['Endereço', `<code>${esc(o.apiUrl)}</code>`],
    ['Envio pelo site', o.publicSend ? '<span class="badge ok">ativo</span>' : '<span class="badge muted">desativado</span>'],
  ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}
$('#formSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    siteName: $('#sSiteName').value, whatsapp: $('#sWhatsapp').value, tagline: $('#sTagline').value, notice: $('#sNotice').value,
    publicSend: $('#sPublicSend').checked, defaultServer: $('#sDefaultServer').value, servers: $$('#sServers input:checked').map((i) => i.value),
  };
  $('#settingsError').hidden = true;
  busy(e.submitter, true, 'Salvando…');
  try {
    await api('/admin/api/settings', { method: 'PUT', body });
    toast('Configurações salvas.');
    $('#sendServer').innerHTML = '';
    await loadSettings();
  } catch (err) {
    $('#settingsError').textContent = err.message;
    $('#settingsError').hidden = false;
  } finally { busy(e.submitter, false); }
});

boot().catch(fail);
