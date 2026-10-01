import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Banco em arquivo JSON com escrita atômica (tmp + rename). Sem dependências nativas.

const file = path.join(config.dataDir, 'db.json');
const MAX_DELIVERIES = 50000;

export const defaultPlans = () => [
  { id: '2k', name: '2K Likes', days: 1, priceCents: 990, tag: 'Mais vendido', active: true, description: '2.000 likes enviados uma vez, em minutos.' },
  { id: '7d', name: '2K por dia · 7 dias', days: 7, priceCents: 4990, tag: '', active: true, description: '14.000 likes no total, 2.000 por dia durante uma semana.' },
  { id: '30d', name: '2K por dia · 30 dias', days: 30, priceCents: 14990, tag: 'Melhor custo', active: true, description: '60.000 likes no total, 2.000 por dia durante um mês.' },
];

const defaults = () => ({
  seq: { order: 0, delivery: 0 },
  orders: [],
  deliveries: [],
  sessions: {},
  settings: {
    siteName: 'Like2k',
    tagline: '2.000 likes no seu perfil do Free Fire em minutos.',
    whatsapp: '',
    notice: '',
    plans: defaultPlans(),
  },
});

let data = defaults();

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const base = defaults();
    data = { ...base, ...saved, seq: { ...base.seq, ...saved.seq }, settings: { ...base.settings, ...saved.settings } };
    if (!Array.isArray(data.settings.plans) || !data.settings.plans.length) data.settings.plans = defaultPlans();
  }
  return data;
}

let timer = null;
export function save() {
  // agrupa gravações em sequência numa só escrita
  if (timer) return;
  timer = setTimeout(flush, 50);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (data.deliveries.length > MAX_DELIVERIES) data.deliveries.splice(0, data.deliveries.length - MAX_DELIVERIES);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export const db = () => data;

export function nextId(kind) {
  data.seq[kind] += 1;
  return data.seq[kind];
}
