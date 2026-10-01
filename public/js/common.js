// Utilidades compartilhadas (loja, pedido e admin)
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
export const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (n) => Number(n || 0).toLocaleString('pt-BR');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
export const when = (iso) => (iso ? fmtDate.format(new Date(iso)) : '—');
export const day = (iso) => (iso ? fmtDay.format(new Date(iso)) : '—');

export const STATUS = {
  pending: { label: 'Aguardando PIX', cls: 'warn' },
  paid: { label: 'Pago', cls: 'ok' },
  delivering: { label: 'Enviando', cls: 'info' },
  completed: { label: 'Concluído', cls: 'ok' },
  expired: { label: 'Expirado', cls: 'muted' },
  cancelled: { label: 'Cancelado', cls: 'muted' },
  failed: { label: 'Falhou', cls: 'bad' },
  queued: { label: 'Na fila', cls: 'info' },
  sent: { label: 'Enviado', cls: 'ok' },
};
export const badge = (s) => { const m = STATUS[s] || { label: s, cls: 'muted' }; return `<span class="badge ${m.cls}">${esc(m.label)}</span>`; };

let toastTimer;
export function toast(msg, kind = 'ok') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); return true; } catch { return false; } finally { ta.remove(); }
  }
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label || 'Aguarde…'}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
