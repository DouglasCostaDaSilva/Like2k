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
  mock: env.MOCK === '1',
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  secureCookies: env.SECURE_COOKIES === '1',
  timezone: 'America/Sao_Paulo',
  sessionDays: 7,

  likeApi: {
    base: (env.LIKE_API_URL || 'http://localhost:5001').replace(/\/+$/, ''),
    key: env.LIKE_API_KEY || 'DRIFT',
  },
  admin: {
    username: env.ADMIN_USER || 'ADMIN',
    password: env.ADMIN_PASSWORD || 'LELEO',
  },
};

export const UID_RE = /^\d{6,12}$/;

// Regiões aceitas pela API (server_name)
export const SERVERS = [
  { code: 'BR', label: 'Brasil' },
  { code: 'IND', label: 'Índia' },
  { code: 'US', label: 'Estados Unidos' },
  { code: 'SAC', label: 'América do Sul' },
  { code: 'NA', label: 'América do Norte' },
  { code: 'BD', label: 'Bangladesh' },
  { code: 'RU', label: 'Rússia' },
];
export const SERVER_CODES = SERVERS.map((s) => s.code);
