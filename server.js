import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, priceCents, root } from './src/config.js';
import { db, load, save, nextId } from './src/db.js';
import { likeApi, getBalance, updateRemaining, ApiError } from './src/likeapi.js';
import {
  hashPassword, verifyPassword, findUser, ensureAdmin, createSession, destroySession, destroyUserSessions,
  currentUser, requireAuth, requireAdmin, loginBlocked, loginFailed, loginSucceeded,
} from './src/auth.js';

load();
ensureAdmin();

// Envios interrompidos por queda do servidor ficam para conferência do admin.
for (const s of db().sends) if (s.status === 'pending') { s.status = 'unknown'; s.error = 'Servidor reiniciado durante o envio — confira nos logs da API.'; }
save();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // um proxy reverso na frente (hospedagem)

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '32kb' }));
app.use('/api/v1', express.urlencoded({ extended: false, limit: '32kb' })); // API pública aceita formulário também

// Rotas do painel que alteram dados só aceitam JSON (junto com SameSite=Strict, bloqueia CSRF por formulário).
// A API pública (/api/v1) usa X-Api-Key, sem cookie, então não tem esse risco.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/v1/')) return next();
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Envie os dados em JSON.' });
  next();
});

// ---------- Utilidades ----------
const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const UID_RE = /^\d{5,15}$/;
const toInt = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const usedTotal = (userId) => db().sends.filter((s) => s.userId === userId && s.status === 'success').reduce((a, s) => a + s.likesSent, 0);
const isExpired = (u) => Boolean(u.expiresAt) && u.expiresAt < dayKey();

const publicUser = (u) => ({
  id: u.id, username: u.username, role: u.role, status: u.status, stock: u.stock,
  usedTotal: usedTotal(u.id), expiresAt: u.expiresAt || null, expired: isExpired(u),
  contact: u.contact || '', note: u.note || '', createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
});

const SOURCES = { manual: 'manual_user', auto: 'auto_schedule', api: 'api_send' };
const activeScheduleFor = (targetId) => db().schedules.find((x) => x.status === 'active' && x.targetId === targetId);

function uidUsage(targetId, day = dayKey()) {
  let used = 0;
  for (const s of db().sends) {
    if (s.targetId !== targetId || s.day !== day) continue;
    if (s.status === 'pending') used += s.amount;
    else if (s.status === 'success' || s.status === 'unknown') used += s.likesSent ?? s.amount;
  }
  return used;
}

const allocatedStock = () => db().users.filter((u) => u.role === 'client' && u.status !== 'pending').reduce((sum, u) => sum + u.stock, 0);

async function globalStock(force = false) {
  const b = await getBalance({ force });
  const allocated = allocatedStock();
  const remaining = b.value?.remaining ?? null;
  return {
    remaining,
    allocated,
    free: remaining == null ? null : remaining - allocated,
    plan: b.value?.plan_type ?? null,
    expiry: b.value?.expiry_date ?? null,
    stockLimit: b.value?.stock_limit ?? null,
    stockUsed: b.value?.stock_used ?? null,
    dailyLimit: b.value?.daily_limit ?? null,
    usedToday: b.value?.used_today ?? null,
    error: b.error,
    updatedAt: b.at,
  };
}

const rules = () => ({
  packSize: config.packSize,
  pricePerPackCents: config.pricePerPackCents,
  minPurchase: config.minPurchase,
  maxPurchase: config.maxPurchase,
  maxPerSend: config.maxPerSend,
  dailyLimitPerUid: config.dailyLimitPerUid,
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Modelo 3D opcional (public/models/outfit.glb) que substitui o traje procedural.
app.get('/api/model', (req, res) => {
  res.json({ url: fs.existsSync(path.join(root, 'public/models/outfit.glb')) ? '/models/outfit.glb' : null });
});

// ---------- Autenticação ----------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = `${req.ip}|${String(username || '').toLowerCase()}`;
  const blocked = loginBlocked(key);
  if (blocked) return res.status(429).json({ error: `Muitas tentativas. Aguarde ${blocked} min.` });

  const user = findUser(username);
  if (!user || typeof password !== 'string' || !verifyPassword(password, user.passwordHash)) {
    loginFailed(key);
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  if (user.status === 'pending') return res.status(403).json({ error: 'Seu acesso ainda está em análise pelo administrador.' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Acesso bloqueado. Fale com o administrador.' });

  loginSucceeded(key);
  user.lastLoginAt = new Date().toISOString();
  createSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

// Plataforma fechada: qualquer pessoa pode pedir acesso, mas só entra após aprovação do admin.
app.post('/api/auth/request', (req, res) => {
  const { username, password, contact } = req.body || {};
  if (!USERNAME_RE.test(String(username || ''))) return res.status(400).json({ error: 'Usuário deve ter 3–24 caracteres (letras, números, _ . -).' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  if (!contact || String(contact).trim().length < 5) return res.status(400).json({ error: 'Informe um contato (WhatsApp, Discord ou e-mail).' });
  if (findUser(username)) return res.status(409).json({ error: 'Este usuário já existe ou já foi solicitado.' });
  if (db().users.filter((u) => u.status === 'pending').length >= 200) return res.status(429).json({ error: 'Muitas solicitações pendentes. Tente mais tarde.' });

  db().users.push({
    id: nextId('user'), username: String(username).trim(), passwordHash: hashPassword(password), role: 'client',
    status: 'pending', stock: 0, contact: String(contact).trim().slice(0, 120), createdAt: new Date().toISOString(),
  });
  save();
  res.json({ ok: true, message: 'Solicitação enviada! Aguarde a aprovação do administrador.' });
});

app.get('/api/me', requireAuth, wrap(async (req, res) => {
  const today = dayKey();
  const mine = db().sends.filter((s) => s.userId === req.user.id);
  res.json({
    user: publicUser(req.user),
    rules: rules(),
    global: await globalStock(),
    apiKey: req.user.role === 'client' ? req.user.apiKey || null : null,
    stats: {
      sentToday: mine.filter((s) => s.day === today && s.status === 'success').reduce((a, s) => a + s.likesSent, 0),
      sentTotal: mine.filter((s) => s.status === 'success').reduce((a, s) => a + s.likesSent, 0),
      activeSchedules: db().schedules.filter((x) => x.userId === req.user.id && x.status === 'active').length,
      sendsCount: mine.length,
      pendingOrders: db().orders.filter((o) => o.userId === req.user.id && o.status === 'pending').length,
    },
    settings: { pixKey: db().settings.pixKey, pixHolder: db().settings.pixHolder, contact: db().settings.contact, paymentNote: db().settings.paymentNote },
    mock: config.mock,
  });
}));

// ---------- Jogador ----------
const playerCache = new Map();

app.get('/api/player/:uid', requireAuth, wrap(async (req, res) => {
  const uid = req.params.uid;
  if (!UID_RE.test(uid)) return res.status(400).json({ error: 'ID inválido. Use apenas números.' });
  const cached = playerCache.get(uid);
  if (cached && Date.now() - cached.at < 60000) return res.json(cached.value);
  const raw = await likeApi.player(uid);
  const info = raw?.basicInfo || {};
  const value = {
    uid,
    nickname: info.nickname || null,
    region: info.region || null,
    liked: info.liked ?? null,
    level: info.level ?? null,
    usedToday: uidUsage(uid),
    dailyLimit: config.dailyLimitPerUid,
  };
  playerCache.set(uid, { at: Date.now(), value });
  res.json(value);
}));

// ---------- Envio de likes ----------
// Um único caminho para envio manual, Auto Likes e API pública.
// Retorna { status, body } prontos para responder.
async function performSend(user, targetIdRaw, amountRaw, source = 'manual', scheduleId = null) {
  const targetId = String(targetIdRaw ?? '').trim();
  let amount = toInt(amountRaw);
  const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } });

  if (!UID_RE.test(targetId)) return fail(400, 'Informe um ID válido (somente números).');
  if (!Number.isInteger(amount) || amount < 1 || amount > config.maxPerSend) {
    return fail(400, `A quantidade deve ser entre 1 e ${config.maxPerSend.toLocaleString('pt-BR')} likes.`);
  }
  if (user.status !== 'active') return fail(403, 'Conta desativada pelo administrador.');
  if (isExpired(user)) return fail(403, 'Seu acesso expirou. Renove seu plano com o administrador.');
  if (source !== 'auto' && activeScheduleFor(targetId)) {
    return fail(400, 'Este ID está com Auto Likes ativo. Envios manuais ficam bloqueados enquanto o agendamento estiver em execução.');
  }
  const global = await getBalance();
  if (global.value && global.value.remaining < amount) return fail(400, 'Estoque global insuficiente no momento. Avise o administrador.');

  // A partir daqui não há await até a reserva: checagem e débito são atômicos.
  const isClient = user.role === 'client';
  const used = uidUsage(targetId);
  const left = config.dailyLimitPerUid - used;
  if (source === 'auto' && left > 0 && amount > left) amount = left; // agendamento envia o que ainda cabe hoje
  if (amount > left) {
    return fail(400, left > 0
      ? `Este ID já recebeu ${used.toLocaleString('pt-BR')} likes hoje. Restam ${left.toLocaleString('pt-BR')} para hoje.`
      : 'Este ID já atingiu o limite de 2.000 likes hoje. Tente novamente amanhã.');
  }
  if (isClient && user.stock < amount) {
    return fail(400, `Estoque insuficiente. Você tem ${user.stock.toLocaleString('pt-BR')} likes.`);
  }
  const send = {
    id: nextId('send'), userId: user.id, username: user.username, targetId, amount, likesSent: 0,
    status: 'pending', source, scheduleId, day: dayKey(), createdAt: new Date().toISOString(),
  };
  if (isClient) user.stock -= amount;
  db().sends.push(send);
  save();

  let errorStatus = 502;
  try {
    const r = await likeApi.sendLikes(targetId, amount);
    const sent = Math.max(0, Math.min(amount, Number(r?.likes_sent ?? amount)));
    send.status = 'success';
    send.likesSent = sent;
    send.nickname = r?.player_nickname || null;
    send.remoteLogId = r?.log_id ?? null;
    if (isClient && sent < amount) user.stock += amount - sent;
    updateRemaining(Number(r?.remaining));
  } catch (err) {
    send.status = 'error';
    send.error = err.message;
    errorStatus = err.status === 400 ? 400 : 502;
    if (isClient) user.stock += amount;
  } finally {
    send.finishedAt = new Date().toISOString();
    save();
  }
  if (send.status === 'error') return fail(errorStatus, send.error, { send, stock: user.stock });
  return { status: 200, body: { send, stock: user.stock, usedToday: uidUsage(targetId) } };
}

app.post('/api/send', requireAuth, wrap(async (req, res) => {
  const r = await performSend(req.user, req.body?.target_id, req.body?.amount, 'manual');
  res.status(r.status).json(r.body);
}));

// Histórico com filtros: origem (manual | auto | api) e janela em dias.
app.get('/api/sends', requireAuth, (req, res) => {
  const days = Math.min(90, Math.max(1, toInt(req.query.days) || 30));
  const since = Date.now() - days * 86400000;
  const source = ['manual', 'auto', 'api'].includes(req.query.source) ? req.query.source : null;
  const list = db().sends
    .filter((s) => s.userId === req.user.id && Date.parse(s.createdAt) >= since && (!source || (s.source || 'manual') === source))
    .slice(-500).reverse();
  res.json({ sends: list });
});

// ---------- Auto Likes (agendamentos diários) ----------
const pad = (n) => String(n).padStart(2, '0');
// Horário de Brasília (UTC-3, sem horário de verão desde 2019).
function nextRunFrom(hour, minute, after = Date.now()) {
  let t = Date.parse(`${dayKey(new Date(after))}T${pad(hour)}:${pad(minute)}:00-03:00`);
  while (t <= after) t += 86400000;
  return t;
}
const publicSchedule = (x) => ({ ...x, nextRunAt: x.status === 'active' ? new Date(x.nextRunAt).toISOString() : null });

app.get('/api/schedules', requireAuth, (req, res) => {
  const list = db().schedules.filter((x) => x.userId === req.user.id).slice().reverse().map(publicSchedule);
  res.json({ schedules: list });
});

app.post('/api/schedules', requireAuth, (req, res) => {
  const user = req.user;
  const targetId = String(req.body?.target_id ?? '').trim();
  const perDay = toInt(req.body?.per_day);
  const days = toInt(req.body?.days);
  const hour = toInt(req.body?.hour);
  const minute = toInt(req.body?.minute ?? 0);
  if (!UID_RE.test(targetId)) return res.status(400).json({ error: 'Informe um ID válido (somente números).' });
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > config.dailyLimitPerUid) return res.status(400).json({ error: 'Quantidade por dia deve ser entre 1 e 2.000.' });
  if (!Number.isInteger(days) || days < 1 || days > 30) return res.status(400).json({ error: 'Duração deve ser entre 1 e 30 dias.' });
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return res.status(400).json({ error: 'Horário inválido. Use hora de 0 a 23 e minuto de 0 a 59.' });
  }
  if (isExpired(user)) return res.status(403).json({ error: 'Seu acesso expirou. Renove seu plano com o administrador.' });
  if (activeScheduleFor(targetId)) return res.status(409).json({ error: 'Este ID já tem um Auto Likes ativo.' });
  if (user.role === 'client' && user.stock < perDay) return res.status(400).json({ error: `Estoque insuficiente para o primeiro envio (${perDay.toLocaleString('pt-BR')} likes).` });
  if (db().schedules.filter((x) => x.userId === user.id && x.status === 'active').length >= 20) return res.status(400).json({ error: 'Limite de 20 agendamentos ativos.' });

  const schedule = {
    id: nextId('schedule'), userId: user.id, username: user.username, targetId, perDay, days, hour, minute,
    runsDone: 0, likesSent: 0, status: 'active', nextRunAt: nextRunFrom(hour, minute), lastRun: null, createdAt: new Date().toISOString(),
  };
  db().schedules.push(schedule);
  save();
  res.json({ schedule: publicSchedule(schedule) });
});

app.post('/api/schedules/:id/cancel', requireAuth, (req, res) => {
  const x = db().schedules.find((s) => s.id === Number(req.params.id) && (s.userId === req.user.id || req.user.role === 'admin'));
  if (!x) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (x.status !== 'active') return res.status(400).json({ error: 'Este agendamento já terminou.' });
  x.status = 'canceled';
  save();
  res.json({ schedule: publicSchedule(x) });
});

let schedulerBusy = false;
async function runSchedules() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  try {
    const now = Date.now();
    for (const x of db().schedules.filter((s) => s.status === 'active' && s.nextRunAt <= now)) {
      const user = db().users.find((u) => u.id === x.userId);
      if (!user || user.status !== 'active') { x.status = 'canceled'; continue; }
      const r = await performSend(user, x.targetId, x.perDay, 'auto', x.id);
      x.runsDone += 1;
      x.lastRun = { at: new Date().toISOString(), ok: r.status === 200, sent: r.body.send?.likesSent ?? 0, error: r.status === 200 ? null : r.body.error };
      x.likesSent += x.lastRun.sent;
      if (x.runsDone >= x.days) x.status = 'done';
      else x.nextRunAt = nextRunFrom(x.hour, x.minute, Math.max(now, x.nextRunAt));
    }
  } catch (err) {
    console.error('Erro no Auto Likes:', err);
  } finally {
    save();
    schedulerBusy = false;
  }
}
setInterval(runSchedules, 30000).unref();

// ---------- API pública dos clientes (mesmo formato da documentação) ----------
const apiHits = new Map();
function apiKeyAuth(req, res, next) {
  const key = String(req.get('X-Api-Key') || '');
  const user = key && db().users.find((u) => u.apiKey && u.apiKey.length === key.length && crypto.timingSafeEqual(Buffer.from(u.apiKey), Buffer.from(key)));
  if (!user) return res.status(401).json({ error: 'Header X-Api-Key ausente ou com valor inválido.' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Conta desativada pelo administrador.' });
  if (isExpired(user)) return res.status(403).json({ error: 'Conta com data de expiração ultrapassada. Entre em contato com o suporte.' });
  const minute = Math.floor(Date.now() / 60000);
  const hit = apiHits.get(user.id);
  const count = hit && hit.minute === minute ? hit.count + 1 : 1;
  apiHits.set(user.id, { minute, count });
  if (count > 60) return res.status(429).json({ error: 'Muitas requisições. Limite de 60 por minuto.' });
  req.user = user;
  next();
}

app.post('/api/me/apikey', requireAuth, (req, res) => {
  if (req.user.role !== 'client') return res.status(400).json({ error: 'A API é para contas de cliente.' });
  req.user.apiKey = `ls_${crypto.randomBytes(24).toString('hex')}`;
  save();
  res.json({ apiKey: req.user.apiKey });
});

app.post('/api/v1/likes/send', apiKeyAuth, wrap(async (req, res) => {
  const r = await performSend(req.user, req.body?.target_id, req.body?.amount, 'api');
  if (r.status !== 200) return res.status(r.status === 502 ? 500 : r.status).json({ error: r.body.error });
  const { send, stock } = r.body;
  res.json({ likes_sent: send.likesSent, remaining: stock, player_nickname: send.nickname, log_id: send.id });
}));

app.get('/api/v1/balance', apiKeyAuth, (req, res) => {
  const u = req.user;
  const used = usedTotal(u.id);
  const today = dayKey();
  res.json({
    plan_type: 'stock', remaining: u.stock, stock_limit: used + u.stock, stock_used: used, daily_limit: 0,
    used_today: db().sends.filter((s) => s.userId === u.id && s.day === today && s.status === 'success').reduce((a, s) => a + s.likesSent, 0),
    expiry_date: u.expiresAt || null,
  });
});

app.get('/api/v1/logs', apiKeyAuth, (req, res) => {
  const limit = Math.min(100, Math.max(1, toInt(req.query.limit) || 20));
  const days = Math.min(30, Math.max(1, toInt(req.query.days) || 7));
  const since = Date.now() - days * 86400000;
  const logs = db().sends.filter((s) => s.userId === req.user.id && Date.parse(s.createdAt) >= since && s.status !== 'pending')
    .slice(-limit).reverse()
    .map((s) => ({ log_id: s.id, target_id: s.targetId, likes_sent: s.likesSent, status: s.status === 'success' ? 'success' : 'error', action: SOURCES[s.source || 'manual'], timestamp: s.createdAt.slice(0, 19) }));
  res.json(logs);
});

app.get('/api/v1/player/:uid', apiKeyAuth, wrap(async (req, res) => {
  if (!UID_RE.test(req.params.uid)) return res.status(400).json({ error: 'UID inválido.' });
  try {
    res.json(await likeApi.player(req.params.uid));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar jogador' });
  }
}));

// ---------- Pedidos de estoque ----------
app.post('/api/orders', requireAuth, (req, res) => {
  if (req.user.role !== 'client') return res.status(400).json({ error: 'Admin não precisa comprar estoque.' });
  const likes = toInt(req.body?.likes);
  if (!Number.isInteger(likes) || likes < config.minPurchase) {
    return res.status(400).json({ error: `O mínimo por pedido é ${config.minPurchase.toLocaleString('pt-BR')} likes.` });
  }
  if (likes % config.packSize !== 0) return res.status(400).json({ error: 'A quantidade deve ser múltipla de 2.000 likes.' });
  if (likes > config.maxPurchase) return res.status(400).json({ error: `Máximo de ${config.maxPurchase.toLocaleString('pt-BR')} likes por pedido.` });
  const pending = db().orders.filter((o) => o.userId === req.user.id && o.status === 'pending').length;
  if (pending >= 3) return res.status(400).json({ error: 'Você já tem 3 pedidos aguardando pagamento.' });

  const order = {
    id: nextId('order'), userId: req.user.id, username: req.user.username, likes, priceCents: priceCents(likes),
    status: 'pending', createdAt: new Date().toISOString(),
  };
  db().orders.push(order);
  save();
  res.json({ order });
});

app.get('/api/orders', requireAuth, (req, res) => {
  res.json({ orders: db().orders.filter((o) => o.userId === req.user.id).slice().reverse() });
});

app.post('/api/orders/:id/cancel', requireAuth, (req, res) => {
  const order = db().orders.find((o) => o.id === Number(req.params.id) && o.userId === req.user.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Só é possível cancelar pedidos pendentes.' });
  order.status = 'canceled';
  order.closedAt = new Date().toISOString();
  save();
  res.json({ order });
});

// ---------- Administração ----------
app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
  const today = dayKey();
  const data = db();
  const clients = data.users.filter((u) => u.role === 'client');
  const todaySends = data.sends.filter((s) => s.day === today);
  res.json({
    global: await globalStock(req.query.refresh === '1'),
    rules: rules(),
    counts: {
      clients: clients.filter((u) => u.status !== 'pending').length,
      active: clients.filter((u) => u.status === 'active').length,
      requests: clients.filter((u) => u.status === 'pending').length,
      pendingOrders: data.orders.filter((o) => o.status === 'pending').length,
    },
    today: {
      likes: todaySends.filter((s) => s.status === 'success').reduce((a, s) => a + s.likesSent, 0),
      sends: todaySends.length,
      errors: todaySends.filter((s) => s.status === 'error').length,
    },
    revenueCents: data.orders.filter((o) => o.status === 'paid').reduce((a, o) => a + o.priceCents, 0),
    mock: config.mock,
  });
}));

app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: db().users.filter((u) => u.role === 'client').map(publicUser).reverse() });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, contact, note } = req.body || {};
  const stock = toInt(req.body?.stock ?? 0);
  if (!USERNAME_RE.test(String(username || ''))) return res.status(400).json({ error: 'Usuário deve ter 3–24 caracteres (letras, números, _ . -).' });
  if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  if (findUser(username)) return res.status(409).json({ error: 'Usuário já existe.' });
  if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'Estoque inicial inválido.' });
  const user = {
    id: nextId('user'), username: String(username).trim(), passwordHash: hashPassword(password), role: 'client', status: 'active',
    stock, contact: String(contact || '').slice(0, 120), note: String(note || '').slice(0, 200), createdAt: new Date().toISOString(),
  };
  db().users.push(user);
  save();
  res.json({ user: publicUser(user) });
});

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const user = db().users.find((u) => u.id === Number(req.params.id) && u.role === 'client');
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!['active', 'blocked'].includes(b.status)) return res.status(400).json({ error: 'Status inválido.' });
    user.status = b.status;
    if (b.status === 'blocked') destroyUserSessions(user.id);
  }
  if (b.password !== undefined) {
    if (typeof b.password !== 'string' || b.password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    user.passwordHash = hashPassword(b.password);
    destroyUserSessions(user.id);
  }
  if (b.stockDelta !== undefined) {
    const delta = toInt(b.stockDelta);
    if (!Number.isInteger(delta) || user.stock + delta < 0) return res.status(400).json({ error: 'Ajuste de estoque inválido.' });
    user.stock += delta;
  }
  if (b.expiresAt !== undefined) {
    if (b.expiresAt !== null && !DATE_RE.test(String(b.expiresAt))) return res.status(400).json({ error: 'Data de validade inválida.' });
    user.expiresAt = b.expiresAt || null;
  }
  if (b.note !== undefined) user.note = String(b.note).slice(0, 200);
  if (b.contact !== undefined) user.contact = String(b.contact).slice(0, 120);
  save();
  res.json({ user: publicUser(user) });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const data = db();
  const i = data.users.findIndex((u) => u.id === Number(req.params.id) && u.role === 'client');
  if (i < 0) return res.status(404).json({ error: 'Cliente não encontrado.' });
  destroyUserSessions(data.users[i].id);
  data.users.splice(i, 1);
  save();
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json({ orders: db().orders.slice().reverse().slice(0, 500) });
});

app.post('/api/admin/orders/:id/:action', requireAdmin, wrap(async (req, res) => {
  const order = db().orders.find((o) => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Pedido já finalizado.' });
  const { action } = req.params;

  if (action === 'approve') {
    const user = db().users.find((u) => u.id === order.userId);
    if (!user) return res.status(404).json({ error: 'O cliente deste pedido não existe mais.' });
    const g = await globalStock(true);
    if (g.free != null && order.likes > g.free && !req.body?.force) {
      return res.status(409).json({
        error: `Estoque global livre (${g.free.toLocaleString('pt-BR')}) menor que o pedido (${order.likes.toLocaleString('pt-BR')}). Recarregue a API ou confirme mesmo assim.`,
        needsForce: true,
      });
    }
    user.stock += order.likes;
    order.status = 'paid';
  } else if (action === 'reject') {
    order.status = 'rejected';
  } else {
    return res.status(400).json({ error: 'Ação inválida.' });
  }
  order.closedAt = new Date().toISOString();
  save();
  res.json({ order });
}));

app.post('/api/admin/requests/:id/:action', requireAdmin, (req, res) => {
  const data = db();
  const i = data.users.findIndex((u) => u.id === Number(req.params.id) && u.status === 'pending');
  if (i < 0) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (req.params.action === 'approve') data.users[i].status = 'active';
  else if (req.params.action === 'reject') data.users.splice(i, 1);
  else return res.status(400).json({ error: 'Ação inválida.' });
  save();
  res.json({ ok: true });
});

app.get('/api/admin/sends', requireAdmin, (req, res) => {
  res.json({ sends: db().sends.slice(-500).reverse() });
});

app.get('/api/admin/schedules', requireAdmin, (req, res) => {
  res.json({ schedules: db().schedules.slice().reverse().slice(0, 300).map(publicSchedule) });
});

app.get('/api/admin/remote-logs', requireAdmin, wrap(async (req, res) => {
  const limit = Math.min(100, Math.max(1, toInt(req.query.limit) || 50));
  const days = Math.min(30, Math.max(1, toInt(req.query.days) || 7));
  res.json({ logs: await likeApi.logs(limit, days) });
}));

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ settings: db().settings }));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const s = db().settings;
  for (const key of ['pixKey', 'pixHolder', 'contact', 'paymentNote']) {
    if (req.body?.[key] !== undefined) s[key] = String(req.body[key]).slice(0, 400);
  }
  save();
  res.json({ settings: s });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ---------- Páginas ----------
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three'), { maxAge: '7d', index: false }));
app.get('/app', (req, res) => {
  if (!currentUser(req)) return res.redirect('/#acesso');
  res.sendFile(path.join(root, 'public/app.html'));
});
app.use(express.static(path.join(root, 'public'), { index: 'index.html', extensions: ['html'] }));

// ---------- Erros ----------
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status === 401 || err.status === 403 ? 502 : err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

app.listen(config.port, () => {
  console.log(`LikeSystem rodando em http://localhost:${config.port}`);
  runSchedules();
  if (config.mock) console.log('⚠  MOCK_API=1 — envios simulados, nenhum like real é enviado.');
  else if (!config.apiKey) console.log('⚠  LIKESYSTEM_API_KEY não definida — envios ficarão indisponíveis.');
});
