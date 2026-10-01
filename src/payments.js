import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from './config.js';

// PIX pelo Mercado Pago (Access Token da sua conta). Com MOCK=1 usa um provedor simulado.

export class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const BASE = (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/+$/, '');

async function call(pathname, { method = 'GET', body, idempotencyKey } = {}) {
  if (!config.mp.accessToken) throw new PaymentError(503, 'Pagamento PIX não configurado (MP_ACCESS_TOKEN).');
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
    throw new PaymentError(502, 'Não foi possível falar com o Mercado Pago. Tente de novo.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const cause = data?.cause?.[0]?.description || data?.message || `erro ${res.status}`;
    throw new PaymentError(res.status >= 500 ? 502 : 400, `Mercado Pago recusou: ${cause}`);
  }
  return data;
}

// data no formato que o Mercado Pago aceita: 2026-10-01T12:00:00.000-03:00
function mpDate(ms) {
  const d = new Date(ms - 3 * 3600000);
  return `${d.toISOString().slice(0, 23)}-03:00`;
}

const STATUS = { approved: 'paid', authorized: 'pending', pending: 'pending', in_process: 'pending', in_mediation: 'pending', rejected: 'failed', cancelled: 'expired', refunded: 'refunded', charged_back: 'refunded' };

export const qrImage = (code) => QRCode.toDataURL(code, { margin: 1, width: 320, color: { dark: '#0b0b10', light: '#ffffff' } });

const realProvider = {
  name: 'mercadopago',
  configured: () => Boolean(config.mp.accessToken),
  async createPix({ orderId, amountCents, description, email, expiresAt }) {
    const body = {
      transaction_amount: Math.round(amountCents) / 100,
      description,
      payment_method_id: 'pix',
      external_reference: String(orderId),
      date_of_expiration: mpDate(expiresAt),
      payer: { email: email || `cliente+${orderId}@like2k.app` },
    };
    if (config.publicUrl.startsWith('https://')) body.notification_url = `${config.publicUrl}/webhooks/mercadopago`;
    const p = await call('/v1/payments', { method: 'POST', body, idempotencyKey: `like2k-order-${orderId}` });
    const tx = p.point_of_interaction?.transaction_data || {};
    if (!tx.qr_code) throw new PaymentError(502, 'O Mercado Pago não devolveu o código PIX.');
    return {
      providerId: String(p.id),
      status: STATUS[p.status] || 'pending',
      qrCode: tx.qr_code,
      qrImage: tx.qr_code_base64 ? `data:image/png;base64,${tx.qr_code_base64}` : await qrImage(tx.qr_code),
    };
  },
  async getStatus(providerId) {
    const p = await call(`/v1/payments/${encodeURIComponent(providerId)}`);
    return { status: STATUS[p.status] || 'pending', paidAt: p.date_approved || null, orderId: p.external_reference || null };
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
  configured: () => true,
  async createPix({ orderId, amountCents }) {
    const providerId = `sim_${orderId}_${crypto.randomBytes(4).toString('hex')}`;
    mockStore.set(providerId, { status: 'pending', paidAt: null, orderId });
    const valor = (amountCents / 100).toFixed(2);
    const qrCode = `00020101021226840014br.gov.bcb.pix2562like2k.simulado/qr/${providerId}5204000053039865406${valor}5802BR5915LIKE2K SIMULADO6009SAO PAULO62070503***6304ABCD`;
    return { providerId, status: 'pending', qrCode, qrImage: await qrImage(qrCode) };
  },
  async getStatus(providerId) {
    return mockStore.get(providerId) || { status: 'pending', paidAt: null, orderId: null };
  },
  verifyWebhook: () => true,
  simulatePayment(providerId) {
    const s = mockStore.get(providerId) || { orderId: null };
    mockStore.set(providerId, { ...s, status: 'paid', paidAt: new Date().toISOString() });
  },
};

export const payments = config.mock ? mockProvider : realProvider;
