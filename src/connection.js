import { save } from './db.js';
import { seal, open } from './vault.js';
import { provider, ProviderError } from './mercadopago.js';

// Conexão do lojista com a conta Mercado Pago dele (OAuth). Tokens criptografados em repouso.
// user.mp = { status: 'connected' | 'reconnect', userId, access, refresh, publicKey, expiresAt, connectedAt, nickname, email }

const REFRESH_MARGIN = 7 * 86400000; // renova quando faltar menos de 7 dias (o token vale 180 dias)

export const isConnected = (u) => u.mp?.status === 'connected';

export function saveConnection(user, t, profile = {}) {
  user.mp = {
    status: 'connected', userId: t.userId, access: seal(t.accessToken), refresh: seal(t.refreshToken), publicKey: t.publicKey,
    expiresAt: t.expiresAt, connectedAt: user.mp?.connectedAt || new Date().toISOString(), nickname: profile.nickname || null, email: profile.email || null,
  };
  save();
}

export function disconnect(user) {
  delete user.mp;
  save();
}

export function markReconnect(user) {
  if (user.mp) { user.mp.status = 'reconnect'; save(); }
}

const refreshing = new Map();
async function refresh(user) {
  if (!refreshing.has(user.id)) {
    refreshing.set(user.id, (async () => {
      try {
        const t = await provider.refresh(open(user.mp.refresh));
        Object.assign(user.mp, { access: seal(t.accessToken), refresh: seal(t.refreshToken || open(user.mp.refresh)), expiresAt: t.expiresAt });
        save();
      } catch (err) {
        if (user.mp.expiresAt <= Date.now()) { markReconnect(user); throw new ProviderError(409, 'A conexão com o Mercado Pago expirou. Conecte a conta de novo no painel.', 'mercadopago_reconnect'); }
      } finally {
        refreshing.delete(user.id);
      }
    })());
  }
  await refreshing.get(user.id);
}

// access_token do vendedor, renovado quando preciso
export async function tokenFor(user) {
  if (!isConnected(user)) {
    throw new ProviderError(409, user.mp ? 'A conexão com o Mercado Pago precisa ser refeita. Conecte a conta de novo no painel.' : 'Conecte sua conta Mercado Pago em Painel › Integração para criar cobranças.', user.mp ? 'mercadopago_reconnect' : 'mercadopago_not_connected');
  }
  if (user.mp.expiresAt - Date.now() < REFRESH_MARGIN) await refresh(user);
  return open(user.mp.access);
}

// executa uma chamada ao Mercado Pago em nome do lojista e marca "reconectar" se o token foi revogado
export async function asSeller(user, fn) {
  const token = await tokenFor(user);
  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof ProviderError && err.code === 'mercadopago_reconnect') markReconnect(user);
    throw err;
  }
}

export const connectionOut = (u) => (u.mp ? {
  status: u.mp.status, accountId: u.mp.userId, nickname: u.mp.nickname, email: u.mp.email, connectedAt: u.mp.connectedAt, expiresAt: new Date(u.mp.expiresAt).toISOString(),
} : { status: 'disconnected' });
