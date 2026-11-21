/* ============================================================
   Honey Money · язык страницы
   Русская страница — index.html (lang="ru"), английская — en/index.html (lang="en", data-base="../").
   t('русская строка', { переменные }) → строка на языке страницы; ключ словаря — русский текст,
   поэтому русская версия работает без словаря. Словарь — assets/js/i18n.en.js.
   ============================================================ */
(function () {
  'use strict';
  const root = document.documentElement;
  const lang = root.lang === 'en' ? 'en' : 'ru';
  const base = root.dataset.base || '';             // путь к корню сайта со страницы (en/ → ../)
  const missing = new Set();                         // для проверки словаря: какие строки не нашлись

  function t(s, vars) {
    let r = s;
    if (lang === 'en') {
      const d = window.HM_EN || {};
      if (d[s] != null) r = d[s]; else missing.add(s);
    }
    return vars ? r.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : r;
  }
  /** plural(5, ['бумагу', 'бумаги', 'бумаг'], ['stock', 'stocks']) */
  function plural(n, ru, en) {
    if (lang === 'en') return Math.abs(n) === 1 ? en[0] : en[1];
    const n10 = Math.abs(n) % 10; const n100 = Math.abs(n) % 100;
    return ru[n100 >= 11 && n100 <= 14 ? 2 : n10 === 1 ? 0 : n10 >= 2 && n10 <= 4 ? 1 : 2];
  }
  const locale = lang === 'en' ? 'en-GB' : 'ru-RU';
  const decimal = lang === 'en' ? '.' : ',';

  window.HMI18N = { lang, base, t, plural, locale, decimal, missing };
})();
