import { config } from './config.js';

// Cliente da API LikeSystem (https://likesystem.squareweb.app).
// A API Key fica somente no servidor — nunca é enviada ao navegador.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(pathname, { method = 'GET', body } = {}) {
  if (!config.apiKey) throw new ApiError(503, 'API de envios não configurada (LIKESYSTEM_API_KEY).');
  let res;
  try {
    res = await fetch(config.apiBase + pathname, {
      method,
      headers: { 'X-Api-Key': config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });
  } catch (err) {
    throw new ApiError(502, 'Não foi possível conectar à API de envios. Tente novamente em instantes.');
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const fallback = {
      400: 'Requisição inválida.',
      401: 'API Key inválida.',
      403: 'Conta da API desativada ou expirada.',
      500: 'Falha na API externa do Free Fire. Tente novamente em instantes.',
    }[res.status];
    throw new ApiError(res.status, payload?.error || fallback || `Erro ${res.status} na API de envios.`);
  }
  return payload;
}

// ---------- Modo simulado (MOCK_API=1) ----------
const mock = { remaining: 500000, logId: 1000, logs: [] };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mockApi = {
  async sendLikes(targetId, amount) {
    await wait(900);
    if (amount > mock.remaining) throw new ApiError(400, 'Saldo insuficiente');
    mock.remaining -= amount;
    const log = { log_id: ++mock.logId, target_id: targetId, likes_sent: amount, status: 'success', action: 'api_send', timestamp: new Date().toISOString().slice(0, 19) };
    mock.logs.unshift(log);
    return { likes_sent: amount, remaining: mock.remaining, player_nickname: `Ninja_${targetId.slice(-4)}`, log_id: log.log_id };
  },
  async balance() {
    return { plan_type: 'stock', remaining: mock.remaining, stock_limit: 500000, stock_used: 500000 - mock.remaining, daily_limit: 0, used_today: 0, expiry_date: '2027-12-31' };
  },
  async logs(limit) {
    return mock.logs.slice(0, limit);
  },
  async player(uid) {
    await wait(400);
    return { basicInfo: { accountId: uid, nickname: `Ninja_${uid.slice(-4)}`, region: 'BR', liked: (Number(uid.slice(-5)) * 7) % 90000, level: 60 + (Number(uid.slice(-2)) % 20) } };
  },
};

const realApi = {
  sendLikes: (targetId, amount) => call('/api/likes/send', { method: 'POST', body: { target_id: targetId, amount } }),
  balance: () => call('/api/balance'),
  logs: (limit = 50, days = 7) => call(`/api/logs?limit=${limit}&days=${days}`),
  player: (uid) => call(`/api/player/${encodeURIComponent(uid)}`),
};

export const likeApi = config.mock ? mockApi : realApi;

// ---------- Saldo global (cache) ----------
let balanceCache = { at: 0, value: null, error: null };

export async function getBalance({ force = false } = {}) {
  if (!force && Date.now() - balanceCache.at < 30000 && (balanceCache.value || balanceCache.error)) return balanceCache;
  try {
    balanceCache = { at: Date.now(), value: await likeApi.balance(), error: null };
  } catch (err) {
    balanceCache = { at: Date.now(), value: balanceCache.value, error: err.message };
  }
  return balanceCache;
}

export function updateRemaining(remaining) {
  if (balanceCache.value && Number.isFinite(remaining)) {
    balanceCache.value = { ...balanceCache.value, remaining };
  }
}
