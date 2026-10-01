import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Banco em arquivo JSON com escrita atômica (tmp + rename). Sem dependências nativas.

const file = path.join(config.dataDir, 'db.json');
const MAX_SENDS = 50000;

const defaults = () => ({
  seq: { send: 0 },
  sends: [],
  sessions: {},
  settings: {
    siteName: 'Like2k',
    tagline: 'Acompanhe os likes do seu perfil do Free Fire e receba mais com um clique.',
    whatsapp: '',
    notice: '',
    publicSend: true, // visitantes podem pedir likes pelo site
    defaultServer: 'BR',
    servers: ['BR', 'IND', 'US', 'SAC', 'NA', 'BD', 'RU'],
  },
});

let data = defaults();

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const base = defaults();
    data = { ...base, ...saved, seq: { ...base.seq, ...saved.seq }, settings: { ...base.settings, ...saved.settings } };
  }
  return data;
}

let timer = null;
export function save() {
  if (timer) return;
  timer = setTimeout(flush, 50);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (data.sends.length > MAX_SENDS) data.sends.splice(0, data.sends.length - MAX_SENDS);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export const db = () => data;

export function nextId(kind) {
  data.seq[kind] += 1;
  return data.seq[kind];
}
