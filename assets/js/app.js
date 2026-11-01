/* ============================================================
   Honey Money · демо «Мани читает новости за вас»
   Разборы — из живой ленты (live/server.py),
   а без сервера — из news_scoring_report.html (report.js).
   ============================================================ */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const { fmt } = window.HMReport;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** ссылки из лент и каналов — только http(s), иначе javascript: и прочее не пройдёт */
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? esc(String(u).trim()) : '#');
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
  const pct = (v) => Math.round((v || 0) * 100) + '%';
  const store = {
    get(k, d) { try { const v = localStorage.getItem('hm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hm.' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };

  /* Примеры в консоли: номер из отчёта + понятный заголовок.
     Если номера в отчёте нет, пример просто не показывается. */
  const SCENARIOS = [
    { id: 'N26', hook: 'Сделка на 47 млрд ₽ — и подозрительная дата' },
    { id: 'B01', hook: 'Эмитент не заплатил по облигациям' },
    { id: 'B16', hook: 'EBITDA выросла на 36,8% за год' },
    { id: 'B19', hook: 'Совет директоров: дивидендов не будет' },
    { id: 'N15', hook: 'Треть держателей вышла из выпуска' },
    { id: 'N03', hook: 'Обычный купон — стоит ли волноваться?' },
    { id: 'B02', hook: 'Правила промолчали, AI-аналитик заметил дефолт' },
    { id: 'B21', hook: 'Дивиденды, которые рынок и так ждал' },
  ];

  let R = null;
  let current = null;
  let runToken = 0;
  let scenarios = [];
  const isLive = () => !!(R && R.live);
  const hm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  /* ---------- имена и тикеры ---------- */
  /** «ООО "Оил Ресурс"» → «Оил Ресурс», «ПАО "АНК "Башнефть"» → «Башнефть» */
  function shortName(issuer) {
    const parts = String(issuer || '').split('"').map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : String(issuer || '');
  }
  function ticker(it) {
    if (it.ticker) return it.ticker;
    const m = /акции\s+([A-Z]{3,6})/.exec(it.target || '');
    return m ? m[1] : null;
  }
  function badge(it) {
    const t = ticker(it); if (t) return t.slice(0, 4);
    const words = shortName(it.issuer).split(/[\s-]+/).filter(Boolean);
    return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : words[0].slice(0, 2)).toUpperCase();
  }
  const target = (it) => it.target || 'бумаги эмитента';
  /** Агент модели ссылается на номера заголовков своего промпта — на сайте заголовки показаны списком */
  const noRefs = (s) => String(s || '').replace(/\s*\((?:заголов[а-яё]*|№)\s*[\d,\sи–-]+\)/gi, '').replace(/\s+([,.;])/g, '$1');
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/[\s,.;:]+\S*$/, '') + '…' : s);

  /* ---------- как Мани формулирует вердикт ---------- */
  function mood(it) {
    if (it.score == null) return { key: 'neu', word: 'Нет данных', title: 'агент не оценил бумагу', img: 'zen', short: 'нет данных' };
    const t = it.verdict.tone; const s = it.strength;
    if (s === 'none' || t === 'neu') return { key: 'neu', word: 'Шум', title: 'на цену почти не влияет', img: 'coffee', short: 'нейтрально' };
    if (t === 'pos') return s === 'signal'
      ? { key: 'pos', word: 'Плюс', title: 'скорее хорошая новость', img: 'point', short: 'позитив' }
      : { key: 'pos weak', word: 'Слабый плюс', title: 'есть повод присмотреться', img: 'tablet', short: 'слабый позитив' };
    return s === 'signal'
      ? { key: 'neg', word: 'Минус', title: 'тревожная новость', img: 'arms', short: 'негатив' }
      : { key: 'neg weak', word: 'Слабый минус', title: 'есть повод насторожиться', img: 'book', short: 'слабый негатив' };
  }
  const level = (v, hi, lo) => (v >= hi ? 'высокая' : v >= lo ? 'средняя' : 'низкая');
  const toneOf = (v) => (v && v.weak ? 'neu' : v && v.tone);

  /** Ответ Мани в одну-две фразы */
  function oneLine(it) {
    if (it.set === 'live') return oneLineLive(it);
    const m = mood(it); const p = [];
    const fails = it.checks.filter((c) => c.cls === 'fail');
    const oks = it.checks.filter((c) => c.cls === 'ok');
    if (m.key === 'neu') p.push((it.significance || 0) >= 0.6 ? 'Направление по тексту не определить, но событие важное.' : 'Рутинное сообщение — на цену почти не влияет.');
    else p.push(`Для «${target(it)}» — ${m.key.startsWith('pos') ? 'скорее плюс' : 'скорее минус'}${it.strength === 'weak' ? ', но слабый' : ''}.`);
    if (fails.length) p.push('Нашёл расхождение — поэтому доверяю выводу меньше.');
    else if (oks.length) p.push(oks.length === 1 ? 'Цифры перепроверил — сошлось.' : `Перепроверил цифры — ${oks.length} из ${it.checks.length} сошлись.`);
    const c = it.compare;
    if (c && c.llm && c.base && c.llm.label && toneOf(c.llm) !== toneOf(c.base)) p.push(`С AI-аналитиками вывод другой: «${c.llm.label}».`);
    return p.join(' ');
  }

  function oneLineLive(it) {
    const m = mood(it); const p = [];
    const n = it.n_claims || 0;
    const heads = `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'заголовок' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'заголовка' : 'заголовков'}`;
    if (it.score == null) {
      p.push(`По ${it.issuer} в журнале ${heads}, но агент новостей бумагу не оценил — модель пишет «нет данных».`);
      return p.join(' ');
    }
    if (m.key === 'neu') p.push('Агент считает, что на цену это почти не влияет.');
    else p.push(`Для «${target(it)}» — ${m.key.startsWith('pos') ? 'скорее плюс' : 'скорее минус'}${it.strength === 'weak' ? ', но слабый' : ''}.`);
    const why = it.explain.find((e) => e.kind === 'вывод');
    if (why && why.text) p.push(noRefs(why.text).replace(/\.?$/, '.'));
    return p.join(' ');
  }

  /** Самое важное в разборе */
  function keyPoint(it) {
    const f = it.checks.find((c) => c.cls === 'fail');
    if (f) return { kind: 'fail', label: 'Расхождение', title: f.title, text: f.text, tab: 'checks' };
    const w = it.checks.find((c) => c.cls === 'warn');
    if (w) return { kind: 'warn', label: 'Оговорка', title: w.title, text: w.text, tab: 'checks' };
    if (it.watch.length) return { kind: 'info', label: 'Что дальше', title: '', text: it.watch[0], tab: 'checks' };
    return null;
  }

  /* ============================================================
     ПЕРВЫЙ ЭКРАН: чипы и бегущая лента
     ============================================================ */
  function renderHero() {
    const sig = R.items.filter((it) => it.strength === 'signal');
    const pos = sig.filter((it) => it.verdict.tone === 'pos').sort((a, b) => (b.significance || 0) - (a.significance || 0))[0];
    const neg = sig.filter((it) => it.verdict.tone === 'neg').sort((a, b) => a.score - b.score)[0];
    const failIt = R.items.find((it) => it.checks.some((c) => c.cls === 'fail'));
    const okIt = R.items.find((it) => it !== failIt && it.checks.some((c) => c.cls === 'ok'));
    const chip = (it, body, cls) => it ? `<button type="button" class="chip ${cls}" data-id="${esc(it.id)}" tabindex="-1">${body}</button>` : '';
    const mk = (it) => `<i class="dot ${it.verdict.tone}"></i><b>${esc(ticker(it) || shortName(it.issuer))}</b><span class="num">${fmt(it.score, { sign: true })}</span><small>${esc(clip(it.kind, 26))}</small>`;
    $('#heroChips').innerHTML = [
      chip(pos, pos && mk(pos), 'c1'),
      chip(neg, neg && mk(neg), 'c2'),
      chip(failIt, failIt && `<i class="ico fail">✕</i><b>${esc(failIt.checks.find((c) => c.cls === 'fail').title)}</b><small>${esc(shortName(failIt.issuer))}</small>`, 'c3'),
      chip(okIt, okIt && `<i class="ico ok">✓</i><b>${esc(okIt.checks.find((c) => c.cls === 'ok').title)}</b><small>сошлось</small>`, 'c4'),
    ].join('');

    if (PRICES) { renderTape(true); return; }            // есть котировки — лента цен, иначе сигналы отчёта
    const list = R.items.filter((it) => it.strength !== 'none').sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
    const row = list.map((it) => {
      const t = it.verdict.tone;
      return `<button type="button" class="tk-i ${t}" data-id="${esc(it.id)}"><b>${esc(ticker(it) || shortName(it.issuer))}</b><i>${t === 'pos' ? '▲' : '▼'}</i><span class="num">${fmt(it.score, { sign: true })}</span><small>${esc(clip(it.kind, 34))}</small></button>`;
    }).join('');
    $('#tickerTrack').innerHTML = `<div class="ticker__set">${row}</div><div class="ticker__set" aria-hidden="true">${row}</div>`;
    $('#tickerTrack').style.setProperty('--dur', Math.max(30, list.length * 3.2) + 's');
  }
  function openFromOutside(e) {
    const b = e.target.closest('[data-id]'); if (!b) return;
    ask(b.dataset.id);
    $('#demo').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
  $('#tickerTrack').addEventListener('click', openFromOutside);
  $('#heroChips').addEventListener('click', openFromOutside);

  /* ---------- бегущая лента цен: первый эшелон (MOEXBC) из T-Invest или ISS Мосбиржи ---------- */
  let PRICES = null;
  const dec = (x) => (x < 1 ? 4 : x < 10000 ? 2 : 0);
  const priceFmt = (x) => x.toLocaleString('ru-RU', { minimumFractionDigits: dec(x), maximumFractionDigits: dec(x) });
  const chgFmt = (c) => (c == null ? '' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
  function tapeItem(p) {
    const tone = p.change == null || p.change === 0 ? 'neu' : p.change > 0 ? 'pos' : 'neg';
    const open = R && R.byId && R.byId[p.ticker];          // по бумаге есть разбор Мани — клик открывает его
    const tag = open ? 'button' : 'span';
    const attrs = open ? ` type="button" data-id="${esc(p.ticker)}" title="${esc(p.name)} — открыть разбор Мани"` : ` title="${esc(p.name)}"`;
    return `<${tag} class="tk-i ${tone}${open ? ' has' : ''}" data-tk="${esc(p.ticker)}" data-last="${p.last}"${attrs}><b>${esc(p.ticker)}</b>`
      + `<span class="num">${priceFmt(p.last)}&nbsp;₽</span><i>${tone === 'pos' ? '▲' : tone === 'neg' ? '▼' : '•'}</i><small>${chgFmt(p.change)}</small></${tag}>`;
  }
  function renderTape(force) {
    const P = PRICES; const track = $('#tickerTrack');
    const key = P.items.map((p) => p.ticker).join(',') + '|' + P.source;
    if (!force && track.dataset.key === key) {               // те же бумаги — меняем на месте, бег ленты не сбивается
      P.items.forEach((p) => track.querySelectorAll(`[data-tk="${p.ticker}"]`).forEach((el) => {
        const old = parseFloat(el.dataset.last);
        if (old === p.last) return;
        el.insertAdjacentHTML('afterend', tapeItem(p));
        const fresh = el.nextElementSibling; el.remove();
        fresh.classList.add(p.last > old ? 'up' : 'down');
      }));
      return;
    }
    const src = P.source === 'T-Invest' ? 'T-Invest' : 'Мосбиржа · −15 мин';
    const row = `<span class="tk-src">Первый эшелон · ${esc(src)}</span>` + P.items.map(tapeItem).join('');
    track.innerHTML = `<div class="ticker__set">${row}</div><div class="ticker__set" aria-hidden="true">${row}</div>`;
    track.dataset.key = key;
    track.style.setProperty('--dur', Math.max(30, P.items.length * 3.4) + 's');
    $('#ticker').setAttribute('aria-label', `Котировки первого эшелона, источник ${src}`);
  }
  async function pollPrices() {
    const P = await window.HMReport.loadPrices();
    if (P && P.items && P.items.length) { const first = !PRICES; PRICES = P; renderTape(first); }
    if (P) setTimeout(pollPrices, (P.every_s || 15) * 1000);   // null — сервера нет (GitHub Pages): лента сигналов
    else if (PRICES) setTimeout(pollPrices, 60000);           // сервер был — сеть моргнула, пробуем снова
  }
  pollPrices();

  // лёгкий параллакс чипов за курсором
  if (finePointer && !reduced) {
    const hero = $('.hero');
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
      $$('.chip', hero).forEach((c, i) => { const d = 14 + i * 9; c.style.translate = `${-x * d}px ${-y * d}px`; });
    });
  }

  /* ============================================================
     КОНСОЛЬ: примеры, поиск, ответ
     ============================================================ */
  /** Живые примеры: самые значимые, по одному на бумагу, сначала с направлением */
  function liveScenarios() {
    const rank = (it) => (it.score == null ? 0 : 1 + Math.abs(it.score) * (it.confidence || 0)) + Math.min(0.5, (it.n_claims || 0) * 0.05);
    const out = []; const seen = new Set();
    R.items.slice().sort((a, b) => rank(b) - rank(a)).forEach((it) => {
      if (out.length < 8 && !seen.has(it.ticker)) { seen.add(it.ticker); out.push({ id: it.id, hook: clip(it.title, 72) }); }
    });
    return out;
  }

  function renderTickets() {
    if (isLive()) {
      scenarios = liveScenarios();
      renderTicketList();
      const L = R.live;
      const scored = R.items.filter((it) => it.score != null).length;
      $('#demoAside').innerHTML = `Живая лента модели: <b>${R.items.length} бумаг в новостях</b>, агент оценил ${scored} · ${L.items_total} заголовков за ${L.window_h} ч из ${L.sources_active} источников · обновлено в ${hm(L.updated_at)}`;
      return;
    }
    const list = SCENARIOS.filter((s) => R.byId[s.id]);
    scenarios = list.length ? list : R.items.slice().sort((a, b) => (b.significance || 0) - (a.significance || 0)).slice(0, 8).map((it) => ({ id: it.id, hook: it.kind }));
    renderTicketList();
    $('#demoAside').innerHTML = `Настоящие раскрытия из отчёта — <b>${R.items.length} новостей</b>. Выберите пример или найдите свою.`;
  }
  function renderTicketList() {
    $('#tickets').innerHTML = scenarios.map((sc) => {
      const it = R.byId[sc.id]; const m = mood(it);
      return `<button type="button" class="ticket ${m.key}" data-id="${esc(it.id)}">
        <span class="ticket__b">${esc(badge(it))}</span>
        <span class="ticket__body"><b>${esc(sc.hook)}</b><small>${esc(shortName(it.issuer))} · ${esc(it.time ? it.date.slice(0, 5) + ' ' + it.time : it.date)}</small></span>
        <span class="ticket__s num">${fmt(it.score, { sign: true })}</span>
      </button>`;
    }).join('');
    $$('.ticket').forEach((b) => b.classList.toggle('sel', !!current && b.dataset.id === current.id));
  }
  $('#tickets').addEventListener('click', (e) => { const b = e.target.closest('.ticket'); if (b) ask(b.dataset.id, { scroll: true }); });

  /* ---------- поиск с подсказками ---------- */
  const q = $('#q'); const sug = $('#suggest');
  let sugItems = []; let sugIdx = -1;
  function matches(text) {
    const t = text.trim().toLowerCase();
    if (!t) return [];
    const SYN = { дефолт: ['дефолт', 'неисполн'], купон: ['купон', 'доход'], сделк: ['сделк'], рейтинг: ['рейтинг'], банкрот: ['банкрот'], прибыл: ['прибыл', 'рсбу', 'мсфо', 'отчёт'], дивиден: ['дивиден'] };
    const stem = (w) => (w.length > 5 ? w.slice(0, -2) : w.length > 4 ? w.slice(0, -1) : w);
    const words = t.split(/\s+/).map((w) => {
      const s = stem(w); const syn = Object.keys(SYN).find((k) => s.startsWith(k) || k.startsWith(s));
      return syn && s.length >= 4 ? SYN[syn] : [s];
    });
    const score = (it) => {
      const head = [it.id, it.issuer, it.kind, it.target, it.date, it.title, it.ticker].join(' ').toLowerCase();
      const body = [...it.explain.map((e) => e.text), ...it.checks.map((c) => c.title + ' ' + c.text), ...it.opinions.map((o) => o.text)].join(' ').toLowerCase();
      let s = 0;
      for (const alts of words) {
        if (alts.some((a) => head.includes(a))) s += 2;
        else if (alts.some((a) => body.includes(a))) s += 1;
        else return 0;
      }
      return s;
    };
    return R.items.map((it) => [it, score(it)]).filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || (b[0].significance || 0) - (a[0].significance || 0)).slice(0, 6).map(([it]) => it);
  }
  function renderSuggest() {
    sugItems = matches(q.value); sugIdx = sugItems.length ? 0 : -1;
    if (!q.value.trim()) { sug.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
    sug.hidden = false; q.setAttribute('aria-expanded', 'true');
    sug.innerHTML = sugItems.length ? sugItems.map((it, i) => `<li role="option" data-id="${esc(it.id)}" class="${i === sugIdx ? 'on' : ''}">
        <i class="dot ${toneOf({ tone: it.verdict.tone, weak: it.strength === 'none' })}"></i>
        <span><b>${esc(shortName(it.issuer))}</b><small>${esc(clip(it.kind, 40))} · ${esc(it.date)}</small></span>
        <em class="num">${fmt(it.score, { sign: true })}</em></li>`).join('')
      : (isLive() ? '<li class="empty">Такой бумаги в ленте пока нет. Попробуйте «ВТБ», «Сбер» или «прибыль».</li>'
        : '<li class="empty">Такой новости в отчёте нет. Попробуйте «Роснефть», «облигации» или «дивиденды».</li>');
  }
  q.addEventListener('input', renderSuggest);
  q.addEventListener('focus', () => { if (q.value.trim()) renderSuggest(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sugItems.length) return; e.preventDefault();
      sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length;
      $$('li', sug).forEach((li, i) => li.classList.toggle('on', i === sugIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault(); if (sugItems[sugIdx]) pick(sugItems[sugIdx].id);
    } else if (e.key === 'Escape') { sug.hidden = true; }
  });
  sug.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-id]'); if (li) { e.preventDefault(); pick(li.dataset.id); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('#search')) sug.hidden = true; });
  function pick(id) { sug.hidden = true; q.value = ''; q.blur(); ask(id, { scroll: true }); }

  /* ---------- ответ Мани ---------- */
  const STEP_HINT = [
    ['сборщик', 'Смотрю журнал сборщика новостей'],
    ['журнал', 'Склеиваю записи по claim_id'],
    ['отбор', 'Отбираю самые важные и свежие заголовки'],
    ['агент', 'Спрашиваю агента новостей'],
    ['схем', 'Проверяю ответ агента по схеме'],
    ['сверк', 'Сверяю с прошлой оценкой'],
    ['факты', 'Вынимаю факты и цифры из текста'],
    ['правила', 'Применяю правила для этого вида события'],
    ['проверки', 'Пересчитываю арифметику, сверяю даты'],
    ['истори', 'Сравниваю с прошлыми сообщениями эмитента'],
    ['аналитик', 'Спрашиваю AI-аналитиков'],
    ['калибр', 'Считаю оценку формулой'],
    ['карточк', 'Собираю ответ'],
  ];
  const hintFor = (label) => { const h = STEP_HINT.find(([k]) => label.toLowerCase().includes(k)); return h ? h[1] : label; };

  async function ask(id, opts) {
    const it = R.byId[id]; if (!it) return;
    current = it;
    const tok = ++runToken;
    if (!(opts && opts.silent)) history.replaceState(null, '', '#' + id);
    $$('.ticket').forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
    const stage = $('#stage');
    // на телефоне ответ под списком — подкручиваем к нему
    if (opts && opts.scroll && matchMedia('(max-width: 900px)').matches) stage.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

    const steps = R.method.flow;
    stage.classList.add('busy');
    let scan = $('.scan', stage);
    if (!scan) {
      stage.insertAdjacentHTML('beforeend', `<div class="scan"><img src="assets/img/mani/laptop.webp" alt="" width="900" height="575"><div class="scan__t"><b>Мани читает…</b><span id="scanMsg"></span></div><ol class="scan__bar">${steps.map(() => '<li></li>').join('')}</ol></div>`);
      scan = $('.scan', stage);
    }
    window.dispatchEvent(new CustomEvent('mani:thinking', { detail: { id, issuer: shortName(it.issuer), silent: !!(opts && opts.silent) } }));
    const bars = $$('.scan__bar li', scan);
    bars.forEach((b) => { b.className = ''; });
    for (let i = 0; i < steps.length; i++) {
      if (tok !== runToken) return;
      const skip = steps[i].type === 'opt' && !it.opinions.length;
      const skipMsg = it.set === 'live' ? 'Агент не оценил бумагу — «нет данных»' : 'Без AI-аналитиков — хватает правил';
      $('#scanMsg', scan).textContent = `${i + 1}/${steps.length} · ${skip ? skipMsg : hintFor(steps[i].label)}`;
      bars[i].className = skip ? 'skip' : 'done';
      await wait(170);
    }
    if (tok !== runToken) return;
    stage.classList.remove('shown');
    stage.innerHTML = answerHTML(it);
    stage.classList.remove('busy');
    $$(':scope > *', stage).forEach((el, i) => el.style.setProperty('--k', i));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      stage.classList.add('shown');
      window.dispatchEvent(new CustomEvent('mani:answer', { detail: Object.assign({ id, line: oneLine(it), silent: !!(opts && opts.silent) }, mood(it)) }));
    }));
  }

  function gauge(score) {
    const s = Math.max(-1, Math.min(1, score || 0));
    // дуга от −1 (слева) до +1 (справа); стрелка поворачивается на s·90°
    const pt = (u) => [100 - 80 * Math.cos(Math.PI * u), 100 - 80 * Math.sin(Math.PI * u)];
    const arc = (v0, v1) => {
      const [x0, y0] = pt((v0 + 1) / 2); const [x1, y1] = pt((v1 + 1) / 2);
      return `M${x0.toFixed(1)} ${y0.toFixed(1)} A80 80 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    };
    return `<svg class="gauge" viewBox="0 0 200 112" aria-hidden="true">
      <path d="${arc(-1, -0.17)}" class="g-neg"/>
      <path d="${arc(-0.13, 0.13)}" class="g-neu"/>
      <path d="${arc(0.17, 1)}" class="g-pos"/>
      <g class="needle" style="--a:${(s * 90).toFixed(1)}deg"><path d="M100 100 L100 34"/><circle cx="100" cy="100" r="7"/></g>
    </svg>`;
  }
  function ring(v) {
    const c = 2 * Math.PI * 34;
    return `<svg class="ring" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" class="r-bg"/><circle cx="40" cy="40" r="34" class="r-fg" style="--c:${c.toFixed(1)};--o:${(c * (1 - Math.max(0, Math.min(1, v || 0)))).toFixed(1)}"/></svg>`;
  }

  const ICON = { ok: '✓', warn: '!', fail: '✕', info: 'i' };
  function tabsFor(it) {
    const t = [];
    if (it.checks.length || it.watch.length) t.push(['checks', 'Проверки', it.checks.length || '']);
    const live = it.set === 'live';
    if (it.explain.length) t.push(['facts', live ? 'Что пишут' : 'Что в тексте', it.explain.filter((e) => e.kind !== 'вывод').length]);
    if (it.opinions.length) t.push(['ai', live ? 'Агент новостей' : 'Спор AI-аналитиков', it.opinions.length]);
    if (it.compare && it.compare.label) t.push(['cmp', 'Сверка с банком', '']);
    return t;
  }
  function paneHTML(it, tab) {
    if (tab === 'checks') {
      return `${it.checks.length ? `<ul class="checks">${it.checks.map((ch) => `<li class="${ch.cls}"><i>${ICON[ch.cls]}</i><div><b>${esc(ch.title)}</b><p>${esc(ch.text)}</p></div><span>${esc(ch.status)}</span></li>`).join('')}</ul>` : ''}
        ${it.watch.length ? `<div class="watch"><b>Что смотреть дальше</b>${it.watch.map((w) => `<p>${esc(w)}</p>`).join('')}</div>` : ''}`;
    }
    if (tab === 'facts') {
      return `<ul class="facts">${it.explain.map((e) => `<li class="${e.kind === 'вывод' ? 'out' : ''}${e.cited ? ' cited' : ''}"><span>${esc(e.kind)}</span><p>${esc(it.set === 'live' ? noRefs(e.text) : e.text)}${e.quotes.length ? `<br>${e.quotes.map((x) => `<mark>«${esc(x)}»</mark>`).join(' ')}` : ''}${e.url ? `<a class="src" href="${safeUrl(e.url)}" target="_blank" rel="noopener">${esc(e.time || '')}${e.cited ? ' · учёл агент' : ''} · открыть ↗</a>` : ''}</p></li>`).join('')}</ul>`;
    }
    if (tab === 'ai') {
      return `<div class="ops">${it.opinions.map((o) => `<div class="op">
        <div class="op__h"><b>${esc(o.role)}</b><code>${esc(o.model)}</code></div>
        <div class="op__scale" title="влияние ${o.impact} по шкале от −2 до +2">${[-2, -1, 0, 1, 2].map((v) => `<i class="${v === o.impact ? (v > 0 ? 'p' : v < 0 ? 'n' : 'z') : ''}"></i>`).join('')}<span class="num">${o.impact > 0 ? '+' : ''}${o.impact}</span></div>
        <p>${esc(it.set === 'live' ? noRefs(o.text) : o.text)}</p></div>`).join('')}</div>
        <p class="pane__note">${it.set === 'live' ? 'Агент новостей оценивает бумагу по заголовкам за последние часы. Шкала от −2 до +2.' : 'Модели дают доводы, итог считает формула с учётом их неуверенности.'}</p>`;
    }
    if (tab === 'cmp') {
      const c = it.compare;
      const cell = (name, v) => v && v.label ? `<div class="cmp__c ${v.hit === true ? 'hit' : v.hit === false ? 'miss' : 'ref'}"><small>${name}</small><b class="tone ${toneOf(v)}">${esc(v.label)}</b><span>${v.hit === true ? '✓ совпало' : v.hit === false ? '✕ не совпало' : 'эталон'}</span></div>` : '';
      return `<div class="cmp">${cell('Аналитик банка', c.label)}${cell('Мани', c.base)}${cell('Мани + AI', c.llm)}</div>
        ${it.example && it.example.note ? `<p class="pane__note">${esc(it.example.note)}</p>` : ''}`;
    }
    return '';
  }

  function answerHTML(it) {
    const m = mood(it); const k = keyPoint(it); const tabs = tabsFor(it);
    const conf = it.confidence || 0; const sig = it.significance || 0; const nc = it.n_claims || 0;
    const live = it.set === 'live';
    return `
      <div class="st-head">
        <span class="st-id">${esc(it.id)}</span>
        <span class="st-what">${esc(shortName(it.issuer))} · ${esc(clip(it.kind, 60))} · ${esc(it.date)}${it.time ? ' ' + esc(it.time) : ''}</span>
        <button type="button" class="st-link" data-act="link" title="Скопировать ссылку на разбор">ссылка ↗</button>
      </div>
      ${it.title && it.set === 'live' ? `<p class="st-title">${it.links && it.links[0] ? `<a href="${safeUrl(it.links[0].url)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}<small>${esc((it.sources || []).join(' · '))}</small></p>` : ''}

      <div class="verdict ${m.key}">
        <img class="verdict__mani" src="assets/img/mani/${m.img}.webp" alt="Мани">
        <div class="verdict__txt">
          <p class="caps">Вердикт Мани · ${esc(clip(target(it), 48))}</p>
          <h3><span class="vw">${m.word}</span> <span class="vt">— ${m.title}</span></h3>
          <p>${esc(oneLine(it))}</p>
        </div>
      </div>

      <div class="meters">
        <div class="meter meter--g ${m.key}" title="Оценка влияния на цену: от −1 до +1. Около нуля — шум.">
          ${gauge(it.score)}
          <b class="num">${fmt(it.score, { sign: true })}</b><span>влияние на цену</span>
        </div>
        <div class="meter" title="Насколько Мани уверен в выводе: сошлись ли проверки.">
          <div class="meter__r">${ring(conf)}<b class="num">${fmt(it.confidence)}</b></div>
          <span>уверенность</span><small>${it.confidence == null ? 'нет данных' : level(conf, 0.7, 0.45)}</small>
        </div>
        ${live ? `<div class="meter" title="Сколько заголовков по бумаге за последние часы.">
          <div class="meter__r">${ring(Math.min(1, nc / 10))}<b class="num">${nc}</b></div>
          <span>заголовков</span><small>${esc((it.sources || []).length + ' ист.')}</small>
        </div>` : `<div class="meter" title="Насколько событие важно для эмитента.">
          <div class="meter__r">${ring(sig)}<b class="num">${fmt(it.significance)}</b></div>
          <span>значимость</span><small>${level(sig, 0.6, 0.25)}</small>
        </div>`}
      </div>

      ${k ? `<button type="button" class="key ${k.kind}" data-tab="${k.tab}"><i>${k.kind === 'fail' ? '✕' : k.kind === 'warn' ? '!' : '→'}</i><span><b>${k.label}${k.title ? ': ' + esc(k.title.toLowerCase()) : ''}.</b> ${esc(clip(k.text, 170))}</span></button>` : ''}

      ${tabs.length ? `<div class="tabs" role="tablist">${tabs.map(([key, label, n], i) => `<button type="button" role="tab" data-tab="${key}" aria-selected="${i === 0}">${label}${n !== '' ? ` <sup>${n}</sup>` : ''}</button>`).join('')}</div>
      <div class="pane" id="pane">${paneHTML(it, tabs[0][0])}</div>` : ''}

      <div class="decide">
        <span>Ваше решение</span>
        <div class="decide__btns">
          <button type="button" data-d="act">Действую</button>
          <button type="button" data-d="wait">Отложу</button>
          <button type="button" data-d="skip">Не буду</button>
        </div>
        <small>Мани не совершает сделок — выбор уйдёт в журнал</small>
      </div>`;
  }

  $('#stage').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t && current) {
      const key = t.dataset.tab;
      $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === key)));
      const pane = $('#pane'); pane.innerHTML = paneHTML(current, key);
      pane.classList.remove('flip'); void pane.offsetWidth; pane.classList.add('flip');
      if (t.classList.contains('key')) pane.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
      return;
    }
    const d = e.target.closest('[data-d]'); if (d && current) { decide(current, d.dataset.d); return; }
    const l = e.target.closest('[data-act="link"]');
    if (l && current) {
      const url = location.href.split('#')[0] + '#' + current.id;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Ссылка на разбор скопирована'), () => toast(url));
    }
  });

  /* ---------- журнал решений ---------- */
  const DEC = { act: 'Действую', wait: 'Отложу', skip: 'Не буду' };
  let journal = store.get('journal', []);
  function decide(it, d) {
    journal.unshift({ id: it.id, issuer: shortName(it.issuer), kind: it.kind, mood: mood(it).short, score: it.score, conf: it.confidence, d, at: Date.now() });
    journal = journal.slice(0, 50);
    store.set('journal', journal);
    renderJournal();
    $$('.decide [data-d]').forEach((b) => b.classList.toggle('chosen', b.dataset.d === d));
    toast(`В журнале: «${DEC[d]}» · ${it.id}`);
    window.dispatchEvent(new CustomEvent('mani:decide', { detail: { d, id: it.id } }));
    const btn = $('#journalBtn'); btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
  }
  function renderJournal() {
    $('#journalCount').textContent = journal.length;
    $('#jlist').innerHTML = journal.length ? journal.map((j) => `<li><span class="jd ${j.d}">${DEC[j.d]}</span><div><b>${esc(j.id)} · ${esc(j.issuer)}</b><span>${esc(j.kind)}</span><small>Мани: ${esc(j.mood)} ${fmt(j.score, { sign: true })} · уверенность ${fmt(j.conf)} · ${new Date(j.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div></li>`).join('')
      : '<li class="empty"><img src="assets/img/mani/zen.webp" alt="" width="900" height="780">Пока пусто. Примите решение по любой новости — оно появится здесь.</li>';
  }
  function drawer(open) { $('#drawer').hidden = !open; $('#scrim').hidden = !open; }
  $('#journalBtn').addEventListener('click', () => drawer(true));
  $('#drawerClose').addEventListener('click', () => drawer(false));
  $('#scrim').addEventListener('click', () => drawer(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') drawer(false); });
  $('#jclear').addEventListener('click', () => { journal = []; store.set('journal', journal); renderJournal(); });
  renderJournal();

  /* ============================================================
     ТОЧНОСТЬ: крупные цифры, график, разборы
     ============================================================ */
  function renderTrust() {
    $('#trustAside').textContent = `${R.blind.items.length} раскрытий, которых Мани раньше не видел. Ответы сверили с разметкой аналитика банка.`;
    $('#bento').innerHTML = R.brief.map((b, i) => {
      const cap = b.text.split(/[:.]/)[0];
      return `<div class="tile ${i === 1 ? 'tile--lime' : ''}" data-reveal style="--d:${i * 0.08}s" title="${esc(b.text)}"><b class="num">${esc(b.value)}</b><span>${esc(cap)}</span></div>`;
    }).join('');

    $('#vbars').innerHTML = R.blind.bars.map((b) => `
      <div class="vb ${b.main ? 'main' : b.second ? 'second' : 'base'}" data-tip="${esc(b.title)}: ${b.hits} из ${b.total} · интервал ${pct(b.lo)}–${pct(b.hi)}">
        <div class="vb__col">
          <span class="vb__bar" style="--h:${(b.rate || 0) * 100}%"></span>
          <b class="vb__v num" style="bottom:${Math.max(b.rate || 0, b.hi || 0) * 100}%">${pct(b.rate)}</b>
          <span class="vb__ci" style="bottom:${(b.lo || 0) * 100}%;height:${((b.hi || 0) - (b.lo || 0)) * 100}%"></span>
        </div>
        <span class="vb__l">${esc(b.title)}</span>
      </div>`).join('');

    const tag = (t) => /^Верный/.test(t) ? ['ok', '✓ верно'] : /^Аналитики/.test(t) ? ['ai', '★ AI помогли'] : ['miss', '✕ ошибка'];
    $('#cases').innerHTML = R.blind.examples.map((e) => {
      const [cls, lbl] = tag(e.title || '');
      const cut = (e.title || '').indexOf(':');
      const head = cut > -1 ? e.title.slice(cut + 1).trim() : (e.title || '');
      return `<button type="button" class="case ${cls}" data-id="${esc(e.id)}"><span class="case__tag">${lbl}</span><b>${esc(head.charAt(0).toUpperCase() + head.slice(1))}</b><small>${esc(shortName(e.issuer))} · ${esc(e.id)} <i>→</i></small></button>`;
    }).join('');
    observeReveal();
  }
  $('#cases').addEventListener('click', openFromOutside);

  // подсказка над столбиками
  const tip = $('#tip');
  $('#vbars').addEventListener('pointermove', (e) => {
    const b = e.target.closest('.vb'); if (!b) { tip.hidden = true; return; }
    const r = $('.chart').getBoundingClientRect();
    tip.hidden = false; tip.textContent = b.dataset.tip;
    tip.style.left = Math.min(r.width - tip.offsetWidth - 8, Math.max(8, e.clientX - r.left + 14)) + 'px';
    tip.style.top = (e.clientY - r.top - 48) + 'px';
  });
  $('#vbars').addEventListener('pointerleave', () => { tip.hidden = true; });

  /* ============================================================
     КАК УСТРОЕН
     ============================================================ */
  const HELP = [
    ['сборщик', 'Ленты, сайты и Telegram — раз в 1–3 минуты, Telegram подпиской за секунды'],
    ['журнал', 'Каждая запись — один claim_id: повторы из разных журналов склеиваются'],
    ['отбор', 'Из потока выбираются самые важные и свежие заголовки, служебные сообщения отсеиваются'],
    ['агент', 'LLM на открытой модели оценивает бумаги от −1 до +1, уверенность и почему'],
    ['схем', 'Ответ проверяется по схеме, при ошибке — один повтор, иначе «нет данных»'],
    ['сверк', 'Если оценка резко развернулась без новой новости, это помечается'],
    ['факты', 'Вынимает факты и цифры, помечает, где они в тексте'],
    ['правила', 'Свои правила для купона, сделки, решения СД, дефолта, рейтинга'],
    ['проверки', 'Пересчитывает арифметику, сверяет даты и контрагентов'],
    ['истори', 'Сравнивает с прошлыми сообщениями того же эмитента'],
    ['аналитик', 'AI-аналитики на открытых моделях спорят и дают доводы'],
    ['калибр', 'Формула сводит всё в оценку — не языковая модель'],
    ['карточк', 'На что влияет, в какую сторону, насколько важно и почему'],
  ];
  const HOW_ASIDE = $('#how .sec-head__aside').innerHTML;
  function renderHow() {
    $('#how .sec-head__aside').innerHTML = isLive()
      ? 'Живая лента: новости собираются и оцениваются автоматически. Сделок Мани не совершает.'
      : HOW_ASIDE;
    $('#steps').innerHTML = R.method.flow.map((s, i) => {
      const h = HELP.find(([k]) => s.label.toLowerCase().includes(k));
      return `<li class="step ${s.type}" data-reveal style="--d:${i * 0.05}s"><span class="step__n num">${String(i + 1).padStart(2, '0')}</span><b>${esc(s.label)}</b><p>${h ? h[1] : ''}</p><em>${s.type === 'opt' ? 'опционально' : s.type === 'core' ? 'ядро' : ''}</em></li>`;
    }).join('');
    observeReveal();
  }

  // «змейка» из презентации рисуется по мере прокрутки
  const path = $('#squigglePath');
  function drawSquiggle() {
    const r = $('#how').getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (innerHeight - r.top) / (r.height * 0.85)));
    path.style.strokeDashoffset = String(1 - p);
  }
  if (!reduced) { addEventListener('scroll', drawSquiggle, { passive: true }); drawSquiggle(); } else path.style.strokeDashoffset = '0';

  /* ============================================================
     АНИМАЦИИ: заголовки по словам, появление, курсор
     ============================================================ */
  $$('[data-split]').forEach((h) => {
    let i = 0;
    h.innerHTML = h.innerHTML.split(/(<[^>]+>)/).map((part) => part.startsWith('<') ? part
      : part.replace(/\S+/g, (w) => `<span class="w"><span style="--i:${i++}">${w}</span></span>`)).join('');
  });
  const io = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.2 });
  function observeReveal() { $$('[data-split]:not(.in), [data-reveal]:not(.in), .chart:not(.in), .chain:not(.in)').forEach((el) => io.observe(el)); }
  observeReveal();
  // класс .ready (запуск анимации первого экрана) ставит fx.js после заставки

  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  if (finePointer && !reduced) {
    const cur = $('.cursor'); let x = -100; let y = -100; let cx = x; let cy = y;
    addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; cur.classList.toggle('big', !!e.target.closest('a, button, label, input, [data-tip]')); }, { passive: true });
    (function loop() { cx += (x - cx) * 0.25; cy += (y - cy) * 0.25; cur.style.transform = `translate(${cx}px, ${cy}px)`; requestAnimationFrame(loop); })();
    document.body.classList.add('has-cursor');
  }

  /* ============================================================
     ИСТОЧНИК ДАННЫХ
     ============================================================ */
  const FOOT = $('#footNote').textContent;
  const LIVE_BADGE = $('.hero .live').innerHTML;
  function setReport(rep, opts) {
    const refresh = opts && opts.refresh;
    R = rep;
    window.HMState = { report: R };
    renderHero(); renderTickets();
    if (!refresh) { renderTrust(); renderHow(); }
    $('#srcBtn').textContent = R.origin.source.split('/').pop();
    $('#footNote').textContent = isLive()
      ? 'Данные — живая лента новостей Honey Money и биржевые цены. Оценки получены автоматически и не являются инвестиционной рекомендацией.'
      : (R.footer || FOOT);
    $('.hero .live').innerHTML = isLive() ? `<i></i>живая лента · ${hm(R.live.updated_at)}` : LIVE_BADGE;
    window.dispatchEvent(new CustomEvent('hm:report'));
    if (refresh) {
      if (current && R.byId[current.id]) current = R.byId[current.id];
      return;
    }
    const id = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    if (R.byId[id]) ask(id); else if (scenarios.length) ask(scenarios[0].id, { silent: true });
    if (R.byId[id]) $('#demo').scrollIntoView({ block: 'start' });
  }
  $('#srcBtn').addEventListener('click', () => {
    if (!R) return;
    if (isLive()) {
      const L = R.live;
      toast(`Журнал модели: ${L.items_total} заголовков за ${L.window_h} ч → ${R.items.length} бумаг. ${L.llm.enabled ? `Агент новостей — раз в ${Math.round(L.cycle_s / 60)} мин.` : 'Ключа LLM нет — «нет данных».'}`);
    } else toast(`${R.origin.source}: ${R.original.items.length} новостей исходного набора и ${R.blind.items.length} слепого теста`);
  });

  /* ---------- живая лента: подключение и обновление ---------- */
  let base = null;           // отчёт — для раздела «Точность» и как запасной источник
  let liveVersion = null;
  let liveFile = false;      // пользователь загрузил свой отчёт — ленту не подмешиваем
  async function pollLive(first) {
    if (liveFile) return;
    const L = await window.HMReport.loadLive();
    if (!L) return;                                         // сервера нет — остаёмся на отчёте
    if (L.status === 'warming' || !L.cards || !L.cards.length) { setTimeout(() => pollLive(first), 5000); return; }
    if (L.version !== liveVersion) {
      const before = R && R.live ? new Map(R.items.map((it) => [it.id, it.score])) : null;
      const wasLive = isLive();
      liveVersion = L.version;
      const next = window.HMReport.withLive(base, L);
      if (!wasLive) {
        setReport(next);
        if (!first) toast(`Подключил живую ленту модели: ${next.items.length} бумаг в новостях`);
      } else {
        setReport(next, { refresh: true });
        // новая бумага в журнале или новая оценка агента
        const fresh = next.items.filter((it) => !before.has(it.id) || before.get(it.id) !== it.score);
        if (fresh.length) {
          const f = fresh[0];
          toast(f.score != null && before.has(f.id) ? `Агент обновил оценку: ${f.ticker} ${fmt(f.score, { sign: true })}` : `Новое по ${f.ticker}: ${clip(f.title, 60)}`);
          window.dispatchEvent(new CustomEvent('mani:news', { detail: { id: fresh[0].id, n: fresh.length } }));
        }
      }
    }
    setTimeout(pollLive, Math.max(30, (L.refresh_s || 180) / 2) * 1000);
  }

  $('#fileInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const rep = await window.HMReport.parseFile(f);
      liveFile = true;
      history.replaceState(null, '', location.pathname + location.search);
      setReport(rep);
      toast(`Загружен «${f.name}»: ${rep.items.length} новостей`);
      $('#demo').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    } catch (err) { toast('Не получилось прочитать файл: ' + err.message); }
    e.target.value = '';
  });

  Promise.all([window.HMReport.load(), window.HMReport.loadLive()]).then(([rep, L]) => {
    base = rep;
    if (L && L.status !== 'warming' && L.cards && L.cards.length) { liveVersion = L.version; setReport(window.HMReport.withLive(rep, L)); }
    else setReport(rep);
    if (L) setTimeout(pollLive, L.status === 'warming' ? 5000 : Math.max(30, (L.refresh_s || 180) / 2) * 1000);
  }).catch((err) => {
    console.error(err);
    $('#stage').innerHTML = `<p class="pane__empty">Не удалось прочитать отчёт: ${esc(err.message)}. Выполните python3 tools/embed_report.py</p>`;
  });
})();
