#!/usr/bin/env bash
# Настройка сервера под живой режим. Её запускает deploy.sh на сервере в фоне, чтобы обрыв SSH не прерывал.
#   APP=/opt/honeymoney DOMAIN=ciolkovsky.ru bash setup.sh
# Повторный запуск безопасен.
trap 'echo "__FAIL__ строка $LINENO"' ERR
set -euo pipefail
: "${APP:?}" "${DOMAIN:?}"
export DEBIAN_FRONTEND=noninteractive
echo 'DPkg::Lock::Timeout "600";' > /etc/apt/apt.conf.d/90lock-wait
apt-get update -qq
apt-get install -y -qq python3 python3-venv curl gnupg debian-keyring debian-archive-keyring apt-transport-https \
  ufw fail2ban unattended-upgrades >/dev/null
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

# --- приложение ---
id honeymoney >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin honeymoney
M="$APP/honey-money-moex"
mkdir -p "$M/data/news_live" "$M/data/telegram" "$APP/site/live/.data"
[ -x "$M/.venv/bin/python" ] || python3 -m venv "$M/.venv"
"$M/.venv/bin/pip" install -q --upgrade pip
"$M/.venv/bin/pip" install -q -r "$APP/site/live/requirements.txt" qrcode
chown -R honeymoney:honeymoney "$APP"
chmod 750 "$APP"
chmod 600 "$M/.env"
chmod 700 "$M/data" "$M/data/telegram"
find "$M/data/telegram" -type f -exec chmod 600 {} +

cat > /etc/systemd/system/honeymoney.service <<UNIT
[Unit]
Description=Honey Money — живой режим (сайт + сборщик новостей модели)
After=network-online.target
Wants=network-online.target

[Service]
User=honeymoney
Group=honeymoney
WorkingDirectory=$APP/site
Environment=HM_MOEX_DIR=$M HOST=127.0.0.1 PORT=8000 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 TZ=Europe/Moscow
ExecStart=$M/.venv/bin/python $APP/site/live/server.py
Restart=always
RestartSec=5
UMask=0077
# песочница: писать можно только в журнал модели и снимок сайта
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=$M/data $APP/site/live/.data
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
RestrictRealtime=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
UNIT

mkdir -p /etc/caddy/sites
cat > /etc/caddy/Caddyfile <<CADDY
# отдельные сайты (API — deploy_api.sh) лежат в /etc/caddy/sites/
import /etc/caddy/sites/*.caddy

www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}

$DOMAIN {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
		Cross-Origin-Opener-Policy "same-origin"
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
		-Server
	}
	# только чтение: всё, кроме GET и HEAD, отбиваем на входе
	@write not method GET HEAD
	respond @write 405
	reverse_proxy 127.0.0.1:8000 {
		header_down -Server
		header_down -Access-Control-Allow-Origin
		header_down -Access-Control-Allow-Private-Network
	}
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null

# --- сервер ---
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

cat > /etc/fail2ban/jail.d/sshd.local <<'F2B'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
F2B

# SSH только по ключу — если у root есть ключ (иначе можно запереть себя)
if [ -s /root/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/00-honeymoney.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
X11Forwarding no
MaxAuthTries 4
SSHD
  sshd -t && systemctl reload ssh
fi

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT

systemctl daemon-reload
systemctl enable -q honeymoney caddy fail2ban
systemctl restart honeymoney fail2ban
systemctl reload caddy 2>/dev/null || systemctl restart caddy

for i in $(seq 1 30); do curl -sf localhost:8000/api/health >/dev/null && break; sleep 2; done
echo "служба: $(systemctl is-active honeymoney) · caddy: $(systemctl is-active caddy) · fail2ban: $(systemctl is-active fail2ban) · ufw: $(ufw status | head -1)"
curl -s localhost:8000/api/health; echo
echo "__DONE__"
