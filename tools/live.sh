#!/usr/bin/env bash
# Живой режим: сайт + новостная часть Honey Money на http://localhost:8000
#   HM_MOEX_DIR=/путь tools/live.sh     — папка новостной части (в публичную версию не входит)
#   PORT=8080 tools/live.sh             — другой порт
# Без неё сайт работает в режиме отчёта: python3 tools/serve.py
set -euo pipefail
SITE="$(cd "$(dirname "$0")/.." && pwd)"
MOEX="${HM_MOEX_DIR:-$SITE/../honey-money-moex}"
[ -d "$MOEX/src" ] || { echo "Нет новостной части в $MOEX — укажите HM_MOEX_DIR или запустите режим отчёта: python3 tools/serve.py"; exit 1; }
MOEX="$(cd "$MOEX" && pwd)"
if [ ! -x "$MOEX/.venv/bin/python" ]; then
  python3 -m venv "$MOEX/.venv"
  "$MOEX/.venv/bin/pip" install -q -r "$SITE/live/requirements.txt"
fi
export HM_MOEX_DIR="$MOEX"
exec "$MOEX/.venv/bin/python" "$SITE/live/server.py"
