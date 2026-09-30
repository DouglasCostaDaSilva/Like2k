import crypto from 'node:crypto';
import { config } from './config.js';
import { db, save } from './db.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export const normalize = (username) => String(username || '').trim().toLowerCase();

export function findUser(username) {
  const key = normalize(username);
  return db().users.find((u) => normalize(u.username) === key);
}

// Garante a conta ADMIN com a senha configurada (padrão LELEO).
export function ensureAdmin() {
  const data = db();
  let admin = data.users.find((u) => u.role === 'admin');
  if (!admin) {
    admin = { id: 0, username: config.admin.username, role: 'admin', status: 'active', stock: 0, createdAt: new Date().toISOString() };
    data.users.unshift(admin);
  }
  if (!verifyPassword(config.admin.password, admin.passwordHash)) admin.passwordHash = hashPassword(config.admin.password);
  admin.username = config.admin.username;
  save();
}

// ---------- Sessões ----------
const COOKIE = 'ls_session';

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
  const expires = Date.now() + config.sessionDays * 86400000;
  db().sessions[token] = { userId: user.id, expires };
  save();
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionDays * 86400}${config.secureCookies ? '; Secure' : ''}`);
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token && db().sessions[token]) {
    delete db().sessions[token];
    save();
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

export function destroyUserSessions(userId) {
  const sessions = db().sessions;
  for (const [token, s] of Object.entries(sessions)) if (s.userId === userId) delete sessions[token];
}

export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = token && db().sessions[token];
  if (!session) return null;
  if (session.expires < Date.now()) {
    delete db().sessions[token];
    return null;
  }
  const user = db().users.find((u) => u.id === session.userId);
  return user && user.status === 'active' ? user : null;
}

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    next();
  });
}

// ---------- Proteção contra força bruta ----------
const attempts = new Map();

export function loginBlocked(key) {
  const a = attempts.get(key);
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 60000) : 0;
}

export function loginFailed(key) {
  const a = attempts.get(key) || { count: 0, until: 0 };
  a.count += 1;
  if (a.count >= 5) {
    a.until = Date.now() + 10 * 60000;
    a.count = 0;
  }
  attempts.set(key, a);
}

export function loginSucceeded(key) {
  attempts.delete(key);
}
