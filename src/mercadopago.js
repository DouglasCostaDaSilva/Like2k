import crypto from 'node:crypto';
import { config } from './config.js';

// Provedor PIX: Mercado Pago (API /v1/payments). Com MOCK_PROVIDER=1 usa um provedor simulado.

export class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const BASE = 'https://api.mercadopago.com';

async function mp(pathname, { method = 'GET', body, idempotencyKey } = {}) {
  if (!config.mp.accessToken) throw new ProviderError(503, 'Mercado Pago não configurado (MP_ACCESS_TOKEN).');
  let res;
  try {
    res = await fetch(BASE + pathname, {
      method,
      headers: {
        Authorization: `Bearer ${config.mp.accessToken}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ProviderError(502, 'Não foi possível falar com o Mercado Pago. Tente de novo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const cause = data?.cause?.[0]?.description || data?.message || `erro ${res.status}`;
    throw new ProviderError(res.status >= 500 ? 502 : 400, `Mercado Pago recusou: ${cause}`);
  }
  return data;
}

// data no formato que o Mercado Pago aceita: 2026-10-01T12:00:00.000-03:00
function mpDate(ms) {
  const d = new Date(ms - 3 * 3600000);
  return `${d.toISOString().slice(0, 23)}-03:00`;
}

const STATUS = { approved: 'paid', authorized: 'pending', pending: 'pending', in_process: 'pending', in_mediation: 'pending', rejected: 'failed', cancelled: 'expired', refunded: 'refunded', charged_back: 'refunded' };

const realProvider = {
  name: 'mercadopago',
  async createPix({ chargeId, amountCents, description, payer, expiresAt }) {
    const doc = String(payer?.document || '').replace(/\D/g, '');
    const body = {
      transaction_amount: amountCents / 100,
      description: description || `Cobrança ${chargeId}`,
      payment_method_id: 'pix',
      external_reference: String(chargeId),
      date_of_expiration: mpDate(expiresAt),
      payer: {
        email: payer?.email || `pagador+${chargeId}@zyropay.app`,
        ...(payer?.name ? { first_name: String(payer.name).slice(0, 60) } : {}),
        ...(doc.length === 11 || doc.length === 14 ? { identification: { type: doc.length === 11 ? 'CPF' : 'CNPJ', number: doc } } : {}),
      },
    };
    // o Mercado Pago só aceita notification_url pública com https
    if (config.publicUrl.startsWith('https://')) body.notification_url = `${config.publicUrl}/webhooks/mercadopago`;
    const p = await mp('/v1/payments', { method: 'POST', body, idempotencyKey: `zyropay-charge-${chargeId}` });
    const tx = p.point_of_interaction?.transaction_data || {};
    return { providerId: String(p.id), status: STATUS[p.status] || 'pending', qrCode: tx.qr_code, qrCodeBase64: tx.qr_code_base64 ? `data:image/png;base64,${tx.qr_code_base64}` : null };
  },
  async getStatus(providerId) {
    const p = await mp(`/v1/payments/${encodeURIComponent(providerId)}`);
    return { status: STATUS[p.status] || 'pending', paidAt: p.date_approved || null, chargeId: Number(p.external_reference) || null, payerName: [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(' ') || null };
  },
  async cancel(providerId) {
    await mp(`/v1/payments/${encodeURIComponent(providerId)}`, { method: 'PUT', body: { status: 'cancelled' } });
  },
  async refund(providerId) {
    await mp(`/v1/payments/${encodeURIComponent(providerId)}/refunds`, { method: 'POST', body: {}, idempotencyKey: `zyropay-refund-${providerId}` });
  },
  // valida o header x-signature das notificações (ts=...,v1=...)
  verifyWebhook({ signature, requestId, dataId }) {
    if (!config.mp.webhookSecret) return true;
    const parts = Object.fromEntries(String(signature || '').split(',').map((p) => p.split('=').map((s) => s.trim())));
    if (!parts.ts || !parts.v1) return false;
    const manifest = `id:${String(dataId || '').toLowerCase()};request-id:${requestId || ''};ts:${parts.ts};`;
    const expected = crypto.createHmac('sha256', config.mp.webhookSecret).update(manifest).digest('hex');
    return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  },
};

// ---------- provedor simulado ----------
const mockStore = new Map();
const mockProvider = {
  name: 'simulado',
  async createPix({ chargeId, amountCents }) {
    const providerId = `sim_${chargeId}_${crypto.randomBytes(4).toString('hex')}`;
    mockStore.set(providerId, { status: 'pending', paidAt: null, chargeId });
    const valor = (amountCents / 100).toFixed(2);
    const qrCode = `00020101021226860014br.gov.bcb.pix2564zyropay.simulado/qr/${providerId}5204000053039865406${valor}5802BR5916ZYROPAY SIMULADO6009SAO PAULO62070503***6304ABCD`;
    return { providerId, status: 'pending', qrCode, qrCodeBase64: null };
  },
  async getStatus(providerId) {
    const s = mockStore.get(providerId);
    return s ? { ...s, payerName: s.status === 'paid' ? 'Pagador Teste' : null } : { status: 'pending', paidAt: null };
  },
  async cancel(providerId) { const s = mockStore.get(providerId); if (s) s.status = 'expired'; },
  async refund(providerId) { const s = mockStore.get(providerId); if (s) s.status = 'refunded'; },
  verifyWebhook: () => true,
  simulatePayment(providerId) {
    const s = mockStore.get(providerId) || { chargeId: null };
    mockStore.set(providerId, { ...s, status: 'paid', paidAt: new Date().toISOString() });
  },
};

export const provider = config.mock ? mockProvider : realProvider;
