import path from 'node:path';
import express from 'express';
import { config, root, UID_RE } from './src/config.js';
import { db, load, save, flush, defaultPlans } from './src/db.js';
import { checkLogin, createSession, destroySession, isAdmin, requireAdmin, loginBlocked, loginFailed, loginSucceeded } from './src/auth.js';
import { playerInfo, getBalance, ApiError } from './src/likeapi.js';
import { payments, PaymentError } from './src/payments.js';
import {
  createOrder, markPaid, syncPayment, findOrder, activePlans, publicOrder, adminOrder, adminDelivery, retryDelivery, cancelDelivery,
  manualSend, runDelivery, startJobs, kick, dayKey, brl, usedToday,
} from './src/orders.js';

load();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '32kb' }));
// alterações só em JSON (com SameSite=Strict, bloqueia CSRF)
app.use(['/api', '/admin/api'], (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Envie os dados em JSON.' });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const pub = (f) => path.join(root, 'public', f);
const ipOf = (req) => req.ip || req.socket.remoteAddress || '';

// ---------- limite de requisições por IP (rotas públicas) ----------
const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${ipOf(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

// ---------- páginas ----------
app.get('/', (req, res) => res.sendFile(pub('index.html')));
app.get('/pedido/:code', (req, res) => res.sendFile(pub('pedido.html')));
app.get('/admin', (req, res) => res.sendFile(pub('admin.html')));
app.use(express.static(path.join(root, 'public'), { index: false, extensions: ['html'] }));

// ---------- loja ----------
app.get('/api/config', (req, res) => {
  const s = db().settings;
  res.json({
    siteName: s.siteName, tagline: s.tagline, whatsapp: s.whatsapp, notice: s.notice, likesPerDay: config.likesPerDay, mock: config.mock,
    plans: activePlans().map((p) => ({ id: p.id, name: p.name, days: p.days, priceCents: p.priceCents, price: brl(p.priceCents), tag: p.tag, description: p.description, totalLikes: p.days * config.likesPerDay })),
    paymentsReady: payments.configured(),
  });
});

app.get('/api/player/:uid', rateLimit('player', 30, 60000), wrap(async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!UID_RE.test(uid)) return res.status(400).json({ error: 'ID inválido. Use só números (6 a 12 dígitos).' });
  const p = await playerInfo(uid);
  res.json({ player: p, usedToday: usedToday(uid), likesPerDay: config.likesPerDay });
}));

app.post('/api/orders', rateLimit('orders', 8, 10 * 60000), wrap(async (req, res) => {
  const b = req.body || {};
  const uid = String(b.uid || '').trim();
  if (!UID_RE.test(uid)) return res.status(400).json({ error: 'ID inválido. Use só números (6 a 12 dígitos).' });
  const plan = activePlans().find((p) => p.id === String(b.planId || ''));
  if (!plan) return res.status(400).json({ error: 'Escolha um plano válido.' });
  const contact = String(b.contact || '').trim().slice(0, 80);
  if (!payments.configured()) return res.status(503).json({ error: 'Pagamento PIX ainda não configurado. Fale com o suporte.' });
  const player = await playerInfo(uid); // confirma que o ID existe antes de cobrar
  const order = await createOrder({ uid, nickname: player.nickname, plan, contact, ip: ipOf(req) });
  res.status(201).json({ order: publicOrder(order) });
}));

app.get('/api/orders/:code', wrap(async (req, res) => {
  const o = findOrder(req.params.code);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (o.status === 'pending' && req.query.sync === '1') await syncPayment(o);
  res.json({ order: publicOrder(o), mock: config.mock });
}));

// modo simulado: botão "Simular pagamento"
app.post('/api/orders/:code/simulate', wrap(async (req, res) => {
  if (!config.mock) return res.status(404).json({ error: 'Disponível só no modo simulado.' });
  const o = findOrder(req.params.code);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  payments.simulatePayment(o.providerId);
  await syncPayment(o);
  kick();
  res.json({ order: publicOrder(o) });
}));

// ---------- webhook do Mercado Pago ----------
app.post('/webhooks/mercadopago', wrap(async (req, res) => {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const type = req.query.type || req.body?.type;
  if (!dataId || (type && type !== 'payment')) return res.sendStatus(200);
  if (!payments.verifyWebhook({ signature: req.get('x-signature'), requestId: req.get('x-request-id'), dataId })) return res.sendStatus(401);
  const o = db().orders.find((x) => x.providerId === String(dataId));
  if (o) { await syncPayment(o); kick(); }
  res.sendStatus(200);
}));

// ---------- painel admin ----------
app.post('/admin/api/login', rateLimit('login', 20, 10 * 60000), (req, res) => {
  const key = ipOf(req);
  const blocked = loginBlocked(key);
  if (blocked) return res.status(429).json({ error: `Muitas tentativas. Aguarde ${blocked} min.` });
  const { username, password } = req.body || {};
  if (!checkLogin(username, password)) { loginFailed(key); return res.status(401).json({ error: 'Usuário ou senha incorretos.' }); }
  loginSucceeded(key);
  createSession(res);
  res.json({ ok: true });
});
app.post('/admin/api/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });
app.get('/admin/api/me', (req, res) => res.json({ admin: isAdmin(req), username: config.admin.username }));

app.get('/admin/api/overview', requireAdmin, wrap(async (req, res) => {
  const data = db();
  const today = dayKey();
  const paid = data.orders.filter((o) => o.paidAt);
  const sum = (list) => list.reduce((a, o) => a + o.amountCents, 0);
  const todayPaid = paid.filter((o) => dayKey(Date.parse(o.paidAt)) === today);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400000);
    const list = paid.filter((o) => dayKey(Date.parse(o.paidAt)) === k);
    days.push({ day: k, amount: sum(list), count: list.length });
  }
  const counts = {};
  for (const o of data.orders) counts[o.status] = (counts[o.status] || 0) + 1;
  const sentToday = data.deliveries.filter((d) => d.status === 'sent' && dayKey(Date.parse(d.sentAt)) === today).reduce((a, d) => a + d.likesSent, 0);
  const balance = await getBalance({ force: req.query.refresh === '1' });
  res.json({
    today: { count: todayPaid.length, amount: sum(todayPaid), likes: sentToday },
    total: { count: paid.length, amount: sum(paid), likes: data.deliveries.filter((d) => d.status === 'sent').reduce((a, d) => a + d.likesSent, 0) },
    counts, queued: data.deliveries.filter((d) => d.status === 'queued').length, failed: data.deliveries.filter((d) => d.status === 'failed').length,
    days, balance: balance.value, balanceError: balance.error, provider: payments.name, paymentsReady: payments.configured(), apiReady: config.mock || Boolean(config.likeApi.key), mock: config.mock,
  });
}));

app.get('/admin/api/orders', requireAdmin, (req, res) => {
  const status = String(req.query.status || '');
  const q = String(req.query.q || '').trim().toUpperCase();
  let list = db().orders.slice().reverse();
  if (status) list = list.filter((o) => o.status === status);
  if (q) list = list.filter((o) => o.code.includes(q) || o.uid.includes(q) || (o.nickname || '').toUpperCase().includes(q) || (o.contact || '').toUpperCase().includes(q));
  res.json({ orders: list.slice(0, 300).map(adminOrder), total: list.length });
});

app.post('/admin/api/orders/:code/confirm', requireAdmin, wrap(async (req, res) => {
  const o = findOrder(req.params.code);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (!markPaid(o, 'manual')) return res.status(409).json({ error: 'Esse pedido não está aguardando pagamento.' });
  kick();
  res.json({ order: adminOrder(o) });
}));

app.post('/admin/api/orders/:code/cancel', requireAdmin, (req, res) => {
  const o = findOrder(req.params.code);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (!['pending', 'expired'].includes(o.status)) return res.status(409).json({ error: 'Só é possível cancelar pedidos não pagos.' });
  o.status = 'cancelled';
  save();
  res.json({ order: adminOrder(o) });
});

app.get('/admin/api/deliveries', requireAdmin, (req, res) => {
  const status = String(req.query.status || '');
  let list = db().deliveries.slice().reverse();
  if (status) list = list.filter((d) => d.status === status);
  if (status === 'queued') list.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  res.json({ deliveries: list.slice(0, 300).map(adminDelivery), total: list.length });
});

app.post('/admin/api/deliveries/:id/retry', requireAdmin, wrap(async (req, res) => {
  const d = db().deliveries.find((x) => x.id === Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Envio não encontrado.' });
  if (!['failed', 'queued'].includes(d.status)) return res.status(409).json({ error: 'Esse envio já foi concluído.' });
  retryDelivery(d);
  await runDelivery(d);
  res.json({ delivery: adminDelivery(d) });
}));

app.post('/admin/api/deliveries/:id/cancel', requireAdmin, (req, res) => {
  const d = db().deliveries.find((x) => x.id === Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Envio não encontrado.' });
  if (!cancelDelivery(d)) return res.status(409).json({ error: 'Só envios na fila podem ser cancelados.' });
  res.json({ delivery: adminDelivery(d) });
});

app.post('/admin/api/send', requireAdmin, wrap(async (req, res) => {
  const uid = String(req.body?.uid || '').trim();
  const amount = Number(req.body?.amount);
  if (!UID_RE.test(uid)) return res.status(400).json({ error: 'ID inválido. Use só números (6 a 12 dígitos).' });
  if (!Number.isInteger(amount) || amount < 1 || amount > config.maxPerSend) return res.status(400).json({ error: `Quantidade entre 1 e ${config.maxPerSend}.` });
  const player = await playerInfo(uid);
  const d = await manualSend(uid, amount, player.nickname);
  res.json({ delivery: adminDelivery(d) });
}));

app.get('/admin/api/player/:uid', requireAdmin, wrap(async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  if (!UID_RE.test(uid)) return res.status(400).json({ error: 'ID inválido.' });
  res.json({ player: await playerInfo(uid), usedToday: usedToday(uid) });
}));

app.get('/admin/api/settings', requireAdmin, (req, res) => res.json({ settings: db().settings, likesPerDay: config.likesPerDay }));

app.put('/admin/api/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = db().settings;
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const siteName = str(b.siteName, 40);
  if (!siteName) return res.status(400).json({ error: 'Informe o nome do site.' });
  const plans = Array.isArray(b.plans) ? b.plans : null;
  if (!plans || !plans.length || plans.length > 8) return res.status(400).json({ error: 'Cadastre de 1 a 8 planos.' });
  const clean = [];
  const ids = new Set();
  for (const p of plans) {
    const id = str(p.id, 20).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const name = str(p.name, 40);
    const days = Number(p.days);
    const priceCents = Math.round(Number(p.priceCents));
    if (!id || ids.has(id)) return res.status(400).json({ error: 'Cada plano precisa de um código único (letras e números).' });
    if (!name) return res.status(400).json({ error: 'Cada plano precisa de um nome.' });
    if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ error: `Plano "${name}": dias entre 1 e 365.` });
    if (!Number.isInteger(priceCents) || priceCents < 100) return res.status(400).json({ error: `Plano "${name}": preço mínimo R$ 1,00.` });
    ids.add(id);
    clean.push({ id, name, days, priceCents, tag: str(p.tag, 20), description: str(p.description, 140), active: Boolean(p.active) });
  }
  if (!clean.some((p) => p.active)) return res.status(400).json({ error: 'Deixe pelo menos um plano ativo.' });
  Object.assign(s, { siteName, tagline: str(b.tagline, 120), whatsapp: str(b.whatsapp, 20).replace(/\D/g, ''), notice: str(b.notice, 200), plans: clean });
  save();
  res.json({ settings: s });
});

app.post('/admin/api/settings/reset-plans', requireAdmin, (req, res) => {
  db().settings.plans = defaultPlans();
  save();
  res.json({ settings: db().settings });
});

// ---------- erros ----------
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin/api')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.status(404).sendFile(pub('404.html'));
});
app.use((err, req, res, next) => {
  if (err instanceof ApiError || err instanceof PaymentError) return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Dados grandes demais.' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

startJobs();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { flush(); } finally { process.exit(0); } });

app.listen(config.port, () => {
  console.log(`${db().settings.siteName} rodando em http://localhost:${config.port}${config.mock ? '  [MODO SIMULADO]' : ''}`);
  if (!config.mock && !config.likeApi.key) console.warn('Aviso: LIKE_API_KEY não definida — os envios vão falhar.');
  if (!config.mock && !config.mp.accessToken) console.warn('Aviso: MP_ACCESS_TOKEN não definido — não é possível gerar PIX.');
});
