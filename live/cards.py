"""Карточки для фронта из того, что выдаёт агент новостей. Ничего не досчитывает.

Агент оценивает бумагу целиком, поэтому карточка — одна на бумагу. Если оценки нет, это «нет данных», а не 0.

Здесь только перекладка в форму карточки отчёта скоринга (report.js), чтобы фронт работал без переделки.
Язык — ctx["lang"] ("ru" | "en"): шаблонные фразы пишутся сразу на нём, а тексты агента и заголовки
новостей на английском берутся через ctx["tr"] (кэш переводов сервера; пока перевода нет — оригинал).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

MSK = timezone(timedelta(hours=3))

NAMES = {
    "SBER": "Сбербанк", "LKOH": "Лукойл", "ROSN": "Роснефть", "GAZP": "Газпром", "VTBR": "ВТБ",
    "YDEX": "Яндекс", "PLZL": "Полюс", "NVTK": "Новатэк", "X5": "X5 Group", "GMKN": "Норникель",
    "MGNT": "Магнит", "ALRS": "Алроса", "AFLT": "Аэрофлот", "CHMF": "Северсталь", "NLMK": "НЛМК",
    "MOEX": "Мосбиржа", "SNGSP": "Сургутнефтегаз", "MTSS": "МТС", "T": "Т-Банк", "PIKK": "ПИК",
    "TATN": "Татнефть", "OZON": "Озон", "SNGS": "Сургутнефтегаз",
}
NAMES_EN = {
    "SBER": "Sberbank", "LKOH": "Lukoil", "ROSN": "Rosneft", "GAZP": "Gazprom", "VTBR": "VTB",
    "YDEX": "Yandex", "PLZL": "Polyus", "NVTK": "Novatek", "X5": "X5 Group", "GMKN": "Nornickel",
    "MGNT": "Magnit", "ALRS": "Alrosa", "AFLT": "Aeroflot", "CHMF": "Severstal", "NLMK": "NLMK",
    "MOEX": "Moscow Exchange", "SNGSP": "Surgutneftegas", "MTSS": "MTS", "T": "T-Bank", "PIKK": "PIK",
    "TATN": "Tatneft", "OZON": "Ozon", "SNGS": "Surgutneftegas",
}
EVENT_EN = {
    "dividend_decision": "Dividend decision",
    "dividend_policy_change": "Dividend policy change",
    "production_halt_or_key_asset_damage": "Production halt or strike on an asset",
}
EVENT_RU = {
    "dividend_decision": "Дивидендное решение",
    "dividend_policy_change": "Смена дивидендной политики",
    "production_halt_or_key_asset_damage": "Остановка или удар по объекту",
}


def _num(x: float, d: int = 2, en: bool = False) -> str:
    return f"{x:.{d}f}" if en else f"{x:.{d}f}".replace(".", ",")


def _signed(x: float, d: int = 2, en: bool = False) -> str:
    return ("+" if x >= 0 else "−") + _num(abs(x), d, en)


def _plural(n: int, one: str, few: str, many: str) -> str:
    n100, n10 = n % 100, n % 10
    if 11 <= n100 <= 14:
        return many
    return one if n10 == 1 else few if 2 <= n10 <= 4 else many


def build_card(t: str, claims: List[Any], view: Optional[Any], ctx: Dict[str, Any],
               all_by_id: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    from src.hm2 import fastpath

    en = ctx.get("lang") == "en"
    L = (lambda ru, eng: eng) if en else (lambda ru, eng: ru)          # шаблонная фраза на языке карточки
    tr = (ctx.get("tr") or (lambda x: x)) if en else (lambda x: x)       # текст агента или заголовок новости
    num = lambda x, d=2: _num(x, d, en)
    signed = lambda x, d=2: _signed(x, d, en)
    names = NAMES_EN if en else NAMES
    events_names = EVENT_EN if en else EVENT_RU

    def heads(n: int, form: str = "dat") -> str:
        if en:
            return f"{n} headline" + ("" if n == 1 else "s")
        return f"{n} " + (_plural(n, "заголовку", "заголовкам", "заголовкам") if form == "dat"
                          else _plural(n, "заголовок", "заголовка", "заголовков"))

    agent = (view.per_ticker.get(t) if view else None) or None
    cited = list(agent.get("claims") or []) if agent else []
    # агент ссылается на любые заголовки из отбора, не только с тикером бумаги
    by_id = dict(all_by_id or {})
    by_id.update({c.claim_id: c for c in claims})
    ordered = [by_id[i] for i in cited if i in by_id] + \
        sorted((c for c in claims if c.claim_id not in cited), key=lambda c: c.ts, reverse=True)
    lead = ordered[0] if ordered else None
    title = tr(lead.title if lead else ((agent.get("titles") or [""])[0] if agent else ""))

    # словарь быстрого пути модели — по каждому заголовку бумаги
    events = []
    for c in ordered:
        ev, why_not = fastpath.classify(c.title)
        if ev and all(e[0].event_type != ev.event_type for e in events):
            events.append((ev, why_not, c))

    stale = bool(agent and agent.get("_stale"))
    at = ctx.get("analyzed_at")
    if agent and agent.get("_at"):
        d = datetime.fromtimestamp(agent["_at"], MSK)
        at = d.strftime("%H:%M") if d.date() == ctx["now"].astimezone(MSK).date() else \
            (d.strftime("%-d %b, %H:%M") if en else d.strftime("%d.%m, %H:%M"))
    score = float(agent["s"]) if agent else None
    conf = float(agent["c"]) if agent else None
    if score is None:
        tone, weak, label = "neu", False, L("нет данных", "no data")
    else:
        a = abs(score)
        tone = "pos" if score >= 0.05 else "neg" if score <= -0.05 else "neu"
        weak = 0.05 <= a < 0.15
        label = (L("позитив", "positive") if tone == "pos" else L("негатив", "negative") if tone == "neg"
                 else L("нейтрально", "neutral"))
        if weak:
            label = L("слабый ", "mildly ") + label

    checks = []
    llm = ctx.get("llm") or {}
    if agent:
        checks.append(dict(cls="info", status="LLM", title=L("Агент новостей", "News agent"),
                           text=L(f"Оценка модели по {heads(len(cited))}", f"Model score based on {heads(len(cited))}")
                                + f" · {llm.get('model') or 'LLM'} · " + L(f"разбор в {at or '—'}.", f"analysed at {at or '—'}.")
                                + (L(" Свежий цикл агента бумагу не упоминал — это последний разбор.",
                                     " The latest agent cycle did not mention this stock — this is its most recent analysis.")
                                   if stale else ""), effect=""))
    elif not llm.get("enabled"):
        checks.append(dict(cls="warn", status=L("нет ключа", "no key"), title=L("Агент новостей не запускался", "The news agent has not run"),
                           text=L("Нет ключа LLM — здесь «нет данных».", "No LLM key — “no data” here."), effect=""))
    elif llm.get("error"):
        checks.append(dict(cls="warn", status=L("ошибка", "error"), title=L("Агент новостей не ответил", "The news agent did not respond"),
                           text=L(f"{llm['error']}. В этом случае — «нет данных».", "The agent returned an error — “no data” in this case."), effect=""))
    elif not view:
        checks.append(dict(cls="info", status=L("ждёт", "waiting"), title=L("Агент ещё не запускался", "The agent has not run yet"),
                           text=L("Первый разбор начнётся, когда сборщик наполнит журнал.",
                                  "The first analysis starts once the collector has filled the log."), effect=""))
    else:
        checks.append(dict(cls="info", status=L("нет оценки", "no score"), title=L("Агент не оценил бумагу", "The agent did not score this stock"),
                           text=L("Бумага без значимых новостей в оценку не попадает — «нет данных».",
                                  "A stock without significant news is not scored — “no data”."), effect=""))
    rev = view.reversals.get(t) if view else None
    if rev:
        before_why = tr(rev.get("before_why") or "")
        checks.append(dict(cls="warn", status=L("разворот", "reversal"), title=L("Оценка развернулась", "The score flipped"),
                           text=L(f"Час назад было {signed(rev['before'])} («{before_why}»), сейчас {signed(rev['now'])} — без новой новости.",
                                  f"An hour ago it was {signed(rev['before'])} (“{before_why}”), now {signed(rev['now'])} — with no new news."),
                           effect=""))
    for ev, why_not, c in events:
        detail = tr(ev.detail[:1].upper() + ev.detail[1:])
        checks.append(dict(cls="warn" if why_not else "ok", status=L("словарь модели", "event dictionary"),
                           title=events_names.get(ev.event_type, ev.event_type),
                           text=detail + (L(f". Но {why_not}.", f". But {tr(why_not)}.") if why_not else ".")
                                + L(f" Заголовок: «{c.title[:120]}».", f" Headline: “{tr(c.title)[:140]}”."), effect=""))
    sources = sorted({c.source for c in ordered})
    official = sorted({c.source for c in ordered if c.kind == "official"})
    if official:
        checks.append(dict(cls="ok", status=L("первоисточник", "primary source"), title=L("Есть официальный источник", "An official source is present"),
                           text=L("Среди заголовков есть официальный источник: ", "The headlines include an official source: ")
                                + ", ".join(official) + ".", effect=""))
    if sources:
        n = len(sources)
        checks.append(dict(cls="info", status=L(f"{n} {_plural(n, 'источник', 'источника', 'источников')}", f"{n} source" + ("" if n == 1 else "s")),
                           title=L("Кто пишет", "Who reports"), text=", ".join(sources) + ".", effect=""))
    q = (ctx.get("quotes") or {}).get(t)
    if q and q.get("last"):
        chg = q.get("change")
        checks.append(dict(cls="info", status="MOEX ISS", title=L("Цена на бирже", "Exchange price"),
                           text=f"{names.get(t, t)} ({t}): {num(q['last'])} ₽"
                                + (L(f", {signed(chg, 1)}% к прошлому закрытию", f", {signed(chg, 1)}% vs previous close") if chg is not None else "")
                                + (f" · {q['time']}" if q.get("time") else "") + ".", effect=""))
    if view and view.market_overall is not None:
        checks.append(dict(cls="info", status=signed(view.market_overall), title=L("Фон рынка", "Market backdrop"),
                           text=tr(view.narrative) if view.narrative else L("Оценка рынка агентом новостей.", "The news agent's market view."), effect=""))

    explain = []
    for c in ordered[:8]:
        explain.append(dict(kind=c.source, text=tr(c.title), quotes=[], url=c.url,
                            time=c.ts.astimezone(MSK).strftime("%-d %b %H:%M" if en else "%d.%m %H:%M"), cited=c.claim_id in cited))
    why = tr(agent.get("why") or "") if agent else ""
    if why:
        explain.append(dict(kind="вывод", out=True, text=why, quotes=[]))   # «вывод» — ключ, подпись даёт фронт

    opinions = []
    if agent:
        opinions.append(dict(role=L("Агент новостей", "News agent"), model=llm.get("model") or "LLM",
                             impact=int(round(max(-1.0, min(1.0, score)) * 2)), uncertainty=round(1 - conf, 2),
                             text=why))

    ts = lead.ts if lead else ctx["now"]
    pub = ts.astimezone(MSK)
    first_ok = next((e for e in events if not e[1]), None)
    return {
        "id": t,
        "ticker": t,
        "issuer": names.get(t, t),
        "target": L(f"акции {t}", f"{t} shares"),
        "kind": events_names.get(first_ok[0].event_type) if first_ok else
                L(f"{heads(len(ordered), 'nom')} по бумаге", f"{heads(len(ordered))} on the stock"),
        "date": pub.strftime("%-d %b %Y" if en else "%d.%m.%Y"),
        "time": pub.strftime("%H:%M"),
        "ts": ts.isoformat(),
        "title": title,
        "verdict": {"label": label, "tone": tone, "weak": weak},
        "score": round(score, 2) if score is not None else None,
        "confidence": round(conf, 2) if conf is not None else None,
        "method": "llm" if agent else "none",
        "sources": sources,
        "n_claims": len(ordered),                 # с тикером бумаги + те, на которые сослался агент
        "links": [{"source": c.source, "url": c.url, "title": tr(c.title)} for c in ordered if c.url][:6],
        "checks": checks,
        "explain": explain,
        "watch": [],
        "opinions": opinions,
        "set": "live",
        "analyzed_at": at,                        # когда агент разобрал бумагу
        "stale": stale,                           # разбор из прошлого цикла агента
    }


def build(claims, view, universe: List[str], ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Карточка на каждую бумагу, которую оценил агент."""
    per: Dict[str, List[Any]] = {t: [] for t in universe}
    for c in claims:
        for t in c.tickers:                    # NewsFeed уже оставил только тикеры universe
            if t in per:
                per[t].append(c)
    all_by_id = {c.claim_id: c for c in claims}
    out = [build_card(t, per[t], view, ctx, all_by_id) for t in universe if view and view.per_ticker.get(t)]
    out.sort(key=lambda x: (x["stale"], -abs(x["score"] or 0)))   # свежий цикл первым, сильные оценки выше
    return out
