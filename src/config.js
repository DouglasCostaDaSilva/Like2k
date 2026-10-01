import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carrega .env simples (KEY=VALUE) sem dependências externas.
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, ''),
  mock: env.MOCK === '1',
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  secureCookies: env.SECURE_COOKIES === '1',
  timezone: 'America/Sao_Paulo',
  sessionDays: 7,

  likeApi: {
    base: (env.LIKE_API_URL || 'https://likesystem.squareweb.app').replace(/\/+$/, ''),
    key: env.LIKE_API_KEY || '',
  },
  mp: {
    accessToken: env.MP_ACCESS_TOKEN || '',
    webhookSecret: env.MP_WEBHOOK_SECRET || '',
  },
  admin: {
    username: env.ADMIN_USER || 'ADMIN',
    password: env.ADMIN_PASSWORD || 'LELEO',
  },

  // Regras do produto
  likesPerDay: 2000, // a API aceita até 2.000 likes por dia em cada ID
  maxPerSend: 2000,
  pixExpiryMinutes: 30,
  deliveryRetryMinutes: 10,
  deliveryMaxAttempts: 12,
};

export const UID_RE = /^\d{6,12}$/;
