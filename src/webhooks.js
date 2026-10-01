import crypto from 'node:crypto';
import { db, save, nextId } from './db.js';

// Webhooks enviados aos lojistas, assinados com HMAC-SHA256:
//   Zyropay-Signature: t=<timestamp>,v1=<hex de HMAC(secret, "<t>.<corpo>")>
// Tentativas com espera crescente até 6 vezes.

const BACKOFF_S = [0, 10, 60, 300, 1800, 7200];

export function newWebhookSecret() {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

export function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function enqueue(merchant, event, data) {
  if (!merchant?.webhookUrl) return null;
  const delivery = {
    id: nextId('delivery'), merchantId: merchant.id, event, url: merchant.webhookUrl,
    payload: { id: `evt_${crypto.randomBytes(10).toString('hex')}`, type: event, created_at: new Date().toISOString(), data },
    attempts: 0, status: 'pending', nextAt: Date.now(), lastCode: null, lastError: null, createdAt: new Date().toISOString(),
  };
  db().deliveries.push(delivery);
  save();
  return delivery;
}

async function deliver(d) {
  const merchant = db().users.find((u) => u.id === d.merchantId);
  if (!merchant?.webhookSecret) { d.status = 'failed'; d.lastError = 'Lojista sem segredo de webhook.'; return; }
  const body = JSON.stringify(d.payload);
  const t = Math.floor(Date.now() / 1000);
  d.attempts += 1;
  try {
    const res = await fetch(d.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Zyropay-Webhooks/1.0', 'Zyropay-Signature': `t=${t},v1=${sign(merchant.webhookSecret, t, body)}`, 'Zyropay-Event': d.event },
      body,
      signal: AbortSignal.timeout(10000),
      redirect: 'manual',
    });
    d.lastCode = res.status;
    d.lastError = res.ok ? null : `HTTP ${res.status}`;
    if (res.ok) d.status = 'delivered';
  } catch (err) {
    d.lastCode = null;
    d.lastError = err.name === 'TimeoutError' ? 'Tempo esgotado (10s)' : 'Falha de conexão';
  }
  if (d.status !== 'delivered') {
    if (d.attempts >= BACKOFF_S.length) d.status = 'failed';
    else d.nextAt = Date.now() + BACKOFF_S[d.attempts] * 1000;
  }
  d.lastAttemptAt = new Date().toISOString();
}

let busy = false;
export async function processDeliveries() {
  if (busy) return;
  busy = true;
  try {
    const due = db().deliveries.filter((d) => d.status === 'pending' && d.nextAt <= Date.now()).slice(0, 20);
    for (const d of due) await deliver(d);
    if (due.length) save();
  } finally {
    busy = false;
  }
}

export async function deliverNow(d) {
  await deliver(d);
  save();
  return d;
}
