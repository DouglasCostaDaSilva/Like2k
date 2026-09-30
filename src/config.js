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
  apiBase: (env.LIKESYSTEM_API_URL || 'https://likesystem.squareweb.app').replace(/\/+$/, ''),
  apiKey: env.LIKESYSTEM_API_KEY || '',
  mock: env.MOCK_API === '1',
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  secureCookies: env.SECURE_COOKIES === '1',
  timezone: 'America/Sao_Paulo',
  sessionDays: 7,

  // Regras de negócio
  packSize: 2000, // likes por pacote
  pricePerPackCents: 880, // R$ 8,80 por 2.000 likes
  minPurchase: 20000, // compra mínima no estoque individual
  maxPurchase: 2000000,
  maxPerSend: 2000, // limite da API por requisição
  dailyLimitPerUid: 2000, // envios de até 2k likes por dia para cada ID

  admin: {
    username: 'ADMIN',
    password: env.ADMIN_PASSWORD || 'LELEO',
  },
};

export function priceCents(likes) {
  return Math.round((likes / config.packSize) * config.pricePerPackCents);
}
