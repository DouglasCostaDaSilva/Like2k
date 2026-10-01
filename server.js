import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { config, feeFor, root } from './src/config.js';
import { db, load, save, nextId } from './src/db.js';
import { provider, ProviderError } from './src/mercadopago.js';
import { asSeller, saveConnection, disconnect, isConnected, connectionOut } from './src/connection.js';
import { enqueue, newWebhookSecret, processDeliveries, deliverNow } from './src/webhooks.js';
import {
  hashPassword, verifyPassword, findLogin, ensureAdmin, createSession, destroySession, destroyUserSessions,
  requireAuth, requireMerchant, requireAdmin, ensureClientId, issueCredentials, revokeSecret, userByCredentials, loginBlocked, loginFailed, loginSucceeded,
} from './src/auth.js';

load();
ensureAdmin();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (!req.path.startsWith('/pay/')) res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/v1', (req, res, next) => apiEnvelope(req, res, next));
app.use(express.json({ limit: '64kb' }));

// Painel: alterações só em JSON (com SameSite=Strict, bloqueia CSRF). A API /v1 usa chave, sem cookie.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Envie os dados em JSON.' });
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const now = () => new Date().toISOString();
const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(d);
const toInt = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- CPF / CNPJ ----------
function validDocument(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (/^(\d)\1+$/.test(d)) return false;
  if (d.length === 11) {
    const calc = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    const calc = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

// webhook do lojista: https público (http só em testes), sem endereços internos
function validWebhookUrl(raw) {
  if (!raw) return true;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' && !(config.mock && u.protocol === 'http:')) return false;
  const h = u.hostname.toLowerCase();
  if (config.mock) return true;
  return !(h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(h) || h.includes(':'));
}

// ---------- totais (o dinheiro não passa pelo Zyropay: cai direto na conta Mercado Pago do lojista) ----------
function totalsOf(merchantId, sinceMs = 0) {
  const t = { count: 0, gross: 0, fees: 0, net: 0 };
  for (const c of db().charges) {
    if (c.merchantId !== merchantId || c.status !== 'paid' || (sinceMs && Date.parse(c.paidAt) < sinceMs)) continue;
    t.count += 1; t.gross += c.amount; t.fees += c.fee; t.net += c.net;
  }
  return t;
}

// ---------- formatos públicos ----------
const merchantName = (id) => db().users.find((u) => u.id === id)?.name || 'Lojista';

const chargeOut = (c) => ({
  id: c.id, status: c.status, amount: c.amount, fee: c.fee, net_amount: c.net, description: c.description,
  external_id: c.externalId, payer: c.payer, pix: { copy_paste: c.qrCode },
  checkout_url: `${config.publicUrl}/pay/${c.id}`, expires_at: c.expiresAt, paid_at: c.paidAt, created_at: c.createdAt,
});

const publicUser = (u) => ({
  id: u.id, role: u.role, status: u.status, name: u.name, email: u.email, username: u.username || null, document: u.document || '',
  phone: u.phone || '', mercadopago: connectionOut(u), webhookUrl: u.webhookUrl || '', hasWebhookSecret: Boolean(u.webhookSecret),
  feePercent: u.feePercent ?? config.feePercent, feeMinCents: u.feeMinCents ?? config.feeMinCents,
  createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
});

const qrCache = new Map();
async function qrImage(c) {
  if (c.qrCodeBase64) return c.qrCodeBase64;
  if (!c.qrCode) return null;
  if (!qrCache.has(c.id)) qrCache.set(c.id, await QRCode.toDataURL(c.qrCode, { margin: 1, width: 360, errorCorrectionLevel: 'M' }));
  return qrCache.get(c.id);
}

// ---------- cobranças ----------
async function createCharge(merchant, input, idemKey) {
  if (idemKey) {
    const prev = db().idempotency[`${merchant.id}:${idemKey}`];
    if (prev) { const c = db().charges.find((x) => x.id === prev); if (c) return { status: 200, charge: c }; }
  }
  const amount = toInt(input.amount);
  if (!Number.isInteger(amount) || amount < config.minChargeCents || amount > config.maxChargeCents) {
    return { status: 400, error: `amount deve ser um inteiro em centavos entre ${config.minChargeCents} (${brl(config.minChargeCents)}) e ${config.maxChargeCents} (${brl(config.maxChargeCents)}).` };
  }
  const expiresIn = input.expires_in == null ? config.defaultExpiresMin * 60 : toInt(input.expires_in);
  if (!Number.isInteger(expiresIn) || expiresIn < 300 || expiresIn > 86400) return { status: 400, error: 'expires_in deve ser entre 300 e 86400 segundos.' };
  const payer = input.payer && typeof input.payer === 'object' ? input.payer : {};
  if (payer.email && !EMAIL_RE.test(String(payer.email))) return { status: 400, error: 'payer.email inválido.' };
  if (payer.document && !validDocument(payer.document)) return { status: 400, error: 'payer.document (CPF ou CNPJ) inválido.' };

  if (!isConnected(merchant)) {
    return merchant.mp
      ? { status: 409, code: 'mercadopago_reconnect', error: 'A conexão com o Mercado Pago precisa ser refeita. Conecte a conta de novo em Painel › Integração.' }
      : { status: 409, code: 'mercadopago_not_connected', error: 'Conecte sua conta Mercado Pago em Painel › Integração para criar cobranças.' };
  }
  const fee = feeFor(amount, merchant);
  const charge = {
    id: `ch_${crypto.randomBytes(10).toString('hex')}`, seq: nextId('charge'), merchantId: merchant.id,
    amount, fee, net: amount - fee, description: String(input.description || '').slice(0, 140) || null,
    externalId: input.external_id ? String(input.external_id).slice(0, 80) : null,
    payer: { name: payer.name ? String(payer.name).slice(0, 80) : null, email: payer.email ? String(payer.email).slice(0, 120) : null, document: payer.document ? String(payer.document).replace(/\D/g, '') : null },
    status: 'pending', provider: provider.name, mpAccount: merchant.mp.userId, providerId: null, qrCode: null, qrCodeBase64: null,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), paidAt: null, createdAt: now(),
  };
  try {
    const p = await asSeller(merchant, (token) => provider.createPix({ token, chargeId: charge.seq, amountCents: amount, feeCents: fee, description: charge.description, payer: charge.payer, expiresAt: Date.parse(charge.expiresAt) }));
    Object.assign(charge, { providerId: p.providerId, qrCode: p.qrCode, qrCodeBase64: p.qrCodeBase64 });
  } catch (err) {
    return { status: err.status || 502, error: err.message, ...(err.code ? { code: err.code } : {}) };
  }
  db().charges.push(charge);
  if (idemKey) db().idempotency[`${merchant.id}:${idemKey}`] = charge.id;
  save();
  enqueue(merchant, 'charge.created', chargeOut(charge));
  return { status: 201, charge };
}

function markPaid(charge, info = {}) {
  if (charge.status === 'paid' || charge.status === 'refunded') return false;
  charge.status = 'paid';
  charge.paidAt = info.paidAt || now();
  if (info.payerName && !charge.payer.name) charge.payer.name = info.payerName;
  save();
  const merchant = db().users.find((u) => u.id === charge.merchantId);
  enqueue(merchant, 'charge.paid', chargeOut(charge));
  return true;
}

function markStatus(charge, status) {
  if (charge.status === status) return;
  charge.status = status;
  save();
  const merchant = db().users.find((u) => u.id === charge.merchantId);
  enqueue(merchant, `charge.${status}`, chargeOut(charge));
}

// deep: também reconfere cobranças pagas (para perceber devolução feita direto no Mercado Pago)
async function syncCharge(charge, { deep = false } = {}) {
  if (!charge.providerId || (charge.status !== 'pending' && !(deep && charge.status === 'paid'))) return charge;
  charge.lastSyncAt = Date.now();
  try {
    const merchant = db().users.find((u) => u.id === charge.merchantId);
    const s = await asSeller(merchant, (token) => provider.getStatus(token, charge.providerId));
    if (s.status === 'paid') markPaid(charge, s);
    else if (s.status === 'refunded' || (s.status === 'failed' && charge.status === 'pending')) markStatus(charge, s.status);
  } catch { /* tenta de novo no próximo ciclo */ }
  if (charge.status === 'pending' && Date.parse(charge.expiresAt) < Date.now()) {
    markStatus(charge, 'expired');
    cancelAtProvider(charge);
  }
  return charge;
}

// cancela no Mercado Pago (melhor esforço: a cobrança já está encerrada no Zyropay)
function cancelAtProvider(charge) {
  const merchant = db().users.find((u) => u.id === charge.merchantId);
  return asSeller(merchant, (token) => provider.cancel(token, charge.providerId)).catch(() => {});
}

// confere cobranças pendentes periodicamente (garantia caso a notificação do Mercado Pago não chegue)
let syncing = false;
async function syncPending() {
  if (syncing) return;
  syncing = true;
  try {
    const due = db().charges.filter((c) => c.status === 'pending' && (!c.lastSyncAt || Date.now() - c.lastSyncAt > 30000)).slice(0, 25);
    for (const c of due) await syncCharge(c);
  } finally {
    syncing = false;
  }
}
setInterval(syncPending, 15000).unref();
setInterval(processDeliveries, 5000).unref();

// ---------- autenticação ----------
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, document, phone } = req.body || {};
  if (!name || String(name).trim().length < 3) return res.status(400).json({ error: 'Informe o nome da empresa ou seu nome completo.' });
  if (!EMAIL_RE.test(String(email || ''))) return res.status(400).json({ error: 'E-mail inválido.' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (!validDocument(document)) return res.status(400).json({ error: 'CPF ou CNPJ inválido.' });
  if (findLogin(email)) return res.status(409).json({ error: 'Já existe uma conta com este e-mail.' });
  if (db().users.filter((u) => u.status === 'pending').length >= 500) return res.status(429).json({ error: 'Muitos cadastros em análise. Tente mais tarde.' });
  db().users.push({
    id: nextId('user'), role: 'merchant', status: 'pending', name: String(name).trim().slice(0, 80), email: String(email).trim().toLowerCase(),
    passwordHash: hashPassword(password), document: String(document).replace(/\D/g, ''), phone: String(phone || '').slice(0, 30),
    webhookUrl: '', webhookSecret: newWebhookSecret(), createdAt: now(),
  });
  ensureClientId(db().users.at(-1));
  save();
  res.json({ ok: true, message: 'Cadastro enviado! Avisaremos assim que sua conta for aprovada.' });
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body || {};
  const key = `${req.ip}|${String(login || '').toLowerCase()}`;
  const blocked = loginBlocked(key);
  if (blocked) return res.status(429).json({ error: `Muitas tentativas. Aguarde ${blocked} min.` });
  const user = findLogin(login);
  if (!user || !verifyPassword(password, user.passwordHash)) { loginFailed(key); return res.status(401).json({ error: 'E-mail ou senha incorretos.' }); }
  if (user.status === 'pending') return res.status(403).json({ error: 'Sua conta ainda está em análise. Avisaremos quando for aprovada.' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Conta bloqueada. Fale com o suporte.' });
  loginSucceeded(key);
  user.lastLoginAt = now();
  createSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => { destroySession(req, res); res.json({ ok: true }); });

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), mock: config.mock, publicUrl: config.publicUrl, mpConfigured: provider.configured(), limits: { minCharge: config.minChargeCents, maxCharge: config.maxChargeCents } });
});

// ---------- checkout público ----------
app.get('/api/public/charges/:id', wrap(async (req, res) => {
  const c = db().charges.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Cobrança não encontrada.' });
  if (c.status === 'pending' && (!c.lastSyncAt || Date.now() - c.lastSyncAt > 5000)) await syncCharge(c);
  res.json({
    id: c.id, merchant: merchantName(c.merchantId), amount: c.amount, description: c.description, status: c.status,
    copyPaste: c.status === 'pending' ? c.qrCode : null, qrImage: c.status === 'pending' ? await qrImage(c) : null,
    expiresAt: c.expiresAt, paidAt: c.paidAt, createdAt: c.createdAt, mock: config.mock,
  });
}));

app.post('/api/public/charges/:id/simulate', (req, res) => {
  if (!config.mock) return res.status(404).json({ error: 'Rota não encontrada.' });
  const c = db().charges.find((x) => x.id === req.params.id);
  if (!c || c.status !== 'pending') return res.status(400).json({ error: 'Cobrança não está pendente.' });
  provider.simulatePayment(c.providerId);
  markPaid(c, { payerName: 'Pagador Teste' });
  res.json({ ok: true });
});

// ---------- painel do lojista ----------
app.get('/api/merchant/overview', requireMerchant, (req, res) => {
  const mine = db().charges.filter((c) => c.merchantId === req.user.id);
  const today = dayKey();
  const paid = mine.filter((c) => c.status === 'paid');
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86400000));
    const list = paid.filter((c) => dayKey(new Date(c.paidAt)) === k);
    days.push({ day: k, amount: list.reduce((a, c) => a + c.amount, 0), count: list.length });
  }
  const todayPaid = paid.filter((c) => dayKey(new Date(c.paidAt)) === today);
  const closed = mine.filter((c) => c.status !== 'pending');
  res.json({
    totals: totalsOf(req.user.id),
    last30: totalsOf(req.user.id, Date.now() - 30 * 86400000),
    mercadopago: connectionOut(req.user),
    today: { amount: todayPaid.reduce((a, c) => a + c.amount, 0), count: todayPaid.length },
    conversion: closed.length ? Math.round((paid.length / closed.length) * 100) : null,
    pending: mine.filter((c) => c.status === 'pending').length,
    days,
    recent: mine.slice(-6).reverse().map(chargeOut),
  });
});

app.get('/api/merchant/charges', requireMerchant, (req, res) => {
  const status = String(req.query.status || '');
  const q = String(req.query.q || '').trim().toLowerCase();
  const days = Math.min(365, Math.max(1, toInt(req.query.days) || 30));
  const since = Date.now() - days * 86400000;
  const list = db().charges.filter((c) => c.merchantId === req.user.id && Date.parse(c.createdAt) >= since && (!status || c.status === status)
    && (!q || [c.id, c.description, c.externalId, c.payer.name, c.payer.email].some((v) => v && String(v).toLowerCase().includes(q))));
  res.json({ charges: list.slice(-500).reverse().map(chargeOut), total: list.filter((c) => c.status === 'paid').reduce((a, c) => a + c.amount, 0) });
});

app.post('/api/merchant/charges', requireMerchant, wrap(async (req, res) => {
  const r = await createCharge(req.user, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.status(201).json({ charge: chargeOut(r.charge), qrImage: await qrImage(r.charge) });
}));

app.get('/api/merchant/charges/:id', requireMerchant, wrap(async (req, res) => {
  const c = db().charges.find((x) => x.id === req.params.id && x.merchantId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Cobrança não encontrada.' });
  await syncCharge(c);
  const events = db().deliveries.filter((d) => d.payload?.data?.id === c.id).map((d) => ({ event: d.event, status: d.status, attempts: d.attempts, lastCode: d.lastCode, lastError: d.lastError, at: d.lastAttemptAt || d.createdAt }));
  res.json({ charge: chargeOut(c), qrImage: c.status === 'pending' ? await qrImage(c) : null, webhooks: events });
}));

app.post('/api/merchant/charges/:id/cancel', requireMerchant, wrap(async (req, res) => {
  const c = db().charges.find((x) => x.id === req.params.id && x.merchantId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Cobrança não encontrada.' });
  if (c.status !== 'pending') return res.status(400).json({ error: 'Só é possível cancelar cobranças pendentes.' });
  await cancelAtProvider(c);
  markStatus(c, 'canceled');
  res.json({ charge: chargeOut(c) });
}));

app.post('/api/merchant/charges/:id/simulate', requireMerchant, (req, res) => {
  if (!config.mock) return res.status(404).json({ error: 'Rota não encontrada.' });
  const c = db().charges.find((x) => x.id === req.params.id && x.merchantId === req.user.id);
  if (!c || c.status !== 'pending') return res.status(400).json({ error: 'Cobrança não está pendente.' });
  provider.simulatePayment(c.providerId);
  markPaid(c, { payerName: 'Pagador Teste' });
  res.json({ charge: chargeOut(c) });
});

// ---------- conexão com o Mercado Pago (OAuth) ----------
// O callback chega por navegação vinda do Mercado Pago (cookie SameSite=Strict não vai junto),
// então quem conecta é identificado pelo "state" aleatório, de uso único e válido por 10 minutos.
const oauthStates = new Map();
setInterval(() => { for (const [k, v] of oauthStates) if (v.expires < Date.now()) oauthStates.delete(k); }, 60000).unref();

app.post('/api/merchant/mercadopago/connect', requireMerchant, (req, res) => {
  if (!provider.configured()) return res.status(503).json({ error: 'O Mercado Pago ainda não foi configurado neste Zyropay (MP_CLIENT_ID e MP_CLIENT_SECRET).' });
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { userId: req.user.id, expires: Date.now() + 10 * 60000 });
  res.json({ url: provider.authorizeUrl(state) });
});

app.get('/oauth/mercadopago/callback', wrap(async (req, res) => {
  const back = (q) => res.redirect(`/app?mp=${q}#integration`);
  const st = oauthStates.get(String(req.query.state || ''));
  oauthStates.delete(String(req.query.state || ''));
  const user = st && st.expires > Date.now() ? db().users.find((u) => u.id === st.userId && u.role === 'merchant' && u.status === 'active') : null;
  if (!user) return res.redirect('/entrar');
  if (req.query.error || !req.query.code) return back('cancelled');
  try {
    const t = await provider.exchangeCode(String(req.query.code));
    saveConnection(user, t, await provider.profile(t.accessToken));
    return back('ok');
  } catch (err) {
    console.error('oauth mercadopago:', err.message);
    return back('error');
  }
}));

app.get('/api/merchant/mercadopago', requireMerchant, (req, res) => res.json({ ...connectionOut(req.user), configured: provider.configured() }));

app.delete('/api/merchant/mercadopago', requireMerchant, (req, res) => {
  if (!verifyPassword(req.body?.password, req.user.passwordHash)) return res.status(400).json({ error: 'Senha incorreta.' });
  disconnect(req.user);
  res.json(connectionOut(req.user));
});

// exportação para conciliação (CSV)
app.get('/api/merchant/export.csv', requireMerchant, (req, res) => {
  const days = Math.min(365, Math.max(1, toInt(req.query.days) || 30));
  const status = String(req.query.status || '');
  const since = Date.now() - days * 86400000;
  const cell = (v) => { const t = v == null ? '' : String(v); return /[";,\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = db().charges.filter((c) => c.merchantId === req.user.id && Date.parse(c.createdAt) >= since && (!status || c.status === status));
  const money = (c) => (c / 100).toFixed(2).replace('.', ',');
  const lines = [['id', 'status', 'criada_em', 'paga_em', 'valor_brl', 'taxa_zyropay_brl', 'liquido_brl', 'external_id', 'descricao', 'pagador_nome', 'pagador_email'].join(';')];
  for (const c of rows) lines.push([c.id, c.status, c.createdAt, c.paidAt, money(c.amount), money(c.fee), money(c.net), c.externalId, c.description, c.payer?.name, c.payer?.email].map(cell).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="zyropay-cobrancas-${dayKey()}.csv"`);
  res.send('\ufeff' + lines.join('\r\n'));
});

app.put('/api/merchant/settings', requireMerchant, (req, res) => {
  const u = req.user, b = req.body || {};
  if (b.webhookUrl !== undefined) {
    const url = String(b.webhookUrl).trim();
    if (!validWebhookUrl(url)) return res.status(400).json({ error: 'URL de webhook inválida. Use um endereço https público.' });
    u.webhookUrl = url;
  }
  if (b.phone !== undefined) u.phone = String(b.phone).slice(0, 30);
  if (b.name !== undefined && String(b.name).trim().length >= 3) u.name = String(b.name).trim().slice(0, 80);
  if (b.newPassword !== undefined) {
    if (!verifyPassword(b.currentPassword, u.passwordHash)) return res.status(400).json({ error: 'Senha atual incorreta.' });
    if (String(b.newPassword).length < 8) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
    u.passwordHash = hashPassword(b.newPassword);
  }
  save();
  res.json({ user: publicUser(u) });
});

const credentialsOut = (u) => {
  const c = u.credentials || {};
  return {
    clientId: ensureClientId(u), hasSecret: Boolean(c.secretHash), secretHint: c.secretHint || null,
    createdAt: c.createdAt || null, rotatedAt: c.rotatedAt || null, lastUsedAt: c.lastUsedAt || null,
    previousValidUntil: c.previous && c.previous.until > Date.now() ? new Date(c.previous.until).toISOString() : null,
  };
};

app.get('/api/merchant/credentials', requireMerchant, (req, res) => {
  const out = credentialsOut(req.user);
  save();
  res.json(out);
});

// Gera (ou gera de novo) as credenciais. Sem segredo ativo, gera direto; trocar um segredo ativo exige a senha.
app.post('/api/merchant/credentials', requireMerchant, (req, res) => {
  const u = req.user, b = req.body || {};
  const scope = b.scope === 'both' ? 'both' : 'secret';
  const grace = [0, 60, 1440].includes(Number(b.graceMinutes)) ? Number(b.graceMinutes) : 0;
  if (u.credentials?.secretHash && !verifyPassword(b.password, u.passwordHash)) return res.status(400).json({ error: 'Confirme com a sua senha para gerar novas credenciais.' });
  const issued = issueCredentials(u, { scope, graceMinutes: grace });
  save();
  res.json({ ...credentialsOut(u), clientId: issued.clientId, clientSecret: issued.clientSecret });
});

app.delete('/api/merchant/credentials', requireMerchant, (req, res) => {
  if (!verifyPassword(req.body?.password, req.user.passwordHash)) return res.status(400).json({ error: 'Senha incorreta.' });
  revokeSecret(req.user);
  save();
  res.json(credentialsOut(req.user));
});

app.post('/api/merchant/webhook-secret', requireMerchant, (req, res) => {
  req.user.webhookSecret = newWebhookSecret();
  save();
  res.json({ secret: req.user.webhookSecret });
});

app.get('/api/merchant/webhook-secret', requireMerchant, (req, res) => res.json({ secret: req.user.webhookSecret }));

app.post('/api/merchant/webhook-test', requireMerchant, wrap(async (req, res) => {
  if (!req.user.webhookUrl) return res.status(400).json({ error: 'Cadastre a URL do webhook primeiro.' });
  const d = enqueue(req.user, 'test.ping', { message: 'Webhook do Zyropay funcionando.', merchant: req.user.name });
  await deliverNow(d);
  res.json({ ok: d.status === 'delivered', code: d.lastCode, error: d.lastError });
}));

app.get('/api/merchant/deliveries', requireMerchant, (req, res) => {
  res.json({ deliveries: db().deliveries.filter((d) => d.merchantId === req.user.id).slice(-50).reverse().map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, lastCode: d.lastCode, lastError: d.lastError, at: d.lastAttemptAt || d.createdAt, ref: d.payload?.data?.id || null })) });
});

// ---------- API pública v1 ----------
const RATE_LIMIT = 120;
const hits = new Map();
const CODES = { 400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 429: 'rate_limited', 500: 'internal_error', 502: 'provider_error', 503: 'provider_unavailable' };

// toda resposta de erro da API leva um "code" estável e o id da requisição
function apiEnvelope(req, res, next) {
  const rid = `req_${crypto.randomBytes(8).toString('hex')}`;
  res.setHeader('Zyropay-Request-Id', rid);
  const json = res.json.bind(res);
  res.json = (body) => json(body && typeof body === 'object' && body.error && !body.code ? { error: body.error, code: CODES[res.statusCode] || 'error', request_id: rid } : body);
  next();
}

// Autenticação com duas credenciais: Client ID + Client Secret.
// HTTP Basic (id:secret) ou os headers Zyropay-Client-Id / Zyropay-Client-Secret.
function apiCredentials(req) {
  const auth = req.get('Authorization') || '';
  if (/^basic /i.test(auth)) {
    const raw = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    return i > 0 ? [raw.slice(0, i), raw.slice(i + 1)] : [null, null];
  }
  return [String(req.get('Zyropay-Client-Id') || ''), String(req.get('Zyropay-Client-Secret') || '')];
}

function apiAuth(req, res, next) {
  const [id, secret] = apiCredentials(req);
  if (!id && !secret) return res.status(401).json({ error: 'Credenciais ausentes. Envie o Client ID e o Client Secret.' });
  const failKey = `api|${req.ip}|${id}`;
  if (loginBlocked(failKey)) return res.status(429).json({ error: 'Muitas credenciais inválidas. Tente de novo em alguns minutos.' });
  const user = userByCredentials(id, secret);
  if (!user) { loginFailed(failKey); return res.status(401).json({ error: 'Client ID ou Client Secret inválidos.' }); }
  loginSucceeded(failKey);
  if (user.status !== 'active') return res.status(403).json({ error: 'Conta desativada.' });
  const minute = Math.floor(Date.now() / 60000);
  const h = hits.get(user.id);
  const count = h && h.minute === minute ? h.count + 1 : 1;
  hits.set(user.id, { minute, count });
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT - count));
  if (count > RATE_LIMIT) { res.setHeader('Retry-After', 60 - (Math.floor(Date.now() / 1000) % 60)); return res.status(429).json({ error: `Limite de ${RATE_LIMIT} requisições por minuto.` }); }
  const c = user.credentials;
  if (!c.lastUsedAt || Date.now() - Date.parse(c.lastUsedAt) > 60000) { c.lastUsedAt = now(); save(); }
  req.user = user;
  next();
}

const v1 = express.Router();
v1.use(apiAuth);
v1.post('/charges', wrap(async (req, res) => {
  const r = await createCharge(req.user, req.body || {}, req.get('Idempotency-Key'));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.status(r.status).json({ ...chargeOut(r.charge), pix: { copy_paste: r.charge.qrCode, qr_code_image: await qrImage(r.charge) } });
}));
v1.get('/charges', (req, res) => {
  const limit = Math.min(100, Math.max(1, toInt(req.query.limit) || 20));
  const status = String(req.query.status || '');
  const externalId = String(req.query.external_id || '');
  let list = db().charges.filter((c) => c.merchantId === req.user.id && (!status || c.status === status) && (!externalId || c.externalId === externalId)).reverse();
  if (req.query.starting_after) {
    const i = list.findIndex((c) => c.id === String(req.query.starting_after));
    if (i < 0) return res.status(400).json({ error: 'starting_after não corresponde a nenhuma cobrança.' });
    list = list.slice(i + 1);
  }
  res.json({ data: list.slice(0, limit).map(chargeOut), has_more: list.length > limit });
});
v1.get('/charges/:id', wrap(async (req, res) => {
  const c = db().charges.find((x) => (x.id === req.params.id || x.externalId === req.params.id) && x.merchantId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Cobrança não encontrada.' });
  await syncCharge(c);
  res.json(chargeOut(c));
}));
v1.post('/charges/:id/cancel', wrap(async (req, res) => {
  const c = db().charges.find((x) => x.id === req.params.id && x.merchantId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Cobrança não encontrada.' });
  if (c.status !== 'pending') return res.status(400).json({ error: 'Só é possível cancelar cobranças pendentes.' });
  await cancelAtProvider(c);
  markStatus(c, 'canceled');
  res.json(chargeOut(c));
}));
v1.post('/charges/:id/refund', wrap(async (req, res) => {
  const c = db().charges.find((x) => x.id === req.params.id && x.merchantId === req.user.id);
  if (!c) return res.status(404).json({ error: 'Cobrança não encontrada.' });
  if (c.status !== 'paid') return res.status(400).json({ error: 'Só é possível devolver cobranças pagas.' });
  await asSeller(req.user, (token) => provider.refund(token, c.providerId));
  markStatus(c, 'refunded');
  res.json(chargeOut(c));
}));
v1.get('/summary', (req, res) => {
  const days = Math.min(365, Math.max(1, toInt(req.query.days) || 30));
  const since = Date.now() - days * 86400000;
  const counts = { pending: 0, paid: 0, expired: 0, canceled: 0, failed: 0, refunded: 0 };
  for (const c of db().charges) if (c.merchantId === req.user.id && Date.parse(c.createdAt) >= since) counts[c.status] = (counts[c.status] || 0) + 1;
  const t = totalsOf(req.user.id, since);
  res.json({ period_days: days, charges: counts, paid_count: t.count, gross_amount: t.gross, fees: t.fees, net_amount: t.net, currency: 'BRL' });
});
v1.get('/account', (req, res) => {
  const u = req.user;
  res.json({ id: u.id, name: u.name, status: u.status, fee_percent: u.feePercent ?? config.feePercent, fee_min: u.feeMinCents ?? config.feeMinCents, webhook_url: u.webhookUrl || null, client_id: u.credentials.clientId, mercadopago: { status: connectionOut(u).status, account_id: u.mp?.userId || null } });
});
v1.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use('/v1', express.json({ limit: '64kb' }), v1);

// ---------- notificações do Mercado Pago ----------
app.post('/webhooks/mercadopago', wrap(async (req, res) => {
  const dataId = req.query['data.id'] || req.body?.data?.id;
  const type = req.query.type || req.body?.type;
  if (!dataId || (type && type !== 'payment')) return res.sendStatus(200);
  if (!provider.verifyWebhook({ signature: req.get('x-signature'), requestId: req.get('x-request-id'), dataId })) return res.sendStatus(401);
  const c = db().charges.find((x) => x.providerId === String(dataId));
  if (c) await syncCharge(c, { deep: true });
  res.sendStatus(200);
}));

// ---------- administração ----------
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const data = db();
  const today = dayKey();
  const paid = data.charges.filter((c) => c.status === 'paid');
  const merchants = data.users.filter((u) => u.role === 'merchant');
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86400000));
    const list = paid.filter((c) => dayKey(new Date(c.paidAt)) === k);
    days.push({ day: k, amount: list.reduce((a, c) => a + c.amount, 0), fees: list.reduce((a, c) => a + c.fee, 0) });
  }
  const todayPaid = paid.filter((c) => dayKey(new Date(c.paidAt)) === today);
  res.json({
    tpv: paid.reduce((a, c) => a + c.amount, 0),
    revenue: paid.reduce((a, c) => a + c.fee, 0),
    today: { amount: todayPaid.reduce((a, c) => a + c.amount, 0), fees: todayPaid.reduce((a, c) => a + c.fee, 0), count: todayPaid.length },
    merchants: { active: merchants.filter((m) => m.status === 'active').length, pending: merchants.filter((m) => m.status === 'pending').length, connected: merchants.filter(isConnected).length },
    days,
    provider: provider.name,
  });
});

app.get('/api/admin/merchants', requireAdmin, (req, res) => {
  res.json({ merchants: db().users.filter((u) => u.role === 'merchant').slice().reverse().map((u) => ({ ...publicUser(u), totals: totalsOf(u.id) })) });
});

app.patch('/api/admin/merchants/:id', requireAdmin, (req, res) => {
  const u = db().users.find((x) => x.id === Number(req.params.id) && x.role === 'merchant');
  if (!u) return res.status(404).json({ error: 'Lojista não encontrado.' });
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!['active', 'blocked'].includes(b.status)) return res.status(400).json({ error: 'Status inválido.' });
    u.status = b.status;
    if (b.status === 'blocked') destroyUserSessions(u.id);
  }
  if (b.feePercent !== undefined) {
    const p = Number(b.feePercent);
    if (!(p >= 0 && p <= 20)) return res.status(400).json({ error: 'Taxa deve ser entre 0% e 20%.' });
    u.feePercent = Math.round(p * 100) / 100;
  }
  if (b.feeMinCents !== undefined) {
    const m = toInt(b.feeMinCents);
    if (!Number.isInteger(m) || m < 0 || m > 1000) return res.status(400).json({ error: 'Taxa mínima deve ser entre R$ 0,00 e R$ 10,00.' });
    u.feeMinCents = m;
  }
  save();
  res.json({ merchant: { ...publicUser(u), totals: totalsOf(u.id) } });
});

app.delete('/api/admin/merchants/:id', requireAdmin, (req, res) => {
  const data = db();
  const i = data.users.findIndex((x) => x.id === Number(req.params.id) && x.role === 'merchant' && x.status === 'pending');
  if (i < 0) return res.status(400).json({ error: 'Só é possível recusar cadastros em análise.' });
  data.users.splice(i, 1);
  save();
  res.json({ ok: true });
});

app.get('/api/admin/charges', requireAdmin, (req, res) => {
  const status = String(req.query.status || '');
  const list = db().charges.filter((c) => !status || c.status === status).slice(-500).reverse();
  res.json({ charges: list.map((c) => ({ ...chargeOut(c), merchant: merchantName(c.merchantId), provider: c.provider, provider_id: c.providerId })) });
});

app.post('/api/admin/charges/:id/refund', requireAdmin, wrap(async (req, res) => {
  const c = db().charges.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Cobrança não encontrada.' });
  if (c.status !== 'paid') return res.status(400).json({ error: 'Só é possível devolver cobranças pagas.' });
  await asSeller(db().users.find((u) => u.id === c.merchantId), (token) => provider.refund(token, c.providerId));
  markStatus(c, 'refunded');
  res.json({ charge: chargeOut(c) });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ---------- páginas ----------
const page = (f) => (req, res) => res.sendFile(path.join(root, 'public', f));
app.get('/pay/:id', page('pay.html'));
app.get('/app', page('app.html'));
app.get(['/entrar', '/cadastro'], page('auth.html'));
app.get('/docs', page('docs.html'));
app.use(express.static(path.join(root, 'public'), { index: 'index.html' }));

app.use((err, req, res, next) => {
  if (err instanceof ProviderError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});

app.listen(config.port, () => {
  console.log(`Zyropay rodando em ${config.publicUrl}`);
  if (config.mock) console.log('⚠  MOCK_PROVIDER=1 — provedor simulado, nenhum PIX real é gerado.');
  else if (!provider.configured()) console.log('⚠  MP_CLIENT_ID / MP_CLIENT_SECRET não definidos — os lojistas não conseguem conectar o Mercado Pago.');
  syncPending();
});
