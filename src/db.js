import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Banco em arquivo JSON com escrita atômica (tmp + rename).
// Toda mudança de saldo acontece de forma síncrona num único processo, então não há corrida.
// Para volume alto, troque por Postgres mantendo as mesmas funções.

const file = path.join(config.dataDir, 'zyropay.json');

const defaults = () => ({
  seq: { user: 0, charge: 0, delivery: 0 },
  users: [],
  sessions: {},
  charges: [],
  deliveries: [],
  idempotency: {},
});

let data = defaults();

export function load() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const base = defaults();
    data = { ...base, ...saved, seq: { ...base.seq, ...saved.seq } };
  }
  return data;
}

export function save() {
  if (data.deliveries.length > 20000) data.deliveries.splice(0, data.deliveries.length - 20000);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export const db = () => data;

export function nextId(kind) {
  data.seq[kind] += 1;
  return data.seq[kind];
}
