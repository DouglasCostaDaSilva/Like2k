import crypto from 'node:crypto';
import { config } from './config.js';
import { db, save, nextId } from './db.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const norm = (s) => String(s || '').trim().toLowerCase();

// login aceita e-mail (lojistas) ou usuário (admin)
export function findLogin(login) {
  const key = norm(login);
  return db().users.find((u) => norm(u.email) === key || (u.username && norm(u.username) === key));
}

export function ensureAdmin() {
  const data = db();
  let admin = data.users.find((u) => u.role === 'admin');
  if (!admin) {
    admin = { id: nextId('user'), role: 'admin', status: 'active', username: config.admin.username, name: 'Administrador', email: '', createdAt: new Date().toISOString() };
    data.users.unshift(admin);
  }
  admin.username = config.admin.username;
  if (!verifyPassword(config.admin.password, admin.passwordHash)) admin.passwordHash = hashPassword(config.admin.password);
  save();
}

// ---------- sessões ----------
const COOKIE = 'zp_session';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  db().sessions[sha256(token)] = { userId: user.id, expires: Date.now() + config.sessionDays * 86400000 };
  save();
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionDays * 86400}${config.secureCookies ? '; Secure' : ''}`);
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) { delete db().sessions[sha256(token)]; save(); }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export function destroyUserSessions(userId) {
  const s = db().sessions;
  for (const [k, v] of Object.entries(s)) if (v.userId === userId) delete s[k];
}

export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const key = sha256(token);
  const session = db().sessions[key];
  if (!session) return null;
  if (session.expires < Date.now()) { delete db().sessions[key]; return null; }
  const user = db().users.find((u) => u.id === session.userId);
  return user && user.status === 'active' ? user : null;
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  req.user = user;
  next();
}

export function requireMerchant(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'merchant') return res.status(403).json({ error: 'Disponível apenas para contas de lojista.' });
    next();
  });
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    next();
  });
}

// ---------- API Key do lojista (guardada só como hash) ----------
export function issueApiKey(user) {
  const key = `zp_live_${crypto.randomBytes(24).toString('hex')}`;
  user.apiKeyHash = sha256(key);
  user.apiKeyPrefix = `${key.slice(0, 12)}…${key.slice(-4)}`;
  return key;
}

export function userByApiKey(key) {
  if (!key || !key.startsWith('zp_')) return null;
  const hash = sha256(key);
  return db().users.find((u) => u.apiKeyHash && u.apiKeyHash.length === hash.length && crypto.timingSafeEqual(Buffer.from(u.apiKeyHash), Buffer.from(hash))) || null;
}

// ---------- proteção contra força bruta ----------
const attempts = new Map();
export function loginBlocked(key) {
  const a = attempts.get(key);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 60000) : 0;
}
export function loginFailed(key) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) { a.until = Date.now() + 10 * 60000; a.count = 0; }
  attempts.set(key, a);
}
export const loginSucceeded = (key) => attempts.delete(key);
