import { config } from './config.js';

// Cliente da API de likes (pasta api/): /like, /info, /status, /reset-limit. A chave fica só no servidor.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(pathname, params = {}, { timeout = 30000 } = {}) {
  const u = new URL(config.likeApi.base + pathname);
  for (const [k, v] of Object.entries({ ...params, key: config.likeApi.key })) u.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new ApiError(502, 'A API de likes não respondeu. Confira se ela está no ar (LIKE_API_URL).');
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback = { 403: 'Chave da API inválida (LIKE_API_KEY).', 429: 'Limite diário da API atingido.', 500: 'Falha na API de likes.' }[res.status];
    throw new ApiError(res.status === 429 ? 429 : res.status === 403 ? 503 : 502, payload?.error ? translate(payload.error) : fallback || `Erro ${res.status} na API de likes.`);
  }
  if (payload?.error && !payload?.status) throw new ApiError(400, translate(payload.error));
  return payload;
}

function translate(msg) {
  const m = String(msg || '');
  if (/invalid uid|server mismatch/i.test(m)) return 'ID não encontrado nessa região. Confira o ID e o servidor.';
  if (/invalid (api )?key/i.test(m)) return 'Chave da API inválida: LIKE_API_KEY do site precisa ser igual à API_KEY da API.';
  if (/daily limit/i.test(m)) return 'A API atingiu o limite diário de envios. Zere o limite no painel ou tente amanhã.';
  if (/invalid server/i.test(m)) return 'Região não aceita pela API.';
  if (/no accounts|no valid/i.test(m)) return 'A API não tem contas válidas para essa região no momento.';
  if (/parse failed|verify failed/i.test(m)) return 'A API não conseguiu ler o perfil. Tente de novo.';
  return m;
}

// ---------- Modo simulado (MOCK=1) ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mockLikes = new Map();
const mockNick = (uid) => `Ninja_${String(uid).slice(-4)}`;
const mockBase = (uid) => (Number(String(uid).slice(-5)) * 7) % 90000;
const mockSentToday = new Set();

const mockApi = {
  async info(uid, server) {
    await wait(400);
    if (String(uid).endsWith('9999')) throw new ApiError(400, 'ID não encontrado nessa região. Confira o ID e o servidor.');
    return { uid: String(uid), nickname: mockNick(uid), likes: mockLikes.get(uid) ?? mockBase(uid), level: 40 + (Number(String(uid).slice(-2)) % 40), region: server, server };
  },
  async send(uid, server) {
    await wait(1200);
    if (String(uid).endsWith('0000')) throw new ApiError(502, 'Falha simulada na API de likes.');
    const before = mockLikes.get(uid) ?? mockBase(uid);
    const given = mockSentToday.has(uid) ? 0 : 80 + (Number(String(uid).slice(-3)) % 40);
    mockSentToday.add(uid);
    mockLikes.set(uid, before + given);
    return { uid: String(uid), nickname: mockNick(uid), before, after: before + given, given, tokensUsed: given, elapsed: 1.2, status: given ? 1 : 2, remains: 97, server };
  },
  async status() {
    return { ok: true, uptime: 3600, keyLimit: 100, remains: 97, cachedTokens: 560, regions: { IND: { accounts: 300, valid: 280 }, BR: { accounts: 300, valid: 280 }, BD: { accounts: 0, valid: 0 }, RU: { accounts: 0, valid: 0 } } };
  },
  async resetLimit() { return { ok: true, remains: 100 }; },
};

const realApi = {
  async info(uid, server) {
    const r = await call('/info', { uid, server_name: server });
    if (!r?.status) throw new ApiError(400, translate(r?.error));
    return { uid: String(r.UID ?? uid), nickname: String(r.PlayerNickname || ''), likes: Number(r.Likes) || 0, level: Number(r.Level) || null, region: r.Region || server, server };
  },
  async send(uid, server) {
    const r = await call('/like', { uid, server_name: server }, { timeout: 180000 });
    if (!r?.status) throw new ApiError(400, translate(r?.error));
    const m = String(r.remains || '').match(/\((\d+)\//);
    return {
      uid: String(r.UID ?? uid), nickname: String(r.PlayerNickname || ''), before: Number(r.LikesbeforeCommand) || 0, after: Number(r.LikesafterCommand) || 0,
      given: Number(r.LikesGivenByAPI) || 0, tokensUsed: Number(r.tokens_used) || 0, elapsed: Number(r['Elapsed sec']) || 0, status: Number(r.status), remains: m ? Number(m[1]) : null, server,
    };
  },
  async status() {
    const r = await call('/status', {}, { timeout: 15000 });
    const regions = {};
    for (const [k, v] of Object.entries(r.regions || {})) regions[k] = { accounts: Number(v.accounts) || 0, valid: Number(v.valid_tokens) || 0 };
    return { ok: Boolean(r.ok), uptime: Number(r.uptime_sec) || 0, keyLimit: Number(r.key_limit) || 0, remains: Number(r.remains) || 0, cachedTokens: Number(r.cached_tokens) || 0, regions };
  },
  async resetLimit() {
    const r = await call('/reset-limit');
    const m = String(r.remains || '').match(/\((\d+)\//);
    return { ok: true, remains: m ? Number(m[1]) : null };
  },
};

export const likeApi = config.mock ? mockApi : realApi;

// ---------- status da API (cache) ----------
let statusCache = { at: 0, value: null, error: null };

export async function getStatus({ force = false } = {}) {
  if (!force && Date.now() - statusCache.at < 20000 && (statusCache.value || statusCache.error)) return statusCache;
  try {
    statusCache = { at: Date.now(), value: await likeApi.status(), error: null };
  } catch (err) {
    statusCache = { at: Date.now(), value: null, error: err.message };
  }
  return statusCache;
}
