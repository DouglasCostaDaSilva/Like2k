import crypto from 'node:crypto';
import { config } from './config.js';
import { db, save, nextId } from './db.js';
import { likeApi, updateRemaining, ApiError } from './likeapi.js';
import { payments } from './payments.js';

// Pedidos e entregas.
//  - pedido pago => uma entrega por dia do plano (dia 1 imediata, dia N = pagamento + (N-1) x 24h)
//  - cada ID recebe no máximo 2.000 likes por dia (fuso de Brasília); o excedente é empurrado para o dia seguinte
//  - falhas na API são retentadas a cada 10 min, até 12 vezes; depois ficam "falhou" para o admin reenviar

const BRT = 3 * 3600000; // Brasília = UTC-3 (sem horário de verão)
export const nowIso = () => new Date().toISOString();
export const dayKey = (ms = Date.now()) => new Date(ms - BRT).toISOString().slice(0, 10);
export function nextDayStart(ms = Date.now()) {
  const d = new Date(ms - BRT);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5) + BRT;
}

export const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const newCode = () => crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10).toUpperCase();

export const findOrder = (code) => db().orders.find((o) => o.code === String(code || '').toUpperCase());
export const activePlans = () => db().settings.plans.filter((p) => p.active);

export function usedToday(uid) {
  const today = dayKey();
  let used = 0;
  for (const d of db().deliveries) if (d.uid === uid && d.status === 'sent' && dayKey(Date.parse(d.sentAt)) === today) used += d.likesSent || 0;
  return used;
}

// ---------- criação ----------
export async function createOrder({ uid, nickname, plan, contact, ip }) {
  const id = nextId('order');
  let code = newCode();
  while (findOrder(code)) code = newCode();
  const expiresAt = Date.now() + config.pixExpiryMinutes * 60000;
  const order = {
    id, code, uid, nickname, planId: plan.id, planName: plan.name, days: plan.days, likesPerDay: config.likesPerDay,
    amountCents: plan.priceCents, contact: contact || '', status: 'pending', providerId: null, qrCode: null, qrImage: null,
    expiresAt: new Date(expiresAt).toISOString(), createdAt: nowIso(), paidAt: null, paidBy: null, ip: ip || '',
  };
  const pix = await payments.createPix({ orderId: code, amountCents: plan.priceCents, description: `${db().settings.siteName} · ${plan.name} · ID ${uid}`, email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contact) ? contact : null, expiresAt });
  Object.assign(order, { providerId: pix.providerId, qrCode: pix.qrCode, qrImage: pix.qrImage });
  db().orders.push(order);
  save();
  if (pix.status === 'paid') markPaid(order, 'mercadopago');
  return order;
}

// ---------- pagamento ----------
export function markPaid(order, by = 'mercadopago', paidAt = null) {
  if (order.status !== 'pending' && order.status !== 'expired') return false;
  order.status = 'paid';
  order.paidAt = paidAt || nowIso();
  order.paidBy = by;
  const base = Date.parse(order.paidAt);
  for (let day = 1; day <= order.days; day++) {
    db().deliveries.push({
      id: nextId('delivery'), orderId: order.id, code: order.code, uid: order.uid, nickname: order.nickname, amount: order.likesPerDay,
      dayIndex: day, dueAt: new Date(base + (day - 1) * 86400000).toISOString(), status: 'queued', attempts: 0, likesSent: 0,
      error: null, sentAt: null, createdAt: nowIso(), kind: 'order',
    });
  }
  refreshOrderStatus(order);
  save();
  return true;
}

export function refreshOrderStatus(order) {
  if (['pending', 'expired', 'cancelled'].includes(order.status)) return;
  const list = db().deliveries.filter((d) => d.orderId === order.id && d.status !== 'cancelled');
  if (!list.length) { order.status = 'paid'; return; }
  if (list.some((d) => d.status === 'failed')) order.status = 'failed';
  else if (list.every((d) => d.status === 'sent')) order.status = 'completed';
  else order.status = 'delivering';
}

export async function syncPayment(order) {
  if (order.status !== 'pending' || !order.providerId) return;
  let st;
  try { st = await payments.getStatus(order.providerId); } catch { return; }
  if (st.status === 'paid') markPaid(order, payments.name, st.paidAt);
  else if (st.status === 'expired' || st.status === 'failed') { order.status = 'expired'; save(); }
}

export function expireStale() {
  const now = Date.now();
  for (const o of db().orders) {
    if (o.status === 'pending' && Date.parse(o.expiresAt) + 5 * 60000 < now) { o.status = 'expired'; save(); }
  }
}

// ---------- entregas ----------
export async function runDelivery(d) {
  if (d.status !== 'queued') return d;
  const order = d.orderId ? db().orders.find((o) => o.id === d.orderId) : null;
  const allowed = config.likesPerDay - usedToday(d.uid);
  if (allowed < d.amount) {
    // limite diário desse ID já usado hoje: empurra para o dia seguinte
    d.dueAt = new Date(nextDayStart()).toISOString();
    d.error = 'Limite diário do ID atingido; reagendado para o próximo dia.';
    save();
    return d;
  }
  d.attempts += 1;
  try {
    const r = await likeApi.sendLikes(d.uid, d.amount);
    const sent = Number(r?.likes_sent);
    d.likesSent = Number.isFinite(sent) ? sent : d.amount;
    d.nickname = r?.player_nickname || d.nickname;
    d.status = 'sent';
    d.sentAt = nowIso();
    d.error = d.likesSent < d.amount ? `A API enviou ${d.likesSent} de ${d.amount}.` : null;
    if (Number.isFinite(Number(r?.remaining))) updateRemaining(Number(r.remaining));
  } catch (err) {
    d.error = err.message;
    if (d.attempts >= config.deliveryMaxAttempts || d.kind === 'manual') d.status = 'failed';
    else d.dueAt = new Date(Date.now() + config.deliveryRetryMinutes * 60000).toISOString();
  }
  if (order) refreshOrderStatus(order);
  save();
  return d;
}

export function retryDelivery(d) {
  d.status = 'queued';
  d.attempts = 0;
  d.error = null;
  d.dueAt = nowIso();
  const order = d.orderId ? db().orders.find((o) => o.id === d.orderId) : null;
  if (order) refreshOrderStatus(order);
  save();
}

export function cancelDelivery(d) {
  if (d.status !== 'queued') return false;
  d.status = 'cancelled';
  const order = d.orderId ? db().orders.find((o) => o.id === d.orderId) : null;
  if (order) refreshOrderStatus(order);
  save();
  return true;
}

// envio manual do admin: executa na hora
export async function manualSend(uid, amount, nickname = null) {
  const allowed = config.likesPerDay - usedToday(uid);
  if (allowed <= 0) throw new ApiError(429, `Esse ID já recebeu ${config.likesPerDay} likes hoje. Tente amanhã.`);
  if (amount > allowed) throw new ApiError(429, `Esse ID só pode receber mais ${allowed} likes hoje.`);
  const d = {
    id: nextId('delivery'), orderId: null, code: null, uid, nickname, amount, dayIndex: 1, dueAt: nowIso(), status: 'queued',
    attempts: 0, likesSent: 0, error: null, sentAt: null, createdAt: nowIso(), kind: 'manual',
  };
  db().deliveries.push(d);
  await runDelivery(d);
  if (d.status !== 'sent') throw new ApiError(502, d.error || 'Falha no envio.');
  return d;
}

// ---------- rotina de fundo ----------
let running = false;
let again = false;
export async function tick() {
  if (running) { again = true; return; }
  running = true;
  try {
    expireStale();
    const pending = db().orders.filter((o) => o.status === 'pending' && o.providerId && Date.parse(o.createdAt) > Date.now() - 2 * 3600000);
    for (const o of pending) await syncPayment(o);
    const now = Date.now();
    const due = db().deliveries.filter((d) => d.status === 'queued' && Date.parse(d.dueAt) <= now).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
    for (const d of due) await runDelivery(d);
  } catch (err) {
    console.error('[jobs]', err);
  } finally {
    running = false;
    if (again) { again = false; setTimeout(tick, 0); }
  }
}

// roda a fila já (ex.: logo após um pagamento confirmado)
export function kick() {
  setTimeout(tick, 0);
}

export function startJobs() {
  setTimeout(tick, 2000);
  setInterval(tick, 15000);
}

// ---------- formatos ----------
export function publicDelivery(d) {
  return { id: d.id, day: d.dayIndex, status: d.status, amount: d.amount, likesSent: d.likesSent, dueAt: d.dueAt, sentAt: d.sentAt, error: d.error, nickname: d.nickname };
}

export function publicOrder(o) {
  const deliveries = db().deliveries.filter((d) => d.orderId === o.id).map(publicDelivery);
  const pending = o.status === 'pending';
  return {
    code: o.code, status: o.status, uid: o.uid, nickname: o.nickname, plan: { id: o.planId, name: o.planName, days: o.days, likesPerDay: o.likesPerDay },
    amountCents: o.amountCents, amount: brl(o.amountCents), qrCode: pending ? o.qrCode : null, qrImage: pending ? o.qrImage : null,
    expiresAt: o.expiresAt, createdAt: o.createdAt, paidAt: o.paidAt, deliveries, totalLikes: deliveries.reduce((a, d) => a + (d.likesSent || 0), 0),
  };
}

export function adminOrder(o) {
  return { ...publicOrder(o), id: o.id, contact: o.contact, providerId: o.providerId, paidBy: o.paidBy, ip: o.ip };
}

export function adminDelivery(d) {
  return { ...publicDelivery(d), uid: d.uid, code: d.code, orderId: d.orderId, kind: d.kind, attempts: d.attempts, createdAt: d.createdAt };
}
