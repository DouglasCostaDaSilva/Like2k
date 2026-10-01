import path from 'node:path';
import express from 'express';
import { config, root, UID_RE, SERVERS, SERVER_CODES } from './src/config.js';
import { db, load, save, flush } from './src/db.js';
import { checkLogin, createSession, destroySession, isAdmin, requireAdmin, loginBlocked, loginFailed, loginSucceeded } from './src/auth.js';
import { likeApi, getStatus, ApiError } from './src/likeapi.js';
import { sendLikes, historyOf, receivedToday, totalGiven, publicSend, adminSend, dayKey } from './src/sends.js';

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
const enabledServers = () => SERVERS.filter((s) => db().settings.servers.includes(s.code));
function parseTarget(b) {
  const uid = String(b.uid || '').trim();
  const server = String(b.server || db().settings.defaultServer || 'BR').trim().toUpperCase();
  if (!UID_RE.test(uid)) throw new ApiError(400, 'ID inválido. Use só números (6 a 12 dígitos).');
  if (!enabledServers().some((s) => s.code === server)) throw new ApiError(400, 'Região inválida.');
  return { uid, server };
}

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
app.get('/admin', (req, res) => res.sendFile(pub('admin.html')));
app.use(express.static(path.join(root, 'public'), { index: false, extensions: ['html'] }));

// ---------- site de acompanhamento ----------
app.get('/api/config', (req, res) => {
  const s = db().settings;
  res.json({ siteName: s.siteName, tagline: s.tagline, whatsapp: s.whatsapp, notice: s.notice, publicSend: s.publicSend, defaultServer: s.defaultServer, servers: enabledServers(), mock: config.mock });
});

app.get('/api/player', rateLimit('player', 30, 60000), wrap(async (req, res) => {
  const { uid, server } = parseTarget(req.query);
  const player = await likeApi.info(uid, server);
  res.json({ player, history: historyOf(uid).map(publicSend), receivedToday: receivedToday(uid), totalGiven: totalGiven(uid) });
}));

app.post('/api/send', rateLimit('send', 6, 10 * 60000), wrap(async (req, res) => {
  if (!db().settings.publicSend) return res.status(403).json({ error: 'O envio pelo site está desativado no momento.' });
  const { uid, server } = parseTarget(req.body || {});
  if (receivedToday(uid)) return res.status(429).json({ error: 'Esse ID já recebeu likes hoje. Volte amanhã.' });
  const rec = await sendLikes({ uid, server, by: 'site', ip: ipOf(req) });
  res.json({ send: publicSend(rec), history: historyOf(uid).map(publicSend), totalGiven: totalGiven(uid) });
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
  const sends = db().sends;
  const today = dayKey();
  const todayList = sends.filter((s) => dayKey(Date.parse(s.at)) === today);
  const sum = (list) => list.reduce((a, s) => a + (s.given || 0), 0);
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400000);
    const list = sends.filter((s) => dayKey(Date.parse(s.at)) === k);
    days.push({ day: k, likes: sum(list), count: list.length });
  }
  const counts = {};
  for (const s of sends) counts[s.status] = (counts[s.status] || 0) + 1;
  const status = await getStatus({ force: req.query.refresh === '1' });
  res.json({
    today: { count: todayList.length, likes: sum(todayList), ok: todayList.filter((s) => s.status === 'ok').length },
    total: { count: sends.length, likes: sum(sends), uids: new Set(sends.filter((s) => s.given > 0).map((s) => s.uid)).size },
    counts, days, api: status.value, apiError: status.error, apiUrl: config.likeApi.base, mock: config.mock, publicSend: db().settings.publicSend,
  });
}));

app.get('/admin/api/sends', requireAdmin, (req, res) => {
  const status = String(req.query.status || '');
  const q = String(req.query.q || '').trim().toUpperCase();
  let list = db().sends.slice().reverse();
  if (status) list = list.filter((s) => s.status === status);
  if (q) list = list.filter((s) => s.uid.includes(q) || (s.nickname || '').toUpperCase().includes(q) || s.server.includes(q));
  res.json({ sends: list.slice(0, 300).map(adminSend), total: list.length });
});

app.get('/admin/api/player', requireAdmin, wrap(async (req, res) => {
  const { uid, server } = parseTarget(req.query);
  const player = await likeApi.info(uid, server);
  res.json({ player, receivedToday: receivedToday(uid), totalGiven: totalGiven(uid), history: historyOf(uid, 10).map(adminSend) });
}));

app.post('/admin/api/send', requireAdmin, wrap(async (req, res) => {
  const { uid, server } = parseTarget(req.body || {});
  const rec = await sendLikes({ uid, server, by: 'admin', ip: ipOf(req) });
  res.json({ send: adminSend(rec) });
}));

app.post('/admin/api/reset-limit', requireAdmin, wrap(async (req, res) => {
  res.json(await likeApi.resetLimit());
}));

app.get('/admin/api/settings', requireAdmin, (req, res) => res.json({ settings: db().settings, allServers: SERVERS }));

app.put('/admin/api/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = db().settings;
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const siteName = str(b.siteName, 40);
  if (!siteName) return res.status(400).json({ error: 'Informe o nome do site.' });
  const servers = Array.isArray(b.servers) ? b.servers.map((x) => String(x).toUpperCase()).filter((x) => SERVER_CODES.includes(x)) : s.servers;
  if (!servers.length) return res.status(400).json({ error: 'Deixe pelo menos uma região ativa.' });
  const defaultServer = String(b.defaultServer || s.defaultServer).toUpperCase();
  if (!servers.includes(defaultServer)) return res.status(400).json({ error: 'A região padrão precisa estar ativa.' });
  Object.assign(s, { siteName, tagline: str(b.tagline, 140), whatsapp: str(b.whatsapp, 20).replace(/\D/g, ''), notice: str(b.notice, 200), publicSend: Boolean(b.publicSend), defaultServer, servers });
  save();
  res.json({ settings: s });
});

// ---------- erros ----------
app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin/api')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.status(404).sendFile(pub('404.html'));
});
app.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Dados grandes demais.' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { flush(); } finally { process.exit(0); } });

app.listen(config.port, () => {
  console.log(`${db().settings.siteName} rodando em http://localhost:${config.port}${config.mock ? '  [MODO SIMULADO]' : `  (API: ${config.likeApi.base})`}`);
});
