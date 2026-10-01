import { api, $, esc, num, when, badge, toast, copy, busy } from './common.js';

const code = location.pathname.split('/').pop().toUpperCase();
let order = null;
let mock = false;
let pollTimer = null;

const TITLES = {
  pending: ['Aguardando pagamento', 'Pague o PIX abaixo para liberar os likes.'],
  paid: ['Pagamento confirmado', 'Preparando o envio dos likes…'],
  delivering: ['Enviando likes', 'Os likes estão a caminho do perfil.'],
  completed: ['Tudo enviado!', 'Todos os likes do plano foram entregues.'],
  expired: ['PIX expirado', 'O código venceu antes do pagamento.'],
  cancelled: ['Pedido cancelado', 'Esse pedido foi cancelado.'],
  failed: ['Precisa de atenção', 'Um envio falhou. Nossa equipe já foi avisada; se quiser, chame o suporte.'],
};

function render() {
  const o = order;
  const [title, sub] = TITLES[o.status] || [o.status, ''];
  $('#code').textContent = o.code;
  $('#code2').textContent = o.code;
  $('#title').textContent = title;
  $('#subtitle').textContent = sub;
  $('#status').innerHTML = badge(o.status);
  $('#player').textContent = `${o.nickname || '—'} · ID ${o.uid}`;
  $('#plan').textContent = `${o.plan.name} · ${num(o.plan.days * o.plan.likesPerDay)} likes`;
  $('#amount').textContent = o.amount;
  $('#amount2').textContent = o.amount;
  $('#created').textContent = when(o.createdAt);

  const pending = o.status === 'pending';
  $('#pay').hidden = !pending;
  $('#expired').hidden = !['expired', 'cancelled'].includes(o.status);
  $('#done').hidden = !['paid', 'delivering', 'completed', 'failed'].includes(o.status);
  if (pending) {
    $('#qrImg').src = o.qrImage || '';
    $('#copia').value = o.qrCode || '';
    $('#btnSimulate').hidden = !mock;
  } else {
    const sent = o.deliveries.filter((d) => d.status === 'sent').length;
    $('#doneTitle').textContent = o.status === 'completed' ? 'Likes entregues!' : 'Pagamento confirmado!';
    $('#doneText').textContent = o.status === 'completed'
      ? `${num(o.totalLikes)} likes enviados para ${o.nickname}. Abra o perfil no jogo e confira.`
      : `${sent} de ${o.deliveries.length} envio(s) concluído(s) · ${num(o.totalLikes)} likes já entregues.`;
  }
  $('#deliveriesBox').hidden = !o.deliveries.length;
  $('#deliveries').innerHTML = o.deliveries.map((d) => `
    <li class="${d.status}">
      <span class="dot"></span>
      <div>
        <strong>Dia ${d.day} · ${num(d.amount)} likes</strong>
        <span class="muted">${d.status === 'sent' ? `Enviado em ${when(d.sentAt)}${d.likesSent !== d.amount ? ` (${num(d.likesSent)} confirmados)` : ''}` : d.status === 'queued' ? `Previsto para ${when(d.dueAt)}` : d.status === 'failed' ? 'Falhou — será reenviado pelo suporte' : 'Cancelado'}</span>
        ${d.error && d.status !== 'sent' ? `<span class="muted small">${esc(d.error)}</span>` : ''}
      </div>
      ${badge(d.status)}
    </li>`).join('');
  document.title = `${title} — Pedido ${o.code}`;
}

function tickTimer() {
  if (!order || order.status !== 'pending') return;
  const left = Math.max(0, Date.parse(order.expiresAt) - Date.now());
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  $('#timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (left === 0) load(true);
}
setInterval(tickTimer, 1000);

async function load(sync = false) {
  try {
    const data = await api(`/api/orders/${code}${sync ? '?sync=1' : ''}`);
    const prev = order?.status;
    order = data.order;
    mock = data.mock;
    render();
    $('#loading').hidden = true;
    $('#order').hidden = false;
    if (prev === 'pending' && order.status !== 'pending' && order.status !== 'expired') toast('Pagamento confirmado! Enviando likes…', 'ok');
    schedule();
  } catch (err) {
    $('#loading').hidden = true;
    if (err.status === 404) $('#notFound').hidden = false; else toast(err.message, 'bad');
  }
}

function schedule() {
  clearTimeout(pollTimer);
  const active = ['pending', 'paid', 'delivering'].includes(order?.status);
  if (!active) return;
  const nextSoon = order.deliveries.some((d) => d.status === 'queued' && Date.parse(d.dueAt) - Date.now() < 120000);
  pollTimer = setTimeout(() => load(false), order.status === 'pending' || nextSoon ? 5000 : 30000);
}

$('#btnCopy').addEventListener('click', async () => {
  toast((await copy($('#copia').value)) ? 'Código PIX copiado!' : 'Não foi possível copiar. Selecione o texto manualmente.', 'ok');
});
$('#btnCheck').addEventListener('click', async () => {
  const b = $('#btnCheck');
  busy(b, true, 'Conferindo…');
  await load(true);
  busy(b, false);
  if (order?.status === 'pending') toast('Ainda não identificamos o pagamento. Pode levar alguns segundos.', 'warn');
});
$('#btnSimulate').addEventListener('click', async () => {
  try { await api(`/api/orders/${code}/simulate`, { method: 'POST', body: {} }); await load(false); } catch (err) { toast(err.message, 'bad'); }
});

api('/api/config').then((c) => {
  if (c.whatsapp) { const w = $('#whats'); w.href = `https://wa.me/${c.whatsapp.length <= 11 ? '55' + c.whatsapp : c.whatsapp}?text=${encodeURIComponent(`Olá! Sobre o pedido ${code}.`)}`; $('#whatsWrap').hidden = false; }
}).catch(() => {});
load(false);
