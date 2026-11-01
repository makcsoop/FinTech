/* ============================================================
   Honey Money · чтение отчёта скоринга раскрытий
   ------------------------------------------------------------
   Единственный источник данных сайта — news_scoring_report.html.
   Здесь он разбирается в структуру, с которой работают лендинг и демо.

   HMReport.load()        → Promise<Report>  (fetch, а на file:// — встроенная копия)
   HMReport.parse(html)   → Report           (разбор произвольной строки отчёта)
   HMReport.parseFile(f)  → Promise<Report>  (отчёт, выбранный пользователем)
   ============================================================ */
(function () {
  'use strict';

  const REPORT_URL = 'data/news_scoring_report.html';

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const txt = (el) => (el ? clean(el.textContent) : '');
  const num = (s) => {
    if (s == null) return null;
    const m = String(s).replace(/−|–/g, '-').replace(/\s/g, '').match(/[-+]?\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : null;
  };
  const toneOf = (el) => {
    if (!el) return { label: '', tone: 'neu', weak: false };
    const c = el.classList;
    return {
      label: txt(el),
      tone: c.contains('pos') ? 'pos' : c.contains('neg') ? 'neg' : 'neu',
      weak: c.contains('weak'),
    };
  };
  const dateKey = (d) => {
    const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(d || '');
    return m ? +(m[3] + m[2] + m[1]) : 0;
  };
  /** Порог сигнала из легенды отчёта: |оценка| ≥ 0,15 — сигнал, ≥ 0,05 — слабый. */
  const strength = (score) => {
    const a = Math.abs(score || 0);
    return a >= 0.15 ? 'signal' : a >= 0.05 ? 'weak' : 'none';
  };

  /* ---------- карточка: <article class="card"> или <details class="fold"> ---------- */
  function parseCard(el) {
    const head = el.querySelector(':scope > header, :scope > summary');
    const what = txt(head && head.querySelector('.what'));
    const cut = what.lastIndexOf(' · ');
    const card = {
      id: txt(head && head.querySelector('.id')),
      issuer: txt(head && head.querySelector('.who')),
      kind: cut > -1 ? what.slice(0, cut) : what,
      date: cut > -1 ? what.slice(cut + 3) : '',
      explain: [], checks: [], watch: [], opinions: [],
    };

    const fig = {};
    el.querySelectorAll(':scope > dl.figures > div').forEach((d) => {
      fig[txt(d.querySelector('dt'))] = d.querySelector('dd');
    });
    if (fig['Цель']) card.target = txt(fig['Цель']);
    if (fig['Итог']) card.verdict = toneOf(fig['Итог'].querySelector('.pill'));
    if (fig['Оценка']) card.score = num(fig['Оценка'].firstChild && fig['Оценка'].firstChild.textContent);
    if (fig['Уверенность']) card.confidence = num(txt(fig['Уверенность']));
    if (fig['Значимость']) card.significance = num(txt(fig['Значимость']));
    if (fig['Новизна']) card.novelty = num(txt(fig['Новизна']));

    const note = el.querySelector(':scope > p.note');
    if (note) card.note = txt(note);
    const h3 = el.querySelector(':scope > h3');
    if (h3) card.title = txt(h3);

    // Блоки идут парами: <h4>заголовок</h4><ul>…</ul>
    el.querySelectorAll(':scope > h4').forEach((h4) => {
      const list = h4.nextElementSibling;
      if (!list || list.tagName !== 'UL') return;
      const name = txt(h4).toLowerCase();
      const items = [...list.children];
      if (name.startsWith('объяснение')) {
        card.explain = items.map((li) => {
          const said = li.querySelector('.said');
          const quotes = said ? [...said.querySelectorAll('q')].map(txt) : [];
          let text = '';
          if (said) {
            const c = said.cloneNode(true);
            c.querySelectorAll('.quotes').forEach((q) => q.remove());
            text = txt(c);
          }
          return { kind: txt(li.querySelector('.kind')), text, quotes };
        });
      } else if (name.startsWith('проверки')) {
        card.checks = items.map((li) => {
          const body = li.querySelector(':scope > span:not(.status)');
          const title = txt(body && body.querySelector('b')).replace(/\.$/, '');
          const effect = txt(body && body.querySelector('.effect')).replace(/^→\s*/, '');
          let text = '';
          if (body) {
            const c = body.cloneNode(true);
            c.querySelectorAll('b, .effect').forEach((x) => x.remove());
            text = txt(c);
          }
          const cls = ['ok', 'warn', 'fail', 'info'].find((k) => li.classList.contains(k)) || 'info';
          return { status: txt(li.querySelector('.status')), cls, title, text, effect };
        });
      } else if (name.startsWith('на что смотреть')) {
        card.watch = items.map(txt);
      } else if (name.startsWith('мнения')) {
        card.opinions = items.map((li) => {
          const nums = li.querySelectorAll('.n');
          const full = txt(li);
          const m = /неуверенность\s*[\d,]+\s*\.\s*([\s\S]*)$/.exec(full);
          return {
            role: txt(li.querySelector('b')),
            model: txt(li.querySelector('.model')),
            impact: num(txt(nums[0])),
            uncertainty: num(txt(nums[1])),
            text: m ? clean(m[1]) : full,
          };
        });
      }
    });

    // Вердикт в разобранных примерах слепого теста
    const verdict = el.querySelector(':scope > dl.verdict');
    if (verdict) {
      card.compare = {};
      verdict.querySelectorAll(':scope > div').forEach((d) => {
        const key = txt(d.querySelector('dt'));
        const dd = d.querySelector('dd');
        const slot = key.startsWith('Разметка') ? 'label' : key.startsWith('Базовый') ? 'base' : 'llm';
        const v = toneOf(dd.querySelector('.pill'));
        const n = dd.querySelector('.n');
        if (n) v.score = num(txt(n));
        if (dd.querySelector('.hit')) v.hit = true;
        if (dd.querySelector('.miss')) v.hit = false;
        card.compare[slot] = v;
      });
    }
    return card;
  }

  /* ---------- таблицы ---------- */
  function tableRows(table) {
    if (!table) return [];
    return [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children]);
  }

  /** Дочерние элементы секции, сгруппированные по ближайшему <h3>. */
  function groups(section) {
    const out = { _: [] };
    let cur = '_';
    for (const el of section.children) {
      if (el.tagName === 'H3') { cur = txt(el); out[cur] = []; continue; }
      out[cur].push(el);
    }
    return out;
  }
  const pick = (g, prefix) => {
    const k = Object.keys(g).find((key) => key.toLowerCase().startsWith(prefix.toLowerCase()));
    return k ? g[k] : [];
  };
  const findIn = (els, sel) => {
    for (const el of els) {
      if (el.matches && el.matches(sel)) return el;
      const f = el.querySelector && el.querySelector(sel);
      if (f) return f;
    }
    return null;
  };
  const findAllIn = (els, sel) => els.flatMap((el) => [
    ...(el.matches && el.matches(sel) ? [el] : []),
    ...(el.querySelectorAll ? el.querySelectorAll(sel) : []),
  ]);

  /* ---------- основной разбор ---------- */
  function parse(html, origin) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const sections = [...doc.querySelectorAll('main section')];
    const sec = (prefix) => sections.find((s) => txt(s.querySelector('h2')).toLowerCase().startsWith(prefix.toLowerCase()));

    const head = doc.querySelector('main > header') || doc.querySelector('header');
    const report = {
      origin: Object.assign({ source: 'news_scoring_report.html', mode: 'string', loadedAt: new Date() }, origin || {}),
      title: txt(doc.querySelector('h1')) || txt(doc.querySelector('title')),
      eyebrow: txt(head && head.querySelector('.eyebrow')),
      lede: txt(head && head.querySelector('.lede')),
      brief: head ? [...head.querySelectorAll('.brief li')].map((li) => ({ value: txt(li.querySelector('b')), text: txt(li.querySelector('span')) })) : [],
      method: { flow: [], text: '', legend: [] },
      original: { summary: '', items: [], top: [] },
      blind: { intro: '', steps: [], bars: [], modes: [], matrices: [], note: '', items: [], examples: [] },
      caveats: [],
      footer: txt(doc.querySelector('main > footer, footer')),
    };

    /* Как устроена оценка */
    const m = sec('Как устроена');
    if (m) {
      report.method.flow = [...m.querySelectorAll('.flow .step')].map((s) => ({
        label: txt(s), type: s.classList.contains('core') ? 'core' : s.classList.contains('opt') ? 'opt' : '',
      }));
      const p = [...m.querySelectorAll(':scope > p')].find((x) => !x.classList.contains('flow'));
      report.method.text = txt(p);
      report.method.legend = [...m.querySelectorAll('.legend > div')].map((d) => ({ term: txt(d.querySelector('dt')), desc: txt(d.querySelector('dd')) }));
    }

    /* Исходный набор */
    const o = sec('Исходный набор');
    if (o) {
      const g = groups(o);
      report.original.title = txt(o.querySelector('h2'));
      report.original.summary = txt(findIn(g._, 'p'));
      const featured = {};
      findAllIn(pick(g, 'Три карточки'), 'article.card').forEach((a) => { const c = parseCard(a); featured[c.id] = c; });
      report.original.featuredIds = Object.keys(featured);
      report.original.top = findAllIn(pick(g, 'Самые значимые'), 'li').map((li) => ({
        id: txt(li.querySelector('.id')), significance: num(txt(li.querySelector('.n'))),
        title: (() => { const c = li.cloneNode(true); c.querySelectorAll('.id, .n').forEach((x) => x.remove()); return txt(c); })(),
      }));
      const rows = {};
      tableRows(findIn(pick(g, 'Все'), 'table')).forEach((td) => {
        rows[txt(td[0])] = {
          id: txt(td[0]), date: txt(td[1]), issuer: txt(td[2]), kind: txt(td[3]), target: txt(td[4]),
          verdict: toneOf(td[5].querySelector('.pill')), score: num(txt(td[6])), confidence: num(txt(td[7])), significance: num(txt(td[8])),
        };
      });
      const folds = findAllIn(pick(g, 'Карточка каждой'), 'details.fold').map(parseCard);
      const ids = folds.length ? folds.map((f) => f.id) : Object.keys(rows);
      const byId = Object.fromEntries(folds.map((f) => [f.id, f]));
      report.original.items = ids.map((id) => {
        const it = Object.assign({}, rows[id] || {}, byId[id] || {});
        const f = featured[id];
        if (f) { it.note = f.note; it.featured = true; if (!it.explain.length) Object.assign(it, f); }
        it.set = 'orig';
        return it;
      });
    }

    /* Слепой тест */
    const b = sec('Слепой тест');
    if (b) {
      const g = groups(b);
      report.blind.title = txt(b.querySelector('h2'));
      report.blind.intro = txt(findIn(g._, 'p'));
      report.blind.steps = findAllIn(g._, 'ol.steps li').map(txt);
      const sign = pick(g, 'Верный знак');
      report.blind.bars = findAllIn(sign, '.bar-row').map((r) => {
        const v = txt(r.querySelector('.bar-value'));
        const mm = /(\d+)\s*из\s*(\d+)\s*·\s*([\d,]+)\s*\(([\d,]+)\s*[–-]\s*([\d,]+)\)/.exec(v) || [];
        return {
          title: txt(r.querySelector('.bar-title')), text: v,
          hits: +mm[1] || null, total: +mm[2] || null, rate: num(mm[3]), lo: num(mm[4]), hi: num(mm[5]),
          main: !!r.querySelector('.fill.main'), second: !!r.querySelector('.fill.second'),
        };
      });
      report.blind.barsNote = txt(findIn(sign, 'p.muted'));
      const tables = findAllIn(sign, '.scroll > table');
      const modes = tables.find((t) => !t.closest('.matrix'));
      if (modes) {
        const heads = [...modes.querySelectorAll('thead th')].map(txt);
        report.blind.modeHeads = heads;
        report.blind.modes = tableRows(modes).map((tds) => tds.map(txt));
      }
      report.blind.matrices = findAllIn(sign, 'figure.matrix').map((fgr) => {
        const t = fgr.querySelector('table');
        return {
          caption: txt(fgr.querySelector('figcaption')),
          cols: [...t.querySelectorAll('thead th')].slice(1).map(txt),
          rows: tableRows(t).map((tds) => ({ label: txt(tds[0]), values: tds.slice(1).map((td) => num(txt(td))) })),
        };
      });
      const after = sign.filter((el) => el.tagName === 'P' && !el.classList.contains('muted'));
      report.blind.note = txt(after[after.length - 1]);

      const rows = {};
      tableRows(findIn(pick(g, 'Все'), 'table')).forEach((td) => {
        const hit = (cell) => (cell.querySelector('.hit') ? true : cell.querySelector('.miss') ? false : null);
        rows[txt(td[0])] = {
          id: txt(td[0]), date: txt(td[1]), issuer: txt(td[2]), kind: txt(td[3]),
          compare: {
            label: toneOf(td[4].querySelector('.pill')),
            base: Object.assign(toneOf(td[5].querySelector('.pill')), { score: num(txt(td[6])), hit: hit(td[7]) }),
            llm: Object.assign(toneOf(td[8].querySelector('.pill')), { score: num(txt(td[9])), hit: hit(td[10]) }),
          },
        };
      });
      const folds = findAllIn(pick(g, 'Карточка каждой'), 'details.fold').map(parseCard);
      const byId = Object.fromEntries(folds.map((f) => [f.id, f]));
      const ids = Object.keys(rows).length ? Object.keys(rows) : folds.map((f) => f.id);
      report.blind.items = ids.map((id) => Object.assign({ set: 'blind' }, byId[id] || {}, rows[id] || {}));
    }

    /* Разобранные примеры слепого теста */
    const ex = sec('Семь разобранных') || sections.find((s) => s.querySelector('article.card.example'));
    if (ex) {
      report.blind.examplesIntro = txt(ex.querySelector(':scope > p'));
      report.blind.examples = [...ex.querySelectorAll('article.card')].map(parseCard);
      const byId = Object.fromEntries(report.blind.items.map((it) => [it.id, it]));
      report.blind.examples.forEach((e) => {
        const it = byId[e.id];
        if (!it) return;
        it.example = { title: e.title, note: e.note };
        if (e.opinions.length) it.opinions = e.opinions;
        if (e.compare) it.compare = Object.assign({}, it.compare, e.compare);
      });
    }

    const c = sec('Как читать');
    if (c) report.caveats = [...c.querySelectorAll('li')].map(txt);

    /* Общие производные поля */
    report.items = [...report.original.items, ...report.blind.items];
    report.items.forEach((it) => {
      it.strength = strength(it.score);
      it.dateKey = dateKey(it.date);
      it.verdict = it.verdict || { label: 'нейтрально', tone: 'neu', weak: false };
      ['explain', 'checks', 'watch', 'opinions'].forEach((k) => { it[k] = it[k] || []; });
    });
    report.byId = Object.fromEntries(report.items.map((it) => [it.id, it]));

    if (!report.items.length) {
      throw new Error('В файле не найдено ни одной карточки новости — это не похоже на отчёт скоринга.');
    }
    return report;
  }

  async function load() {
    if (/^https?:/.test(location.protocol)) {
      try {
        const res = await fetch(REPORT_URL, { cache: 'no-cache' });
        if (res.ok) return parse(await res.text(), { source: REPORT_URL, mode: 'fetch' });
      } catch (e) { /* упадём на встроенную копию */ }
    }
    // На file:// fetch запрещён — подключаем встроенную копию обычным <script>
    if (!window.HM_REPORT_EMBED) {
      await new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = 'data/report-embed.js';
        s.onload = s.onerror = resolve;
        document.head.appendChild(s);
      });
    }
    if (window.HM_REPORT_EMBED) {
      return parse(window.HM_REPORT_EMBED.html, { source: window.HM_REPORT_EMBED.source, mode: 'embed' });
    }
    throw new Error('Не удалось загрузить отчёт: нет ни ' + REPORT_URL + ', ни встроенной копии data/report-embed.js');
  }

  /* ---------- живая лента: live/server.py ----------
     Сервера нет (GitHub Pages, file://, tools/serve.py) — null, сайт остаётся на отчёте. */
  const API = (new URLSearchParams(location.search).get('api') || '').replace(/\/$/, '');
  async function loadLive() {
    if (!API && !/^https?:/.test(location.protocol)) return null;
    try {
      const res = await fetch((API ? API + '/' : '') + 'api/live', { cache: 'no-store' });
      if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  /** Котировки первого эшелона для бегущей ленты (live/server.py → /api/prices). */
  async function loadPrices() {
    if (!API && !/^https?:/.test(location.protocol)) return null;
    try {
      const res = await fetch((API ? API + '/' : '') + 'api/prices', { cache: 'no-store' });
      if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  /** Отчёт + живая лента: демо и первый экран — на живых карточках, раздел «Точность» — из отчёта. */
  function withLive(report, live) {
    const items = live.cards.map((c) => {
      const it = Object.assign({ explain: [], checks: [], watch: [], opinions: [] }, c);
      it.strength = strength(it.score);
      it.dateKey = dateKey(it.date);
      return it;
    });
    return Object.assign({}, report, {
      live, items,
      byId: Object.fromEntries(items.map((it) => [it.id, it])),
      method: Object.assign({}, report.method, { flow: live.flow }),
      origin: { source: 'живая лента Honey Money', mode: 'live', loadedAt: new Date() },
    });
  }

  function parseFile(file) {
    return file.text().then((html) => parse(html, { source: file.name, mode: 'file' }));
  }

  /* Форматирование чисел по-русски: 0.25 → «0,25», +0.25 → «+0,25» */
  function fmt(n, opts) {
    if (n == null || isNaN(n)) return '—';
    const o = Object.assign({ digits: 2, sign: false }, opts);
    const s = Math.abs(n).toFixed(o.digits).replace('.', ',');
    if (o.sign) return (n > 0 ? '+' : n < 0 ? '−' : '+') + s;
    return (n < 0 ? '−' : '') + s;
  }

  window.HMReport = { load, parse, parseFile, fmt, strength, loadLive, loadPrices, withLive };
})();
