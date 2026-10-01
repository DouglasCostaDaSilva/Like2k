import crypto from 'node:crypto';
import { config } from './config.js';

// Provedor PIX: Mercado Pago em modelo marketplace.
//  - OAuth: o lojista autoriza o Zyropay a criar cobranças na conta dele (access_token do VENDEDOR).
//  - /v1/payments é chamado com o token do vendedor; o dinheiro cai direto na conta dele.
//  - A taxa do Zyropay vai em application_fee (comissão enviada à conta dona do aplicativo).
// Com MOCK_PROVIDER=1 usa um provedor simulado, sem rede.

export class ProviderError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const BASE = (process.env.MP_API_BASE || 'https://api.mercadopago.com').replace(/\/+$/, ''); // MP_API_BASE: só para testes com servidor falso
const AUTH_URL = 'https://auth.mercadopago.com.br/authorization';

async function call(pathname, { method = 'GET', body, token, idempotencyKey } = {}) {
  let res;
  try {
    res = await fetch(BASE + pathname, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    if (res.status === 401 || (res.status === 403 && /token|authoriz/i.test(data?.message || ""))) {
      throw new ProviderError(409, 'A conexão com o Mercado Pago expirou ou foi revogada. Conecte a conta de novo no painel.', 'mercadopago_reconnect');
    }
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

function tokens(t) {
  if (!t.access_token) throw new ProviderError(502, 'O Mercado Pago não devolveu o token de acesso.');
  return {
    accessToken: t.access_token, refreshToken: t.refresh_token, publicKey: t.public_key || null, userId: String(t.user_id),
    expiresAt: Date.now() + (Number(t.expires_in) || 15552000) * 1000,
  };
}

const realProvider = {
  name: 'mercadopago',
  configured: () => Boolean(config.mp.clientId && config.mp.clientSecret),

  // ---- conexão do lojista (OAuth) ----
  authorizeUrl(state) {
    if (!this.configured()) throw new ProviderError(503, 'Mercado Pago não configurado (MP_CLIENT_ID e MP_CLIENT_SECRET).');
    const u = new URL(AUTH_URL);
    u.search = new URLSearchParams({ client_id: config.mp.clientId, response_type: 'code', platform_id: 'mp', state, redirect_uri: `${config.publicUrl}/oauth/mercadopago/callback` }).toString();
    return u.toString();
  },
  async exchangeCode(code) {
    const t = await call('/oauth/token', { method: 'POST', body: { client_id: config.mp.clientId, client_secret: config.mp.clientSecret, grant_type: 'authorization_code', code, redirect_uri: `${config.publicUrl}/oauth/mercadopago/callback` } });
    return tokens(t);
  },
  async refresh(refreshToken) {
    const t = await call('/oauth/token', { method: 'POST', body: { client_id: config.mp.clientId, client_secret: config.mp.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken } });
    return tokens(t);
  },
  async profile(token) {
    const u = await call('/users/me', { token }).catch(() => ({}));
    return { nickname: u.nickname || null, email: u.email || null };
  },

  // ---- cobranças (sempre com o token do vendedor) ----
  async createPix({ token, chargeId, amountCents, feeCents, description, payer, expiresAt }) {
    const doc = String(payer?.document || '').replace(/\D/g, '');
    const body = {
      transaction_amount: amountCents / 100,
      application_fee: feeCents / 100,
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
    const p = await call('/v1/payments', { method: 'POST', token, body, idempotencyKey: `zyropay-charge-${chargeId}` });
    const tx = p.point_of_interaction?.transaction_data || {};
    return { providerId: String(p.id), status: STATUS[p.status] || 'pending', qrCode: tx.qr_code, qrCodeBase64: tx.qr_code_base64 ? `data:image/png;base64,${tx.qr_code_base64}` : null };
  },
  async getStatus(token, providerId) {
    const p = await call(`/v1/payments/${encodeURIComponent(providerId)}`, { token });
    return { status: STATUS[p.status] || 'pending', paidAt: p.date_approved || null, chargeId: Number(p.external_reference) || null, payerName: [p.payer?.first_name, p.payer?.last_name].filter(Boolean).join(' ') || null };
  },
  async cancel(token, providerId) {
    await call(`/v1/payments/${encodeURIComponent(providerId)}`, { method: 'PUT', token, body: { status: 'cancelled' } });
  },
  async refund(token, providerId) {
    await call(`/v1/payments/${encodeURIComponent(providerId)}/refunds`, { method: 'POST', token, body: {}, idempotencyKey: `zyropay-refund-${providerId}` });
  },
  // valida o header x-signature das notificações do aplicativo (ts=...,v1=...)
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
  authorizeUrl: (state) => `${config.publicUrl}/oauth/mercadopago/callback?code=mock_${crypto.randomBytes(6).toString('hex')}&state=${state}`,
  async exchangeCode(code) {
    return { accessToken: `TEST-${code}`, refreshToken: `TEST-refresh-${code}`, publicKey: 'TEST-public', userId: String(100000000 + (parseInt(code.slice(-6), 16) % 900000000)), expiresAt: Date.now() + 15552000000 };
  },
  async refresh(refreshToken) {
    return { accessToken: `TEST-${crypto.randomBytes(6).toString('hex')}`, refreshToken, publicKey: 'TEST-public', userId: '100000000', expiresAt: Date.now() + 15552000000 };
  },
  async profile() { return { nickname: 'TESTUSER_SIMULADO', email: null }; },
  async createPix({ chargeId, amountCents }) {
    const providerId = `sim_${chargeId}_${crypto.randomBytes(4).toString('hex')}`;
    mockStore.set(providerId, { status: 'pending', paidAt: null, chargeId });
    const valor = (amountCents / 100).toFixed(2);
    const qrCode = `00020101021226860014br.gov.bcb.pix2564zyropay.simulado/qr/${providerId}5204000053039865406${valor}5802BR5916ZYROPAY SIMULADO6009SAO PAULO62070503***6304ABCD`;
    return { providerId, status: 'pending', qrCode, qrCodeBase64: null };
  },
  async getStatus(token, providerId) {
    const s = mockStore.get(providerId);
    return s ? { ...s, payerName: s.status === 'paid' ? 'Pagador Teste' : null } : { status: 'pending', paidAt: null };
  },
  async cancel(token, providerId) { const s = mockStore.get(providerId); if (s) s.status = 'expired'; },
  async refund(token, providerId) { const s = mockStore.get(providerId); if (s) s.status = 'refunded'; },
  verifyWebhook: () => true,
  simulatePayment(providerId) {
    const s = mockStore.get(providerId) || { chargeId: null };
    mockStore.set(providerId, { ...s, status: 'paid', paidAt: new Date().toISOString() });
  },
};

export const provider = config.mock ? mockProvider : realProvider;
