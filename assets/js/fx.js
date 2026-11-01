/* ============================================================
   Honey Money · живой Мани и эффекты
   Заставка, Мани-компаньон, бег по «дорожке», частицы,
   магнитные кнопки, наклон карточек, счётчики.
   Логика демо — в app.js; сюда приходят события mani:* и hm:report.
   ============================================================ */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const body = document.body;
  const IMG = (n) => `assets/img/mani/${n}.webp`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  // позы грузим заранее, чтобы смена не мигала
  ['zen', 'run', 'laptop', 'point', 'arms', 'coffee', 'tablet', 'book', 'coins', 'ruble', 'lying', 'stand', 'walk']
    .forEach((n) => { const i = new Image(); i.src = IMG(n); });

  const report = () => window.HMState && window.HMState.report;

  /* ============================================================
     ЗАСТАВКА: Мани бежит через экран, счётчик до 100%
     ============================================================ */
  const loader = $('#loader');
  let started = false;
  function heroStart() {
    if (started) return; started = true;
    body.classList.add('ready');
    setTimeout(() => { body.classList.add('revealed'); wave(); }, reduced ? 0 : 1300);
  }
  (function runLoader() {
    if (!loader) { heroStart(); return; }
    if (reduced) { loader.remove(); heroStart(); return; }
    body.classList.add('loading');
    const n = $('#loaderN'); const runner = $('.loader__runner');
    const t0 = performance.now(); const DUR = 1500;
    function frame(now) {
      const t = now - t0;
      const ready = !!report() || t > 4000; // отчёт так и не пришёл — не держим заставку
      const p = Math.min(ease(Math.min(1, t / DUR)), ready ? 1 : 0.9);
      n.textContent = Math.round(p * 100);
      const W = loader.clientWidth; const w = runner.offsetWidth;
      runner.style.translate = `${p * (W + w) - w}px 0`;
      if (ready && report()) $('#loaderHint').textContent = `${report().items.length} новостей прочитано${report().live ? ' · живая лента' : ''}`;
      if (p >= 1) {
        loader.classList.add('out'); body.classList.remove('loading');
        setTimeout(heroStart, 350);
        setTimeout(() => loader.remove(), 1300);
      } else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();

  /* ============================================================
     ПЕРВЫЙ ЭКРАН: буквы, волна, медоед следит за курсором, луч света
     ============================================================ */
  const title = $('.hero__title');
  let ci = 0;
  $$('.ln > span', title).forEach((span) => {
    [...span.childNodes].forEach((node) => {
      if (node.nodeType !== 3) return;
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((word) => {
        if (!word) return;
        if (/^\s+$/.test(word)) { frag.append(word); return; }
        const wd = document.createElement('span'); wd.className = 'wd';
        [...word].forEach((ch) => { const c = document.createElement('span'); c.className = 'ch'; c.textContent = ch; c.style.setProperty('--ci', ci++); wd.append(c); });
        frag.append(wd);
      });
      node.replaceWith(frag);
    });
  });
  function wave() {
    if (reduced) return;
    title.classList.remove('wave'); void title.offsetWidth; title.classList.add('wave');
    setTimeout(() => title.classList.remove('wave'), 2200);
  }

  const hero = $('.hero'); const peek = $('.hero__peek');
  const spot = document.createElement('div'); spot.className = 'hero__spot'; hero.prepend(spot);
  if (fine && !reduced) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      hero.style.setProperty('--my', (e.clientY - r.top) + 'px');
      const p = peek.getBoundingClientRect();
      const dx = e.clientX - (p.left + p.width / 2); const dy = e.clientY - (p.top + p.height / 2);
      peek.style.rotate = clamp(dx / 40, -14, 14) + 'deg';
      peek.style.translate = `${clamp(dx / 60, -8, 8)}px ${clamp(dy / 60, -6, 4)}px`;
    });
    hero.addEventListener('pointerleave', () => { peek.style.rotate = ''; peek.style.translate = ''; });
  }
  peek.addEventListener('click', () => {
    peek.classList.remove('hop'); void peek.offsetWidth; peek.classList.add('hop');
    const r = peek.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height * 0.3, { n: 10, char: '₽' });
    wave();
  });

  /* ============================================================
     МАНИ-КОМПАНЬОН
     ============================================================ */
  const buddy = $('#buddy'); const bImg = $('#buddyImg'); const say = $('#buddySay'); const bBtn = $('#buddyBtn');
  let base = 'zen'; let holdT = 0; let holding = false; let typeT = 0; let sayT = 0;

  function pose(name, ms) {
    if (bImg.dataset.p !== name) {
      bImg.src = IMG(name); bImg.dataset.p = name;
      buddy.classList.remove('swap'); void buddy.offsetWidth; buddy.classList.add('swap');
    }
    clearTimeout(holdT);
    if (ms === Infinity) { holding = true; return; }
    if (ms) { holding = true; holdT = setTimeout(() => { holding = false; pose(base); }, ms); } else holding = false;
  }
  function talk(text, ms) {
    clearTimeout(sayT); clearInterval(typeT);
    say.textContent = ''; say.classList.add('on');
    let i = 0;
    if (reduced) say.textContent = text;
    else typeT = setInterval(() => { say.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typeT); }, 18);
    sayT = setTimeout(() => say.classList.remove('on'), (ms || 4200) + text.length * 18);
  }
  function hop() { buddy.classList.remove('hop'); void buddy.offsetWidth; buddy.classList.add('hop'); }

  // что Мани говорит в каждом разделе
  const SCENES = {
    demo: { pose: 'stand', line: 'Выберите новость слева — я разберу её за пару секунд.' },
    trust: { pose: 'book', line: 'Я не всегда прав. Вот честная статистика слепого теста.' },
    how: { pose: 'laptop', line: 'Итог считает формула, а не моя фантазия.' },
    foot: { pose: 'ruble', line: 'Решение — всегда за вами!' },
  };
  const said = {};
  let scene = '';
  function currentScene() {
    const mid = innerHeight * 0.5;
    for (const [key, sel] of [['hero', '.hero'], ['demo', '#demo'], ['runway', '#runway'], ['trust', '#trust'], ['how', '#how'], ['foot', '.foot']]) {
      const el = $(sel); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) return key;
    }
    return scene;
  }
  function onScene(key) {
    if (key === scene) return; scene = key;
    // на первом экране и на дорожке Мани уже есть — компаньон прячется
    buddy.classList.toggle('on', started && key !== 'hero' && key !== 'runway');
    const s = SCENES[key]; if (!s) return;
    base = s.pose;
    if (!holding) pose(base);
    // реплика раздела не перебивает реакцию на действие пользователя
    if (!holding && (!said[key] || Date.now() - said[key] > 30000)) { said[key] = Date.now(); setTimeout(() => { if (scene === key && !holding) talk(s.line); }, 500); }
  }

  // клик по Мани — факт из отчёта
  let factI = 0;
  function facts() {
    const R = report(); if (!R) return ['Я ещё читаю отчёт…'];
    const sig = R.items.filter((it) => it.strength === 'signal').length;
    return [
      R.live
        ? `Сейчас в новостях ${R.items.length} бумаг из ${R.live.universe.length}. Агент новостей оценил ${R.items.filter((it) => it.score != null).length}.`
        : `Я разобрал ${R.items.length} новостей из отчёта. Сильных сигналов — ${sig}, остальное в основном шум.`,
      ...(R.live ? [R.live.llm.enabled ? 'Оценку даёт агент новостей модели — так же, как в торговом агенте.' : 'Ключа LLM нет — агент новостей не запускался, у бумаг «нет данных».',
        ...(R.live.market && R.live.market.narrative ? [R.live.market.narrative] : [])] : []),
      ...R.brief.map((b) => `${b.value} — ${b.text.split(/[:.]/)[0]}.`),
      'Каждое число в объяснении — из текста сообщения или помечено как вычисленное.',
      'Я не совершаю сделок. Рекомендация отделена от исполнения.',
    ];
  }
  bBtn.addEventListener('click', () => {
    const f = facts(); hop(); pose(['ruble', 'coins', 'point', 'tablet'][factI % 4], 3500);
    talk(f[factI++ % f.length], 3000);
  });

  // реакции на демо
  const demoVisible = () => { const r = $('#demo').getBoundingClientRect(); return r.top < innerHeight * 0.7 && r.bottom > innerHeight * 0.3; };
  addEventListener('mani:thinking', (e) => {
    bits();
    if (e.detail.silent || !demoVisible()) return;
    pose('laptop', Infinity); talk(`Читаю: ${e.detail.issuer}…`, 1200);
  });
  addEventListener('mani:answer', (e) => {
    const d = e.detail;
    countIn($$('.meter b'), 1100);
    reactVerdict(d);
    if (d.silent || !demoVisible()) { if (holding && bImg.dataset.p === 'laptop') pose(base); return; }
    pose(d.img, 5000); hop();
    const line = d.line.split(/(?<=\.)\s/).slice(0, 2).join(' ');
    talk(`${d.word}! ${line}`, 3800);
  });
  addEventListener('mani:news', (e) => {
    const R = report(); const it = R && R.byId[e.detail.id];
    if (!it || holding) return;
    pose('peek', 4000); hop();
    talk(e.detail.n > 1 ? `Обновил оценки: ${e.detail.n} бумаги. Первая — ${it.issuer}.` : `Новое по ${it.issuer}!`, 3200);
  });
  addEventListener('mani:decide', (e) => {
    const d = e.detail.d;
    const btn = $(`.decide [data-d="${d}"]`);
    if (d === 'act') {
      pose('coins', 3500); hop(); talk('Записал в журнал. Решение ваше — я только подсказал.', 2600);
      if (btn) { const r = btn.getBoundingClientRect(); burst(r.left + r.width / 2, r.top, { n: 18, char: '₽' }); }
    } else if (d === 'wait') { pose('zen', 3500); talk('Подождём. Новость никуда не денется.', 2400); }
    else { pose('lying', 3500); talk('Пропускаем. Это тоже решение.', 2400); }
  });

  /* ============================================================
     ПРОКРУТКА: прогресс, дорожка с бегущим Мани, бег компаньона
     ============================================================ */
  const prog = $('#progress');
  const runway = $('#runway'); const runner = $('#runner');
  const rowA = $('.runway__row--a span'); const rowB = $('.runway__row--b span');
  let lastY = scrollY; let dir = 1; let moveT = 0; let runT = 0; let ticking = false;

  function onScroll() {
    ticking = false;
    const y = scrollY; const dy = y - lastY; lastY = y;
    const max = document.documentElement.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    if (dy) dir = dy > 0 ? 1 : -1;

    const r = runway.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) {
      const p = (innerHeight - r.top) / (innerHeight + r.height);
      rowA.style.transform = `translateX(${-p * 30}%)`;
      rowB.style.transform = `translateX(${p * 30 - 30}%)`;
      const W = runway.clientWidth; const w = runner.offsetWidth;
      const x = p * (W + w * 1.6) - w * 1.3;
      const bob = -Math.abs(Math.sin(y / 34)) * 18;
      const lean = clamp(Math.abs(dy) * 0.25, 0, 9);
      runner.style.transform = `translate(${x}px, ${bob}px) scaleX(${dir}) rotate(${lean}deg)`;
      runner.classList.add('moving'); clearTimeout(moveT);
      moveT = setTimeout(() => runner.classList.remove('moving'), 180);
    }

    onScene(currentScene());
    // быстро листают — компаньон бежит следом
    if (!holding && Math.abs(dy) > 30 && buddy.classList.contains('on')) {
      if (bImg.dataset.p !== 'run') pose('run');
      buddy.style.setProperty('--dir', dir);
      clearTimeout(runT); runT = setTimeout(() => { buddy.style.setProperty('--dir', 1); if (!holding) pose(base); }, 400);
    }
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll);
  const sceneWatch = setInterval(() => { if (started) { clearInterval(sceneWatch); scene = ''; onScroll(); } }, 200);

  /* ============================================================
     ЧАСТИЦЫ
     ============================================================ */
  const layer = $('#fxLayer');
  function burst(x, y, o) {
    if (reduced) return;
    const n = o.n || 14;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'coin' + (o.cls ? ' ' + o.cls : '');
      s.textContent = o.char || '₽';
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const d = 70 + Math.random() * 150;
      s.style.left = x + 'px'; s.style.top = y + 'px';
      s.style.setProperty('--dx', (Math.cos(a) * d).toFixed(0) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * d).toFixed(0) + 'px');
      s.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      s.style.setProperty('--s', (0.7 + Math.random() * 0.6).toFixed(2));
      s.style.animationDelay = (Math.random() * 90).toFixed(0) + 'ms';
      layer.append(s);
      setTimeout(() => s.remove(), 1600);
    }
  }
  function reactVerdict(d) {
    const v = $('.verdict'); const m = $('.verdict__mani'); if (!v || !m || reduced) return;
    setTimeout(() => {
      const r = m.getBoundingClientRect(); const x = r.left + r.width * 0.55; const y = r.top + r.height * 0.25;
      if (r.bottom < 0 || r.top > innerHeight) return;
      if (d.key === 'pos') burst(x, y, { n: 16, char: '₽' });
      else if (d.key === 'pos weak') burst(x, y, { n: 7, char: '+' });
      else if (d.key.startsWith('neg')) {
        v.classList.remove('shake'); void v.offsetWidth; v.classList.add('shake');
        burst(x, y, { n: d.key === 'neg' ? 10 : 5, char: '!', cls: 'neg' });
      } else zzz(r);
    }, 450);
  }
  function zzz(r) {
    for (let i = 0; i < 3; i++) {
      const z = document.createElement('i'); z.className = 'zz'; z.textContent = 'z';
      z.style.left = (r.left + r.width * 0.7) + 'px'; z.style.top = (r.top + r.height * 0.2) + 'px';
      z.style.animationDelay = (i * 280) + 'ms'; z.style.fontSize = (16 + i * 6) + 'px';
      layer.append(z); setTimeout(() => z.remove(), 2200);
    }
  }
  // пока Мани думает — над ноутбуком летят цифры
  function bits() {
    const scan = $('.scan'); if (!scan || reduced) return;
    const CH = '₽%+−0123456789';
    for (let i = 0; i < 12; i++) {
      const b = document.createElement('i'); b.className = 'bit';
      b.textContent = CH[Math.floor(Math.random() * CH.length)];
      b.style.left = (38 + Math.random() * 24) + '%';
      b.style.setProperty('--dx', ((Math.random() - 0.5) * 160).toFixed(0) + 'px');
      b.style.animationDelay = (i * 90) + 'ms';
      scan.append(b); setTimeout(() => b.remove(), 2000);
    }
  }

  /* ============================================================
     СЧЁТЧИКИ: числа «набегают» от нуля
     ============================================================ */
  function countIn(els, dur) {
    els.forEach((el) => {
      const src = el.dataset.v || el.textContent; el.dataset.v = src;
      if (reduced) { el.textContent = src; return; }
      const parts = src.split(/(\d+(?:,\d+)?)/);
      const t0 = performance.now();
      (function f(now) {
        const p = Math.min(1, (now - t0) / dur); const e = 1 - Math.pow(1 - p, 4);
        el.textContent = parts.map((s, i) => {
          if (i % 2 === 0) return s;
          const dec = (s.split(',')[1] || '').length;
          return (parseFloat(s.replace(',', '.')) * e).toFixed(dec).replace('.', ',');
        }).join('');
        if (p < 1) requestAnimationFrame(f);
      })(t0);
    });
  }
  const cio = new IntersectionObserver((en) => en.forEach((e) => {
    if (!e.isIntersecting) return; cio.unobserve(e.target);
    if (e.target.classList.contains('chart')) setTimeout(() => countIn($$('.vb__v', e.target), 900), 1000);
    else countIn([e.target], 1400);
  }), { threshold: 0.4 });
  function watchCounters() { $$('.tile b').forEach((b) => cio.observe(b)); const c = $('.chart'); if (c) cio.observe(c); }
  addEventListener('hm:report', () => requestAnimationFrame(watchCounters));
  if (report()) watchCounters();

  /* ============================================================
     КУРСОР С ПОДПИСЬЮ, МАГНИТНЫЕ КНОПКИ, НАКЛОН КАРТОЧЕК
     ============================================================ */
  if (fine && !reduced) {
    const cur = $('.cursor'); const label = document.createElement('span'); cur.append(label);
    const LABELS = [['.ticket, .case, .tk-i, .chip', 'открыть'], ['.hero__peek, .buddy__btn', 'привет'], ['.tabs button', 'смотреть'], ['[data-tip]', 'данные']];
    const MAG = '.cta, .nav__journal, .decide__btns button, .buddy__btn';
    const TILT = '.tile, .case, .verdict, .chart, .op, .meter, .cmp__c';
    let magEl = null; let tiltEl = null;

    document.addEventListener('pointermove', (e) => {
      const t = e.target instanceof Element ? e.target : null; if (!t) return;
      const l = LABELS.find(([sel]) => t.closest(sel));
      cur.classList.toggle('label', !!l); if (l) label.textContent = l[1];

      const m = t.closest(MAG);
      if (magEl && magEl !== m) { magEl.style.translate = ''; magEl = null; }
      if (m) {
        magEl = m; const r = m.getBoundingClientRect();
        m.style.translate = `${((e.clientX - r.left) / r.width - 0.5) * r.width * 0.22}px ${((e.clientY - r.top) / r.height - 0.5) * r.height * 0.35}px`;
      }

      const k = t.closest(TILT);
      if (tiltEl && tiltEl !== k) { tiltEl.style.rotate = ''; tiltEl = null; }
      if (k) {
        tiltEl = k; const r = k.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
        const maxA = k.matches('.verdict, .chart') ? 5 : 10;
        const a = Math.hypot(x, y) * maxA;
        k.style.rotate = a > 0.2 ? `${(-y).toFixed(3)} ${x.toFixed(3)} 0 ${a.toFixed(2)}deg` : '';
        k.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(1) + '%');
        k.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(1) + '%');
      }
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (tiltEl) tiltEl.style.rotate = ''; if (magEl) magEl.style.translate = ''; });

    // клик — лаймовая «волна» из точки нажатия
    document.addEventListener('pointerdown', (e) => {
      const s = document.createElement('i'); s.className = 'ripple';
      s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px';
      layer.append(s); setTimeout(() => s.remove(), 700);
    });
  }
})();
