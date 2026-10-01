// Zyropay — páginas públicas: realce de código, abas com idioma lembrado, copiar, menu móvel e animação de entrada.
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safe = (fn) => { try { return fn(); } catch { return null; } };

  // ---------- realce de sintaxe (leve, sem biblioteca) ----------
  const KW = {
    js: 'const let var function return await async new if else for of in try catch throw import from export default require class typeof true false null undefined',
    php: 'function return new if else foreach as try catch throw echo use true false null array static public private class',
    py: 'def return import from as if else elif for in try except raise with class lambda True False None print',
    go: 'package import func return if else for range var const type struct defer err nil true false string byte int map interface go',
    rb: 'require def end return if else elsif do class module begin rescue true false nil puts',
    sh: 'curl export echo if then fi',
  };
  const RULES = {
    json: [['c', /\/\/[^\n]*/], ['p', /"(?:[^"\\\n]|\\.)*"(?=\s*:)/], ['s', /"(?:[^"\\\n]|\\.)*"/], ['n', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/], ['k', /\b(?:true|false|null)\b/]],
    http: [['c', /#[^\n]*/], ['k', /^(?:GET|POST|PUT|PATCH|DELETE|HTTP\/1\.1)\b/m], ['p', /^[A-Za-z-]+(?=:)/m], ['n', /\b\d+\b/]],
  };
  const generic = (lang) => {
    const kw = new RegExp(`\\b(?:${KW[lang].split(' ').join('|')})\\b`);
    const hash = lang === 'py' || lang === 'rb' || lang === 'sh';
    return [
      ['c', hash ? /#[^\n]*/ : /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
      ['s', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/],
      ['v', /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|@[A-Za-z_]+/],
      ...(lang === 'sh' ? [['f', /\B--?[A-Za-z][\w-]*/]] : []),
      ['k', kw],
      ['n', /\b\d+(?:\.\d+)?\b/],
      ['f', /\b[A-Za-z_][\w]*(?=\()/],
    ];
  };
  const ALIAS = { javascript: 'js', node: 'js', nodejs: 'js', python: 'py', ruby: 'rb', bash: 'sh', curl: 'sh', shell: 'sh', golang: 'go' };
  function highlight(code, lang) {
    lang = ALIAS[lang] || lang;
    const rules = RULES[lang] || (KW[lang] ? generic(lang) : null);
    if (!rules) return esc(code);
    const re = new RegExp(rules.map((r) => `(${r[1].source})`).join('|'), `g${rules.some((r) => r[1].flags.includes('m')) ? 'm' : ''}`);
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      if (!m[0]) { re.lastIndex++; continue; }
      const i = m.findIndex((v, n) => n > 0 && v !== undefined) - 1;
      out += esc(code.slice(last, m.index)) + `<span class="tk-${rules[i][0]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }

  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); safe(() => document.execCommand('copy')); t.remove();
    }
    const old = btn.textContent; btn.textContent = 'Copiado ✓'; setTimeout(() => { btn.textContent = old; }, 1500);
  }

  // o domínio dos exemplos acompanha o endereço em que a documentação está aberta
  const HOST = 'https://zyropay.app';
  const origin = window.__ZP_STATIC__ ? HOST : location.origin;

  // ---------- blocos soltos: <pre data-lang> ----------
  function build(pre, bar) {
    const lang = pre.dataset.lang || 'text';
    let raw = pre.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    const margin = Math.min(...raw.split('\n').filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    if (margin > 0 && margin < Infinity) raw = raw.split('\n').map((l) => l.slice(margin)).join('\n');
    raw = raw.split(HOST).join(origin);
    pre.dataset.raw = raw;
    pre.innerHTML = `<code>${highlight(raw, lang)}</code>`;
    if (bar) {
      const box = document.createElement('div');
      box.className = 'cb';
      box.innerHTML = `<div class="cb-bar"><span>${esc(pre.dataset.label || lang)}</span><button type="button">Copiar</button></div>`;
      pre.replaceWith(box);
      box.appendChild(pre);
      box.querySelector('button').onclick = (e) => copyText(raw, e.currentTarget);
    }
  }

  // ---------- abas ----------
  const KEY = 'zp_lang';
  const pref = () => safe(() => localStorage.getItem(KEY));
  function selectLang(name) {
    $$('.tabs').forEach((t) => {
      const btn = [...t.querySelectorAll('.tab-btn')].find((b) => b.dataset.tab === name);
      if (btn) pick(t, btn);
    });
  }
  function pick(tabs, btn) {
    tabs.querySelectorAll('.tab-btn').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    tabs.querySelectorAll('.tab-body').forEach((p) => { p.hidden = p.dataset.tab !== btn.dataset.tab; });
  }
  $$('.tabs').forEach((tabs) => {
    const pres = $$(':scope > pre[data-lang]', tabs);
    const list = document.createElement('div');
    list.className = 'tab-list'; list.setAttribute('role', 'tablist');
    pres.forEach((pre) => {
      const id = pre.dataset.tab || pre.dataset.lang;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tab-btn'; b.dataset.tab = id; b.setAttribute('role', 'tab'); b.textContent = pre.dataset.label || id;
      b.onclick = () => { pick(tabs, b); safe(() => localStorage.setItem(KEY, id)); selectLang(id); };
      list.appendChild(b);
      build(pre, false);
      const body = document.createElement('div');
      body.className = 'tab-body'; body.dataset.tab = id; body.setAttribute('role', 'tabpanel');
      body.innerHTML = '<button class="cp" type="button">Copiar</button>';
      pre.replaceWith(body);
      body.appendChild(Object.assign(document.createElement('div'), { className: 'cb' })).appendChild(pre);
      body.querySelector('.cp').onclick = (e) => copyText(pre.dataset.raw, e.currentTarget);
    });
    tabs.prepend(list);
    const first = list.querySelector('.tab-btn');
    const saved = pref();
    pick(tabs, [...list.children].find((b) => b.dataset.tab === saved) || first);
  });
  $$('pre[data-lang]').filter((p) => !p.closest('.tabs')).forEach((p) => build(p, !p.closest('.cb')));
  $$('[data-host]').forEach((el) => { el.textContent = origin; });

  // ---------- menu móvel ----------
  const burger = document.getElementById('burger'), mnav = document.getElementById('mnav');
  if (burger && mnav) {
    burger.addEventListener('click', () => { const open = mnav.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open)); });
    mnav.addEventListener('click', (e) => { if (e.target.closest('a')) { mnav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); } });
  }

  // ---------- entrada suave ----------
  const items = $$('.reveal');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    items.forEach((el) => io.observe(el));
  } else items.forEach((el) => el.classList.add('in'));

  window.ZP = { highlight, copyText };
})();
