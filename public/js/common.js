export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
  });
  let data = null;
  try { data = await res.json(); } catch { /* resposta sem corpo */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Erro ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const int = (n) => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('pt-BR'));
export const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
