import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env simples (KEY=VALUE), sem dependências.
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
const port = Number(env.PORT || 3000);

export const config = {
  port,
  publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  secureCookies: env.SECURE_COOKIES === '1',
  sessionDays: 7,
  timezone: 'America/Sao_Paulo',

  // Aplicativo do Zyropay no Mercado Pago (modelo marketplace): cada lojista conecta a própria conta por OAuth
  // e o PIX cai direto nela. A taxa do Zyropay vai como comissão (application_fee) para a conta dona do aplicativo.
  mp: {
    clientId: env.MP_CLIENT_ID || '',
    clientSecret: env.MP_CLIENT_SECRET || '',
    webhookSecret: env.MP_WEBHOOK_SECRET || '',
  },
  mock: env.MOCK_PROVIDER === '1',

  // Taxa padrão: 2% com mínimo de R$ 0,30 por PIX pago
  feePercent: Number(env.FEE_PERCENT ?? 2),
  feeMinCents: Number(env.FEE_MIN_CENTS ?? 30),

  minChargeCents: 100, // R$ 1,00
  maxChargeCents: 5_000_000, // R$ 50.000,00
  defaultExpiresMin: 30,

  admin: { username: env.ADMIN_USER || 'ADMIN', password: env.ADMIN_PASSWORD || 'LELEO' },
};

// taxa em centavos: percentual com mínimo, nunca maior que a própria cobrança
export function feeFor(amountCents, merchant) {
  const pct = merchant?.feePercent ?? config.feePercent;
  const min = merchant?.feeMinCents ?? config.feeMinCents;
  return Math.min(amountCents, Math.max(min, Math.round((amountCents * pct) / 100)));
}
