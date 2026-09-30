import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Banco em arquivo JSON com escrita atômica (tmp + rename).
// Suficiente para o volume de uma plataforma fechada; sem dependências nativas.

const file = path.join(config.dataDir, 'db.json');
const MAX_SENDS = 50000;

const defaults = () => ({
  seq: { user: 0, order: 0, send: 0 },
  users: [],
  sessions: {},
  orders: [],
  sends: [],
  settings: {
    pixKey: '',
    pixHolder: '',
    contact: '',
    paymentNote: 'Após o pagamento via PIX, envie o comprovante ao administrador. O estoque é liberado assim que o pagamento for confirmado.',
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

export function save() {
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
