"""Карточки для фронта из того, что выдаёт агент новостей. Ничего не досчитывает.

Агент оценивает бумагу целиком, поэтому карточка — одна на бумагу. Если оценки нет, это «нет данных», а не 0.

Здесь только перекладка в форму карточки отчёта скоринга (report.js), чтобы фронт работал без переделки.
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
EVENT_RU = {
    "dividend_decision": "Дивидендное решение",
    "dividend_policy_change": "Смена дивидендной политики",
    "production_halt_or_key_asset_damage": "Остановка или удар по объекту",
}


def _num(x: float, d: int = 2) -> str:
    return f"{x:.{d}f}".replace(".", ",")


def _signed(x: float, d: int = 2) -> str:
    return ("+" if x >= 0 else "−") + _num(abs(x), d)


def _plural(n: int, one: str, few: str, many: str) -> str:
    n100, n10 = n % 100, n % 10
    if 11 <= n100 <= 14:
        return many
    return one if n10 == 1 else few if 2 <= n10 <= 4 else many


def build_card(t: str, claims: List[Any], view: Optional[Any], ctx: Dict[str, Any],
               all_by_id: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    from src.hm2 import fastpath

    agent = (view.per_ticker.get(t) if view else None) or None
    cited = list(agent.get("claims") or []) if agent else []
    # агент ссылается на любые заголовки из отбора, не только с тикером бумаги
    by_id = dict(all_by_id or {})
    by_id.update({c.claim_id: c for c in claims})
    ordered = [by_id[i] for i in cited if i in by_id] + \
        sorted((c for c in claims if c.claim_id not in cited), key=lambda c: c.ts, reverse=True)
    lead = ordered[0] if ordered else None
    title = lead.title if lead else ((agent.get("titles") or [""])[0] if agent else "")

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
        at = d.strftime("%H:%M") if d.date() == ctx["now"].astimezone(MSK).date() else d.strftime("%d.%m, %H:%M")
    score = float(agent["s"]) if agent else None
    conf = float(agent["c"]) if agent else None
    if score is None:
        tone, weak, label = "neu", False, "нет данных"
    else:
        a = abs(score)
        tone = "pos" if score >= 0.05 else "neg" if score <= -0.05 else "neu"
        weak = 0.05 <= a < 0.15
        label = {"pos": "позитив", "neg": "негатив", "neu": "нейтрально"}[tone]
        if weak:
            label = "слабый " + label

    checks = []
    llm = ctx.get("llm") or {}
    if agent:
        checks.append(dict(cls="info", status="LLM", title="Агент новостей",
                           text=f"Оценка модели по {len(cited)} {_plural(len(cited), 'заголовку', 'заголовкам', 'заголовкам')}"
                                f" · {llm.get('model') or 'LLM'} · разбор в {at or '—'}."
                                + (" Свежий цикл агента бумагу не упоминал — это последний разбор." if stale else ""), effect=""))
    elif not llm.get("enabled"):
        checks.append(dict(cls="warn", status="нет ключа", title="Агент новостей не запускался",
                           text="В .env модели нет POLZA_API_KEY. В брифинге модели здесь было бы «нет данных».", effect=""))
    elif llm.get("error"):
        checks.append(dict(cls="warn", status="ошибка", title="Агент новостей не ответил",
                           text=f"{llm['error']}. Модель в этом случае пишет «нет данных».", effect=""))
    elif not view:
        checks.append(dict(cls="info", status="ждёт", title="Агент ещё не запускался",
                           text="Первый разбор начнётся, когда сборщик наполнит журнал.", effect=""))
    else:
        checks.append(dict(cls="info", status="нет оценки", title="Агент не оценил бумагу",
                           text="По правилам модели бумага без значимых новостей в оценку не попадает — «нет данных».",
                           effect=""))
    rev = view.reversals.get(t) if view else None
    if rev:
        checks.append(dict(cls="warn", status="разворот", title="Оценка развернулась",
                           text=f"Час назад было {_signed(rev['before'])} («{rev.get('before_why') or ''}»), "
                                f"сейчас {_signed(rev['now'])} — без новой новости.", effect=""))
    for ev, why_not, c in events:
        checks.append(dict(cls="warn" if why_not else "ok", status="словарь модели",
                           title=EVENT_RU.get(ev.event_type, ev.event_type),
                           text=(ev.detail[:1].upper() + ev.detail[1:]) + (f". Но {why_not}." if why_not else ".")
                                + f" Заголовок: «{c.title[:120]}».", effect=""))
    sources = sorted({c.source for c in ordered})
    official = sorted({c.source for c in ordered if c.kind == "official"})
    if official:
        checks.append(dict(cls="ok", status="первоисточник", title="Есть официальный источник",
                           text="Среди заголовков есть официальный источник: " + ", ".join(official) + ".", effect=""))
    if sources:
        checks.append(dict(cls="info", status=f"{len(sources)} {_plural(len(sources), 'источник', 'источника', 'источников')}",
                           title="Кто пишет", text=", ".join(sources) + ".", effect=""))
    q = (ctx.get("quotes") or {}).get(t)
    if q and q.get("last"):
        chg = q.get("change")
        checks.append(dict(cls="info", status="MOEX ISS", title="Цена на бирже",
                           text=f"{NAMES.get(t, t)} ({t}): {_num(q['last'])} ₽"
                                + (f", {_signed(chg, 1)}% к прошлому закрытию" if chg is not None else "")
                                + (f" · {q['time']}" if q.get("time") else "") + ".", effect=""))
    if view and view.market_overall is not None:
        checks.append(dict(cls="info", status=_signed(view.market_overall), title="Фон рынка",
                           text=view.narrative or "Оценка рынка агентом новостей.", effect=""))

    explain = []
    for c in ordered[:8]:
        explain.append(dict(kind=c.source, text=c.title, quotes=[], url=c.url,
                            time=c.ts.astimezone(MSK).strftime("%d.%m %H:%M"), cited=c.claim_id in cited))
    if agent and agent.get("why"):
        explain.append(dict(kind="вывод", text=agent["why"], quotes=[]))

    opinions = []
    if agent:
        opinions.append(dict(role="Агент новостей", model=llm.get("model") or "LLM",
                             impact=int(round(max(-1.0, min(1.0, score)) * 2)), uncertainty=round(1 - conf, 2),
                             text=agent.get("why") or ""))

    ts = lead.ts if lead else ctx["now"]
    pub = ts.astimezone(MSK)
    first_ok = next((e for e in events if not e[1]), None)
    return {
        "id": t,
        "ticker": t,
        "issuer": NAMES.get(t, t),
        "target": f"акции {t}",
        "kind": EVENT_RU.get(first_ok[0].event_type) if first_ok else
                f"{len(ordered)} {_plural(len(ordered), 'заголовок', 'заголовка', 'заголовков')} по бумаге",
        "date": pub.strftime("%d.%m.%Y"),
        "time": pub.strftime("%H:%M"),
        "ts": ts.isoformat(),
        "title": title,
        "verdict": {"label": label, "tone": tone, "weak": weak},
        "score": round(score, 2) if score is not None else None,
        "confidence": round(conf, 2) if conf is not None else None,
        "method": "llm" if agent else "none",
        "sources": sources,
        "n_claims": len(ordered),                 # с тикером бумаги + те, на которые сослался агент
        "links": [{"source": c.source, "url": c.url, "title": c.title} for c in ordered if c.url][:6],
        "checks": checks,
        "explain": explain,
        "watch": [],
        "opinions": opinions,
        "set": "live",
        "analyzed_at": at,                        # когда агент разобрал бумагу
        "stale": stale,                           # разбор из прошлого цикла агента
    }


def build(claims, view, universe: List[str], ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Карточка на каждую бумагу, которую оценил агент. Остальные заголовки — в ленте новостей (/api/news)."""
    per: Dict[str, List[Any]] = {t: [] for t in universe}
    for c in claims:
        for t in c.tickers:                    # NewsFeed уже оставил только тикеры universe
            if t in per:
                per[t].append(c)
    all_by_id = {c.claim_id: c for c in claims}
    out = [build_card(t, per[t], view, ctx, all_by_id) for t in universe if view and view.per_ticker.get(t)]
    out.sort(key=lambda x: (x["stale"], -abs(x["score"] or 0)))   # свежий цикл первым, сильные оценки выше
    return out
