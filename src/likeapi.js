import { config } from './config.js';

// Cliente da API de likes (formato LikeSystem). A API Key fica só no servidor.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(pathname, { method = 'GET', body } = {}) {
  if (!config.likeApi.key) throw new ApiError(503, 'API de likes não configurada (LIKE_API_KEY).');
  let res;
  try {
    res = await fetch(config.likeApi.base + pathname, {
      method,
      headers: { 'X-Api-Key': config.likeApi.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ApiError(502, 'Não foi possível conectar à API de likes. Tente novamente em instantes.');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback = {
      400: 'Requisição inválida.',
      401: 'API Key inválida.',
      403: 'Conta da API desativada ou expirada.',
      404: 'Jogador não encontrado.',
      500: 'Falha na API do Free Fire. Tente novamente em instantes.',
    }[res.status];
    throw new ApiError(res.status, payload?.error || fallback || `Erro ${res.status} na API de likes.`);
  }
  return payload;
}

// ---------- Modo simulado (MOCK=1) ----------
const mock = { remaining: 500000, logId: 1000 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mockNick = (uid) => `Ninja_${String(uid).slice(-4)}`;

const mockApi = {
  async sendLikes(targetId, amount) {
    await wait(700);
    if (String(targetId).endsWith('0000')) throw new ApiError(500, 'Falha simulada na API do Free Fire.');
    if (amount > mock.remaining) throw new ApiError(400, 'Saldo insuficiente');
    mock.remaining -= amount;
    return { likes_sent: amount, remaining: mock.remaining, player_nickname: mockNick(targetId), log_id: ++mock.logId };
  },
  async balance() {
    return { plan_type: 'stock', remaining: mock.remaining, stock_limit: 500000, stock_used: 500000 - mock.remaining, daily_limit: 0, used_today: 0, expiry_date: '2027-12-31' };
  },
  async player(uid) {
    await wait(400);
    if (String(uid).endsWith('9999')) throw new ApiError(404, 'Jogador não encontrado.');
    return { basicInfo: { accountId: String(uid), nickname: mockNick(uid), region: 'BR', liked: (Number(String(uid).slice(-5)) * 7) % 90000, level: 40 + (Number(String(uid).slice(-2)) % 40) } };
  },
};

const realApi = {
  sendLikes: (targetId, amount) => call('/api/likes/send', { method: 'POST', body: { target_id: String(targetId), amount } }),
  balance: () => call('/api/balance'),
  player: (uid) => call(`/api/player/${encodeURIComponent(uid)}`),
};

export const likeApi = config.mock ? mockApi : realApi;

// Perfil do jogador em formato simples
export async function playerInfo(uid) {
  const p = await likeApi.player(uid);
  const b = p?.basicInfo || p?.basic_info || p || {};
  const nickname = b.nickname || b.nick || p?.nickname || p?.player_nickname;
  if (!nickname) throw new ApiError(404, 'Jogador não encontrado. Confira o ID.');
  return {
    uid: String(b.accountId || b.account_id || uid),
    nickname: String(nickname),
    level: Number(b.level) || null,
    region: b.region || null,
    likes: Number(b.liked ?? b.likes) || 0,
  };
}

// ---------- Saldo da API (cache) ----------
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
  if (balanceCache.value && Number.isFinite(remaining)) balanceCache.value = { ...balanceCache.value, remaining };
}
