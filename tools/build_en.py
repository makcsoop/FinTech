#!/usr/bin/env python3
"""Собирает английскую страницу en/index.html из index.html.

    python3 tools/build_en.py

Тексты разметки — по таблице ниже, тексты скриптов — словарь assets/js/i18n.en.js.
Сборка падает, если на странице остался русский текст или в словаре нет строки из t('…') в скриптах,
так что после правки index.html или скриптов достаточно перезапустить скрипт.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]

# (русский текст в index.html, английский) — подстановки по порядку
HTML = [
    ('<html lang="ru">', '<html lang="en" data-base="../">'),
    ('<title>Мани — AI-агент Honey Money</title>', '<title>Mani — the Honey Money AI agent</title>'),
    ('content="Honey Money: AI-агент Мани читает новости эмитентов, перепроверяет цифры и объясняет вывод. Решение остаётся за вами."',
     'content="Honey Money: the AI agent Mani reads issuer news, re-checks the numbers and explains its verdict. The decision stays with you."'),
    ('<p class="loader__t">Мани читает отчёт</p>', '<p class="loader__t">Mani is reading the report</p>'),
    ('honey money · новостной модуль', 'honey money · news module'),
    ('aria-label="Honey Money — наверх"', 'aria-label="Honey Money — back to top"'),
    ('aria-label="Разделы"', 'aria-label="Sections"'),
    ('<a href="#demo">Сигналы</a>', '<a href="#demo">Signals</a>'),
    ('<a href="#trust">Точность</a>', '<a href="#trust">Accuracy</a>'),
    ('<a href="#how">Как устроен</a>', '<a href="#how">How it works</a>'),
    ('<a class="nav__lang" href="en/" hreflang="en" lang="en" title="English version">EN</a>',
     '<a class="nav__lang" href="../" hreflang="ru" lang="ru" title="Русская версия">RU</a>'),
    ('aria-label="Журнал решений">Журнал <b id="journalCount">', 'aria-label="Decision log">Log <b id="journalCount">'),
    ('<span class="caps">AI-агент для инвестиций</span>', '<span class="caps">AI agent for investors</span>'),
    ('<span class="live"><i></i>прототип · реальные данные</span>', '<span class="live"><i></i>prototype · real data</span>'),
    ('aria-label="Мани читает новости за вас"', 'aria-label="Mani reads the news for you"'),
    ('<span class="ln"><span>Мани читает</span></span>', '<span class="ln"><span>Mani reads</span></span>'),
    ('<span class="ln"><span>новости</span></span>', '<span class="ln"><span>the news</span></span>'),
    ('за&nbsp;вас<img', 'for&nbsp;you<img'),
    ('<p>Раскрытие эмитента → понятный вывод, проверенные&nbsp;цифры и&nbsp;честная уверенность. <b>Решение — за&nbsp;вами.</b></p>',
     '<p>Issuer disclosure → a clear verdict, re-checked&nbsp;numbers and&nbsp;honest confidence. <b>The decision is&nbsp;yours.</b></p>'),
    ('<span>Попробовать</span>', '<span>Try it</span>'),
    ('aria-label="Котировки первого эшелона"', 'aria-label="Blue-chip quotes"'),
    ('<h2 class="big" data-split>Выберите новость. <em>Мани объяснит.</em></h2>', '<h2 class="big" data-split>Pick a story. <em>Mani explains.</em></h2>'),
    ('id="demoAside">Настоящие раскрытия из отчёта скоринга</p>', 'id="demoAside">Real disclosures from the scoring report</p>'),
    ('placeholder="Компания, тикер или «дефолт»" aria-label="Поиск новости"', 'placeholder="Company, ticker or “default”" aria-label="Search news"'),
    ('<p class="rail__t">Примеры</p>', '<p class="rail__t">Examples</p>'),
    ('<span>Читает · Проверяет · Объясняет · Читает · Проверяет · Объясняет · Читает · Проверяет · Объясняет ·</span>',
     '<span>Reads · Checks · Explains · Reads · Checks · Explains · Reads · Checks · Explains ·</span>'),
    ('<span>Не торгует за вас · Решение — ваше · Не торгует за вас · Решение — ваше · Не торгует за вас · Решение — ваше ·</span>',
     "<span>Doesn't trade for you · The decision is yours · Doesn't trade for you · The decision is yours · Doesn't trade for you · The decision is yours ·</span>"),
    ('<h2 class="big" data-split>Проверили <em>вслепую.</em></h2>', '<h2 class="big" data-split>Tested <em>blind.</em></h2>'),
    ('<figcaption><b>Верный знак на 44 новых новостях</b><span>доля и 95% интервал</span></figcaption>',
     '<figcaption><b>Correct sign on 44 unseen news items</b><span>share and 95% interval</span></figcaption>'),
    ('<p class="cases__t"><b>Разборы из отчёта</b><span>где Мани прав — и где ошибся</span></p>',
     '<p class="cases__t"><b>Cases from the report</b><span>where Mani was right — and where it was wrong</span></p>'),
    ('<h2 class="big" data-split>Семь шагов <em>от текста до вывода.</em></h2>', '<h2 class="big" data-split>Seven steps <em>from text to verdict.</em></h2>'),
    ('<p class="sec-head__aside">Итог считает формула, а&nbsp;не&nbsp;языковая модель. Каждое число — из&nbsp;сообщения или помечено как вычисленное.</p>',
     '<p class="sec-head__aside">A formula computes the result, not a&nbsp;language model. Every number comes from&nbsp;the notice or is marked as computed.</p>'),
    ('<p class="caps">Место в Honey Money</p>', '<p class="caps">Its place in Honey Money</p>'),
    ('<h3>Часть системы Honey Money</h3>', '<h3>Part of the Honey Money system</h3>'),
    ('<span>ML-сигналы</span>', '<span>ML signals</span>'),
    ('<span class="on">Новости</span>', '<span class="on">News</span>'),
    ('<span>Риск-гейт</span>', '<span>Risk gate</span>'),
    ('<span class="you">Вы</span>', '<span class="you">You</span>'),
    ('<p class="caps">Решение — за вами</p>', '<p class="caps">The decision is yours</p>'),
    ('<span>Спросить Мани</span>', '<span>Ask Mani</span>'),
    ('<p id="footNote">Данные — публичные раскрытия эмитентов. Оценки получены автоматически и не являются инвестиционной рекомендацией.</p>',
     '<p id="footNote">Data: public issuer disclosures. Scores are generated automatically and are not investment advice.</p>'),
    ('<p>Источник: <button', '<p>Source: <button'),
    ('>загрузить свой отчёт<input', '>upload your own report<input'),
    ('<p>Академия Финтеха ВТБ<br>', '<p>VTB Fintech Academy<br>'),
    ('<aside class="drawer" id="drawer" aria-label="Журнал решений" hidden>', '<aside class="drawer" id="drawer" aria-label="Decision log" hidden>'),
    ('<div><b>Журнал решений</b><span>каждое решение — с данными, на которых оно принято</span></div>',
     '<div><b>Decision log</b><span>every decision, with the data it was based on</span></div>'),
    ('aria-label="Закрыть"', 'aria-label="Close"'),
    ('id="jclear">Очистить журнал</button>', 'id="jclear">Clear the log</button>'),
    ('aria-label="Мани — нажмите, чтобы узнать факт из отчёта"', 'aria-label="Mani — click for a fact from the report"'),
    ('<script src="assets/js/i18n.js" defer></script>', '<script src="assets/js/i18n.en.js" defer></script>\n<script src="assets/js/i18n.js" defer></script>'),
]
ALLOWED_RU = {'Русская версия'}                         # подпись ссылки на русскую версию


def js_keys() -> list[str]:
    keys = []
    for f in ('app.js', 'fx.js', 'report.js'):
        src = (SITE / 'assets' / 'js' / f).read_text(encoding='utf-8')
        for m in re.finditer(r"\b(?:t|tx|tr|I18N\.t)\('((?:[^'\\]|\\.)*)'", src):
            if m.group(1) not in keys:
                keys.append(m.group(1))
    return keys


def main() -> int:
    html = (SITE / 'index.html').read_text(encoding='utf-8')
    for ru, en in HTML:
        if ru not in html:
            print(f'нет в index.html: {ru[:80]}', file=sys.stderr)
            return 1
        html = html.replace(ru, en)
    html = re.sub(r'<!--.*?-->\n?', '', html, flags=re.S)          # русские комментарии разметки
    html = re.sub(r'(\s(?:href|src)=")(assets/)', r'\1../\2', html)  # страница лежит в en/

    left = [w for w in re.findall(r'[А-Яа-яЁё][А-Яа-яЁё\s«»—,.-]*', html) if w.strip() not in ALLOWED_RU]
    if left:
        print('остался русский текст: ' + ' | '.join(sorted(set(left))[:20]), file=sys.stderr)
        return 1

    d = (SITE / 'assets' / 'js' / 'i18n.en.js').read_text(encoding='utf-8')
    have = set(re.findall(r"^\s*'((?:[^'\\]|\\.)*)':", d, flags=re.M))
    miss = [k for k in js_keys() if k not in have]
    if miss:
        print('нет в словаре i18n.en.js:\n  ' + '\n  '.join(miss), file=sys.stderr)
        return 1

    out = SITE / 'en' / 'index.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'{out.relative_to(SITE)}: готово, {len(HTML)} подстановок, словарь — {len(have)} строк')
    return 0


if __name__ == '__main__':
    sys.exit(main())
