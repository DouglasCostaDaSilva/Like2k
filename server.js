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

// Rotas que alteram dados só aceitam JSON (junto com SameSite=Strict, bloqueia CSRF por formulário).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Envie os dados em JSON.' });
  next();
});

// ---------- Utilidades ----------
const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,24}$/;
const UID_RE = /^\d{5,15}$/;
const toInt = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

const publicUser = (u) => ({
  id: u.id, username: u.username, role: u.role, status: u.status, stock: u.stock,
  contact: u.contact || '', note: u.note || '', createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
});

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
    stats: {
      sentToday: mine.filter((s) => s.day === today && s.status === 'success').reduce((a, s) => a + s.likesSent, 0),
      sentTotal: mine.filter((s) => s.status === 'success').reduce((a, s) => a + s.likesSent, 0),
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
app.post('/api/send', requireAuth, wrap(async (req, res) => {
  const user = req.user;
  const targetId = String(req.body?.target_id ?? '').trim();
  const amount = toInt(req.body?.amount);

  if (!UID_RE.test(targetId)) return res.status(400).json({ error: 'Informe um ID válido (somente números).' });
  if (!Number.isInteger(amount) || amount < 1 || amount > config.maxPerSend) {
    return res.status(400).json({ error: `A quantidade deve ser entre 1 e ${config.maxPerSend.toLocaleString('pt-BR')} likes.` });
  }
  const global = await getBalance();
  if (global.value && global.value.remaining < amount) return res.status(400).json({ error: 'Estoque global insuficiente no momento. Avise o administrador.' });

  // A partir daqui não há await até a reserva: checagem e débito são atômicos.
  const isClient = user.role === 'client';
  if (isClient && user.stock < amount) {
    return res.status(400).json({ error: `Estoque individual insuficiente. Você tem ${user.stock.toLocaleString('pt-BR')} likes.` });
  }
  const used = uidUsage(targetId);
  const left = config.dailyLimitPerUid - used;
  if (amount > left) {
    return res.status(400).json({
      error: left > 0
        ? `Este ID já recebeu ${used.toLocaleString('pt-BR')} likes hoje. Restam ${left.toLocaleString('pt-BR')} para hoje.`
        : 'Este ID já atingiu o limite de 2.000 likes hoje. Tente novamente amanhã.',
    });
  }
  // Reserva síncrona (sem await entre checagem e débito) evita gasto duplo em envios simultâneos.
  const send = {
    id: nextId('send'), userId: user.id, username: user.username, targetId, amount, likesSent: 0,
    status: 'pending', day: dayKey(), createdAt: new Date().toISOString(),
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

  if (send.status === 'error') return res.status(errorStatus).json({ error: send.error, send, stock: user.stock });
  res.json({ send, stock: user.stock, usedToday: uidUsage(targetId) });
}));

app.get('/api/sends', requireAuth, (req, res) => {
  const list = db().sends.filter((s) => s.userId === req.user.id).slice(-200).reverse();
  res.json({ sends: list });
});

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
  if (config.mock) console.log('⚠  MOCK_API=1 — envios simulados, nenhum like real é enviado.');
  else if (!config.apiKey) console.log('⚠  LIKESYSTEM_API_KEY não definida — envios ficarão indisponíveis.');
});
