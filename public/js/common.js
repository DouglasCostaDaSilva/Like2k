export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Erro ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const brl = (cents) => ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const int = (n) => Number(n || 0).toLocaleString('pt-BR');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

// "1.234,56" ou "1234.56" -> centavos
export function toCents(text) {
  const s = String(text || '').trim().replace(/[^\d,.]/g, '');
  if (!s) return NaN;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return Math.round(Number(normalized) * 100);
}

// máscara de dinheiro enquanto digita (centavos da direita para a esquerda)
export function moneyMask(input) {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
    input.value = digits ? (Number(digits) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
  });
}

export const STATUS_LABEL = { pending: 'Aguardando', paid: 'Pago', expired: 'Expirado', canceled: 'Cancelado', failed: 'Falhou', refunded: 'Devolvido', rejected: 'Recusado', active: 'Ativo', blocked: 'Bloqueado', delivered: 'Entregue' };
export const status = (s) => `<span class="status ${esc(s)}">${STATUS_LABEL[s] || esc(s)}</span>`;

export function toast(msg, kind = 'ok') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), 4500);
}

export function alertBox(el, msg, kind = 'error') {
  if (!msg) { el.className = 'alert'; el.textContent = ''; return; }
  el.textContent = msg;
  el.className = `alert ${kind} show`;
}

export async function copy(text, label = 'Copiado!') {
  try { await navigator.clipboard.writeText(text); toast(label); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast(label); } catch { toast('Selecione e copie manualmente.', 'error'); }
    ta.remove();
    return false;
  }
}

export function busy(btn, on, label = '') {
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `<i class="spinner"></i>${label}`; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.label ?? btn.innerHTML; btn.disabled = false; }
}

export const LOGO = '<span class="brand-mark"><svg viewBox="0 0 16 16" fill="none"><path d="M3.5 3.5h9l-9 9h9" stroke="#0d0b1f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
