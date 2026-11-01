#!/usr/bin/env python3
"""Встраивает отчёт скоринга в data/report-embed.js.

Сайт читает data/news_scoring_report.html через fetch. Когда страница открыта
двойным кликом (file://), браузер fetch запрещает — тогда берётся копия из
report-embed.js. Обе копии должны совпадать, поэтому после замены отчёта:

    python3 tools/embed_report.py                     # взять ../news_scoring_report.html
    python3 tools/embed_report.py path/to/report.html # или указать файл явно
"""
import json
import shutil
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else SITE.parent / "news_scoring_report.html"
if not src.exists():
    sys.exit(f"Отчёт не найден: {src}")

html = src.read_text(encoding="utf-8")
data_dir = SITE / "data"
data_dir.mkdir(exist_ok=True)
if src.resolve() != (data_dir / "news_scoring_report.html").resolve():
    shutil.copyfile(src, data_dir / "news_scoring_report.html")

# </script> внутри строки закрыл бы тег, поэтому экранируем «/».
payload = json.dumps(html, ensure_ascii=False).replace("</", "<\\/")
(data_dir / "report-embed.js").write_text(
    "/* Сгенерировано tools/embed_report.py — не редактировать вручную. */\n"
    f"window.HM_REPORT_EMBED = {{ source: {json.dumps(src.name)}, html: {payload} }};\n",
    encoding="utf-8",
)
print(f"OK: {src.name} → data/news_scoring_report.html + data/report-embed.js ({len(html):,} символов)")
