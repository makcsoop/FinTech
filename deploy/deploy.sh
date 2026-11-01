#!/usr/bin/env bash
# Живой режим на сервер: сайт + новостной контур модели (без торговли), systemd + Caddy (HTTPS).
#   site/deploy/deploy.sh root@<сервер> <домен>
# Повторный запуск обновляет код и перезапускает службу; журнал новостей и сессия Telegram на сервере остаются.
# Сессию Telegram с Mac не копируем: один файл сессии — одна машина. На сервере — свой вход (site/tools/tg_qr_login.py).
#
# Безопасность:
#   • ключи (.env) и сессия Telegram — только у пользователя службы honeymoney, права 600/700, вне папки сайта;
#   • сайт слушает 127.0.0.1, наружу — только Caddy (HTTPS, HSTS, CSP и прочие заголовки);
#   • служба в песочнице systemd: файловая система только на чтение, кроме data/ модели и снимка сайта;
#   • файрвол: открыты 22, 80, 443; fail2ban на SSH; вход по SSH только ключом; автообновления безопасности.
set -euo pipefail
TARGET="${1:?user@host}"
DOMAIN="${2:?домен}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"          # папка с site/ и honey-money-moex/
APP=/opt/honeymoney
SSH=(ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=8 -o ConnectionAttempts=5 -o ControlMaster=auto -o ControlPath=~/.ssh/cm-%r@%h:%p -o ControlPersist=10m)
retry() { for _ in 1 2 3 4 5 6; do "$@" && return 0; sleep 5; done; return 1; }
SYNC=(retry rsync -az -e "${SSH[*]}" --delete --exclude .venv --exclude __pycache__ --exclude .DS_Store)

retry "${SSH[@]}" "$TARGET" "command -v rsync >/dev/null || (apt-get update -qq && apt-get install -y -qq rsync); mkdir -p $APP"
"${SYNC[@]}" --exclude live/.data "$ROOT/site/" "$TARGET:$APP/site/"
# data/ модели исключён: --delete его не трогает, журнал и сессия на сервере живут между выкладками
# закрытые конфиги стратегии сайту не нужны — не выкладываем и удаляем
"${SYNC[@]}" --exclude /data --exclude /.git --exclude /config/agents --exclude /config/strategy_v2.yaml \
  "$ROOT/honey-money-moex/" "$TARGET:$APP/honey-money-moex/"
retry "${SSH[@]}" "$TARGET" "rm -rf $APP/honey-money-moex/config/agents $APP/honey-money-moex/config/strategy_v2.yaml"
# журнал за последние дни — чтобы сайт не стартовал пустым (повторы журнал модели отсекает сам)
retry rsync -az -e "${SSH[*]}" --include 'claims_*.jsonl' --exclude '*' "$ROOT/honey-money-moex/data/news_live/" \
  "$TARGET:$APP/honey-money-moex/data/news_live/" 2>/dev/null || true

# настройка идёт на самом сервере в фоне — обрыв SSH её не прерывает; ждём метку в журнале
LOG=/var/log/honeymoney-setup.log
retry "${SSH[@]}" "$TARGET" "APP=$APP DOMAIN=$DOMAIN nohup bash $APP/site/deploy/setup.sh > $LOG 2>&1 < /dev/null &"
echo "Настройка сервера идёт (журнал $LOG на сервере)…"
until retry "${SSH[@]}" "$TARGET" "grep -q '__DONE__\\|__FAIL__' $LOG"; do sleep 15; done
retry "${SSH[@]}" "$TARGET" "grep -v '^\$' $LOG | tail -6"
retry "${SSH[@]}" "$TARGET" "grep -q __DONE__ $LOG"
echo "Готово: https://$DOMAIN (HTTPS выпустится сам, когда A-запись домена укажет на сервер)"
