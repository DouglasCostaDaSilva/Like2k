import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Tokens do Mercado Pago dos lojistas ficam criptografados em repouso (AES-256-GCM).
// A chave vem de ENCRYPTION_KEY; sem ela, uma chave aleatória é criada em data/secret.key (modo 0600).
// Perder a chave = os lojistas precisam conectar o Mercado Pago de novo.

function loadKey() {
  if (process.env.ENCRYPTION_KEY) return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

let key;
export function seal(plain) {
  key ||= loadKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function open(sealed) {
  key ||= loadKey();
  const [v, iv, tag, enc] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('segredo ilegível');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
