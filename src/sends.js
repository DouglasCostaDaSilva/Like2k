import { db, save, nextId } from './db.js';
import { likeApi, ApiError } from './likeapi.js';

// Histórico de envios feitos pelo site (visitantes e admin).
// A API já evita que a mesma conta curta o mesmo perfil duas vezes; aqui guardamos o antes/depois para acompanhamento.

const BRT = 3 * 3600000; // Brasília = UTC-3
export const nowIso = () => new Date().toISOString();
export const dayKey = (ms = Date.now()) => new Date(ms - BRT).toISOString().slice(0, 10);

export const historyOf = (uid, limit = 30) => db().sends.filter((s) => s.uid === uid).slice(-limit).reverse();

export function receivedToday(uid) {
  const today = dayKey();
  return db().sends.some((s) => s.uid === uid && s.given > 0 && dayKey(Date.parse(s.at)) === today);
}

export function totalGiven(uid) {
  return db().sends.filter((s) => s.uid === uid).reduce((a, s) => a + (s.given || 0), 0);
}

// executa o envio pela API e registra no histórico
export async function sendLikes({ uid, server, by, ip }) {
  const rec = { id: nextId('send'), uid, server, nickname: null, before: null, after: null, given: 0, tokensUsed: 0, elapsed: 0, status: 'pending', error: null, at: nowIso(), by, ip: ip || '' };
  db().sends.push(rec);
  save();
  try {
    const r = await likeApi.send(uid, server);
    Object.assign(rec, { nickname: r.nickname, before: r.before, after: r.after, given: r.given, tokensUsed: r.tokensUsed, elapsed: r.elapsed, status: r.given > 0 ? 'ok' : 'nochange', remains: r.remains });
    if (r.given <= 0) rec.error = 'A API não conseguiu aumentar os likes agora (perfil já recebeu hoje ou contas esgotadas).';
  } catch (err) {
    rec.status = 'error';
    rec.error = err.message;
    save();
    throw err instanceof ApiError ? err : new ApiError(502, err.message);
  }
  save();
  return rec;
}

export function publicSend(s) {
  return { id: s.id, uid: s.uid, server: s.server, nickname: s.nickname, before: s.before, after: s.after, given: s.given, status: s.status, error: s.error, at: s.at, elapsed: s.elapsed };
}

export function adminSend(s) {
  return { ...publicSend(s), tokensUsed: s.tokensUsed, by: s.by, ip: s.ip, remains: s.remains ?? null };
}
