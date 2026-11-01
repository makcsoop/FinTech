"""Живой режим: сайт + /api/live и /api/prices поверх новостной части Honey Money (на сервере).

    HM_MOEX_DIR=/путь/к/новостной/части tools/live.sh       # http://localhost:8000

Новостная часть в публичную версию не входит. Сервер запускает её сборщик новостей и раз в CYCLE_S
(900 с) шаг агента новостей; результат — GET /api/live в форме карточек отчёта скоринга.
Сервер не торгует: торговую часть он не импортирует и не запускает.
"""
from __future__ import annotations

import atexit
import json
import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
MOEX = Path(os.environ.get("HM_MOEX_DIR") or SITE.parent / "honey-money-moex").resolve()
CACHE = Path(__file__).resolve().parent / ".data"      # только снимок для фронта, журналы — у модели
PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "0.0.0.0")             # на сервере за Caddy — 127.0.0.1
REFRESH_S = int(os.environ.get("REFRESH_S", "60"))
MSK = timezone(timedelta(hours=3))

log = logging.getLogger("live")
_SECRET = re.compile(r"(gsk_|sk-|Bearer\s+)\S+|https?://\S+|/(?:Users|opt|home|root|private)/\S+", re.I)


def public_error(e) -> str | None:
    """Текст ошибки для посетителей: без ключей, адресов и путей на сервере; подробности — в журнал службы."""
    if not e:
        return None
    return _SECRET.sub("…", str(e))[:160]


def load_env(path: Path) -> None:
    """KEY=value из .env модели — так модель запускают по её README (set -a && source .env)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.split(" #")[0].strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


if not (MOEX / "src" / "hm2" / "news.py").exists():
    sys.exit(f"Не найдена новостная часть: {MOEX}\nУкажите путь: HM_MOEX_DIR=/путь")
load_env(MOEX / ".env")
os.chdir(MOEX)                                         # относительные пути .env модели (./data) — от её корня
DATA = Path(os.environ.get("DATA_DIR", "./data")).resolve()
os.environ["DATA_DIR"] = str(DATA)
CYCLE_S = int(os.environ.get("CYCLE_S") or os.environ.get("DECISION_INTERVAL_SECONDS", "900").split()[0])
CACHE.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(MOEX))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import cards  # noqa: E402
from src import portfolios  # noqa: E402
from src.data.news.collector import collector_running, live_dir  # noqa: E402
from src.hm2 import llm, news  # noqa: E402

UNIVERSE = portfolios.load().universe

FLOW = [
    {"label": "Сборщик новостей: ленты, сайты, Telegram", "type": "core"},
    {"label": "Журнал утверждений: одна запись — один claim_id", "type": ""},
    {"label": "Отбор самых важных и свежих заголовков", "type": ""},
    {"label": "Агент новостей: оценка бумаг", "type": "opt"},
    {"label": "Проверка ответа по схеме", "type": "opt"},
    {"label": "Сверка с прошлой оценкой", "type": ""},
    {"label": "Карточка бумаги", "type": ""},
]


def fetch_quotes() -> dict:
    """Последняя цена и изменение к прошлому закрытию — публичный ISS Мосбиржи (только для показа)."""
    from src.data._http import urlopen
    url = ("https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json"
           "?iss.meta=off&iss.only=marketdata,securities&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME"
           "&securities.columns=SECID,PREVPRICE&securities=" + ",".join(UNIVERSE))
    try:
        with urlopen(urllib.request.Request(url, headers={"User-Agent": "honey-money-demo"}), timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # сеть или ISS недоступны — карточки без цены
        log.warning("ISS: %s", e)
        return {}
    prev = {row[0]: row[1] for row in data["securities"]["data"]}
    out = {}
    for secid, last, chg, upd in data["marketdata"]["data"]:
        price = last or prev.get(secid)
        if price:
            out[secid] = {"last": price, "change": chg if last else None,
                          "time": (upd[:5] if last and upd else "закрытие")}
    return out


class Prices:
    """Бегущая лента цен первого эшелона (индекс голубых фишек MOEXBC) — только для показа, в модель не идёт.

    Источник — T-Invest API (TINVEST_READONLY_TOKEN из .env модели, токен «только чтение»; на клиент не уходит).
    Нет токена или T-Invest не ответил — публичный ISS Мосбиржи (бесплатно, с задержкой 15 минут).
    Сертификат T-Invest выпущен НУЦ Минцифры: корень берём из live/certs только для этих запросов.
    """
    TINVEST = "https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1."
    RU_CA = str(Path(__file__).resolve().parent / "certs" / "russian_trusted_ca.pem")
    ISS = "https://iss.moex.com/iss"
    BLUE = ["LKOH", "GAZP", "SBER", "YDEX", "TATN", "T", "NVTK", "GMKN", "OZON", "X5",
            "ROSN", "VTBR", "PLZL", "SNGS", "MOEX"]           # запасной состав MOEXBC, если ISS не ответил
    EVERY_S = int(os.environ.get("PRICES_S", "15"))

    def __init__(self) -> None:
        import requests
        self.http = requests.Session()
        self.http.headers["User-Agent"] = "honey-money-site"
        self.lock = threading.Lock()
        self.payload = None
        self.blue, self.blue_day = list(self.BLUE), None
        self.uids = {}                      # тикер → uid T-Invest, раз в сутки
        self.uids_day = None
        self.tinvest_next = 0.0             # после ошибки T-Invest пробуем снова через 10 минут
        self.tinvest_error = None

    def snapshot(self):
        with self.lock:
            return self.payload

    def blue_chips(self) -> list:
        today = datetime.now(MSK).date()
        if self.blue_day != today:
            try:
                r = self.http.get(f"{self.ISS}/statistics/engines/stock/markets/index/analytics/MOEXBC.json",
                                  params={"limit": 100, "iss.meta": "off"}, timeout=15)
                a = r.json()["analytics"]
                rows = [dict(zip(a["columns"], x)) for x in a["data"]]
                if rows:
                    self.blue = [x["ticker"] for x in sorted(rows, key=lambda x: -(x.get("weight") or 0))]
                self.blue_day = today
            except Exception as e:
                log.warning("состав MOEXBC: %s", public_error(e))
        return self.blue

    def _tinvest(self, method: str, body: dict, token: str) -> dict:
        r = self.http.post(self.TINVEST + method, json=body, timeout=15, verify=self.RU_CA,
                           headers={"Authorization": "Bearer " + token})
        if r.status_code != 200:
            raise RuntimeError(f"T-Invest {r.status_code}: {r.json().get('message', '')[:80]}")
        return r.json()

    def from_tinvest(self, tickers: list):
        token = os.environ.get("TINVEST_READONLY_TOKEN", "").strip()
        if not token or time.time() < self.tinvest_next:
            return None
        q = lambda v: (int(v.get("units") or 0) + int(v.get("nano") or 0) / 1e9) if v else None
        today = datetime.now(MSK).date()
        if self.uids_day != today or any(t not in self.uids for t in tickers):
            shares = self._tinvest("InstrumentsService/Shares", {"instrumentStatus": "INSTRUMENT_STATUS_BASE"}, token)
            self.uids = {s["ticker"]: s["uid"] for s in shares.get("instruments", []) if s.get("classCode") == "TQBR"}
            self.uids_day = today
        by_uid = {self.uids[t]: t for t in tickers if t in self.uids}
        last = self._tinvest("MarketDataService/GetLastPrices", {"instrumentId": list(by_uid)}, token)
        close = self._tinvest("MarketDataService/GetClosePrices",
                              {"instruments": [{"instrumentId": u} for u in by_uid]}, token)
        prev = {c.get("instrumentUid"): q(c.get("price")) for c in close.get("closePrices", [])}
        out = {}
        for p in last.get("lastPrices", []):
            t, price = by_uid.get(p.get("instrumentUid")), q(p.get("price"))
            if not t or not price:
                continue
            ts = p.get("time")
            hm = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(MSK).strftime("%H:%M") if ts else None
            pc = prev.get(p.get("instrumentUid"))
            out[t] = {"last": price, "change": round((price / pc - 1) * 100, 2) if pc else None, "time": hm}
        return out

    def from_iss(self, tickers: list) -> dict:
        r = self.http.get(f"{self.ISS}/engines/stock/markets/shares/boards/TQBR/securities.json", timeout=15, params={
            "iss.meta": "off", "iss.only": "marketdata,securities", "securities": ",".join(tickers),
            "marketdata.columns": "SECID,LAST,LASTTOPREVPRICE,UPDATETIME", "securities.columns": "SECID,PREVPRICE"})
        d = r.json()
        prev = {s: p for s, p in d["securities"]["data"]}
        out = {}
        for secid, last, chg, upd in d["marketdata"]["data"]:
            price = last or prev.get(secid)
            if price:
                out[secid] = {"last": price, "change": chg if last else None, "time": upd[:5] if last and upd else None}
        return out

    def refresh(self) -> None:
        tickers = self.blue_chips()
        source, quotes = None, None
        try:
            quotes = self.from_tinvest(tickers)
            if quotes:
                source, self.tinvest_error = "T-Invest", None
        except Exception as e:
            self.tinvest_error = public_error(e)
            self.tinvest_next = time.time() + 600
            log.warning("T-Invest: %s — лента на ISS Мосбиржи", self.tinvest_error)
        if not quotes:
            quotes, source = self.from_iss(tickers), "MOEX ISS"
        items = [dict(ticker=t, name=cards.NAMES.get(t, t), **quotes[t]) for t in tickers if t in quotes]
        if not items:
            return
        with self.lock:
            self.payload = {"ok": True, "source": source, "delayed": source == "MOEX ISS",
                            "index": "MOEXBC", "updated_at": datetime.now(timezone.utc).isoformat(),
                            "every_s": self.EVERY_S, "items": items}

    def loop(self) -> None:
        while True:
            try:
                self.refresh()
            except Exception as e:
                log.warning("котировки: %s", public_error(e))
            time.sleep(self.EVERY_S)


class Collector:
    """Сборщик новостей модели — её собственный скрипт, без изменений. Один на машину (замок модели)."""

    def __init__(self) -> None:
        self.proc = None
        self.own = False

    def ensure(self) -> str:
        if self.proc and self.proc.poll() is None:
            return "запущен сайтом"
        if collector_running(DATA):
            return "уже работает"
        live_dir(DATA).mkdir(parents=True, exist_ok=True)
        self.proc = subprocess.Popen([sys.executable, str(MOEX / "scripts" / "news_collector.py")], cwd=str(MOEX),
                                     env=dict(os.environ, PYTHONPATH=str(MOEX)),
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.own = True
        log.info("сборщик новостей модели запущен (pid %d), журнал %s", self.proc.pid, live_dir(DATA))
        return "запущен сайтом"

    def stop(self) -> None:
        if self.own and self.proc and self.proc.poll() is None:
            self.proc.terminate()


COLLECTOR = Collector()
atexit.register(COLLECTOR.stop)


class Live:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.feed = news.NewsFeed([DATA / "news_live", DATA / "news"], UNIVERSE)
        self.view = None
        self.analyzed_at = 0.0
        self.version = 0
        self.payload = None
        self.error = None
        self.llm = {"enabled": bool(os.environ.get("POLZA_API_KEY")), "error": None,
                    "model": os.environ.get("LLM_MODEL_HEAVY") or llm.HEAVY}
        p = CACHE / "live.json"
        if p.exists():
            try:
                self.payload = json.loads(p.read_text(encoding="utf-8"))
                self.payload["status"] = "cached"
                self.version = self.payload.get("version", 0)
            except (ValueError, KeyError):
                self.payload = None

    def snapshot(self) -> dict:
        with self.lock:
            if self.payload:
                return self.payload
            return {"ok": False, "status": "warming", "error": public_error(self.error),
                    "message": "Сборщик модели наполняет журнал — это занимает около минуты"}

    def news_step(self, claims) -> None:
        """Шаг агента новостей: отбор заголовков, оценка бумаг, сверка с прошлой оценкой."""
        fresh = self.feed.take_fresh()
        headlines = self.feed.select(claims)
        view = news.analyze(headlines, UNIVERSE)
        for c in fresh:
            for t in c.tickers:
                view.new_claims.setdefault(t, []).append(c)
        news.track_reversals(self.feed, view)
        self.analyzed_at = time.time()
        self.llm["error"] = public_error(view.error) if view.error and view.error != "нет заголовков" else None
        if view.error:
            log.warning("агент новостей: %s", view.error)
        self.view = view
        log.info("агент новостей: %d заголовков → %d бумаг", len(headlines), len(view.per_ticker))

    def refresh(self) -> None:
        collector = COLLECTOR.ensure()
        claims, _new = self.feed.load()                 # окно модели по умолчанию — 18 ч
        if claims and self.llm["enabled"] and (self.view is None or time.time() - self.analyzed_at >= CYCLE_S):
            self.news_step(claims)
        now = datetime.now(timezone.utc)
        ctx = {"now": now, "quotes": fetch_quotes(), "llm": self.llm,
               "analyzed_at": datetime.fromtimestamp(self.analyzed_at, MSK).strftime("%H:%M") if self.analyzed_at else None}
        built = cards.build(claims, self.view, UNIVERSE, ctx)
        status = {}
        try:
            status = json.loads((live_dir(DATA) / "status.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        sig = [(c["id"], c["score"], c["n_claims"]) for c in built]
        with self.lock:
            old = (self.payload or {}).get("_sig")
            if sig != old or (self.payload or {}).get("status") != "live":
                self.version += 1
            if not built and not claims:
                self.payload = None                     # журнал ещё пуст — фронт остаётся на отчёте
                return
            self.payload = {
                "ok": True, "status": "live", "version": self.version, "_sig": sig,
                "updated_at": now.isoformat(),
                "window_h": 18, "refresh_s": REFRESH_S, "cycle_s": CYCLE_S,
                "next_analysis_at": (datetime.fromtimestamp(self.analyzed_at + CYCLE_S, timezone.utc).isoformat()
                                     if self.analyzed_at else None),
                "collector": collector,
                "sources_n": (len(status.get("feeds", {})) + int((status.get("telegram") or {}).get("channels") or 0)) or None,
                "telegram": (status.get("telegram") or {}).get("state"),
                "sources_active": len({c.source for c in claims}),
                "items_total": len(claims),
                "universe": UNIVERSE,
                "llm": dict(self.llm, at=datetime.fromtimestamp(self.analyzed_at, timezone.utc).isoformat()
                            if self.analyzed_at else None),
                "market": {"overall": self.view.market_overall, "narrative": self.view.narrative} if self.view else None,
                "flow": FLOW,
                "cards": built,
            }
            snap = json.dumps(self.payload, ensure_ascii=False)
        (CACHE / "live.json").write_text(snap, encoding="utf-8")
        self.error = None

    def loop(self) -> None:
        while True:
            try:
                self.refresh()
            except Exception as e:
                self.error = str(e)
                log.exception("обновление не удалось")
            time.sleep(REFRESH_S)


LIVE = Live()
PRICES = Prices()


def blocked(path: str) -> bool:
    """Служебное и скрытые файлы не отдаём: исходники сервера, выкладка, инструменты, заметки."""
    from urllib.parse import unquote
    p = unquote(path)
    return (p.startswith(("/live/", "/deploy/", "/tools/")) or p.endswith((".md", ".py", ".sh"))
            or "/." in p or ".." in p)


class Handler(SimpleHTTPRequestHandler):
    server_version = "honeymoney"
    sys_version = ""                                   # не светить версию Python

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def list_directory(self, path):                    # содержимое папок не показываем
        self.send_error(404)
        return None

    def log_message(self, fmt, *args):  # статику не логируем
        if self.path.startswith("/api"):
            log.debug(fmt, *args)

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """Предзапрос браузера, когда сайт с GitHub Pages ходит к этому серверу (?api=…)."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/live":
            return self._json(LIVE.snapshot())
        if path == "/api/prices":
            return self._json(PRICES.snapshot() or {"ok": False, "status": "warming"})
        if path == "/api/health":
            s = LIVE.snapshot()
            return self._json({"ok": True, "status": s.get("status"), "cards": len(s.get("cards", [])),
                               "updated_at": s.get("updated_at"), "llm": LIVE.llm["enabled"],
                               "collector": s.get("collector")})
        if blocked(path):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if blocked(self.path.split("?")[0]):
            return self.send_error(404)
        return super().do_HEAD()

    def end_headers(self):
        if not self.path.startswith("/api"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    for noisy in ("src", "httpx", "httpcore", "telethon", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.ERROR)
    log.info("модель: %s · данные %s · бумаг %d · агент новостей: %s, цикл %d с", MOEX, DATA, len(UNIVERSE),
             "есть ключ" if LIVE.llm["enabled"] else "нет ключа — «нет данных»", CYCLE_S)
    # остановили сайт — останавливаем и сборщик, если его запускал сайт (atexit на SIGTERM не срабатывает)
    signal.signal(signal.SIGTERM, lambda *_: (COLLECTOR.stop(), os._exit(0)))
    threading.Thread(target=LIVE.loop, daemon=True).start()
    threading.Thread(target=PRICES.loop, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    log.info("сайт: http://localhost:%d", PORT)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
