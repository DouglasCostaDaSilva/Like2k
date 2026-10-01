import crypto from 'node:crypto';
import { config } from './config.js';
import { db, save } from './db.js';

// Painel administrativo: um único login (ADMIN_USER / ADMIN_PASSWORD), sessão em cookie HttpOnly.

const COOKIE = 'l2k_admin';

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function checkLogin(username, password) {
  const u = safeEqual(String(username || '').trim().toLowerCase(), config.admin.username.toLowerCase());
  const p = safeEqual(String(password || ''), config.admin.password);
  return u && p;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + config.sessionDays * 86400000;
  const sessions = db().sessions;
  for (const [t, s] of Object.entries(sessions)) if (s.expires < Date.now()) delete sessions[t];
  sessions[token] = { expires };
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

export function isAdmin(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const session = token && db().sessions[token];
  if (!session) return false;
  if (session.expires < Date.now()) {
    delete db().sessions[token];
    return false;
  }
  return true;
}

export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  next();
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
