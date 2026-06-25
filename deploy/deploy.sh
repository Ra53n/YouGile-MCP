#!/usr/bin/env bash
#
# Idempotent deploy of the YouGile MCP server (HTTP transport) onto an Ubuntu VPS.
#
# It installs Node + Caddy, installs the `yougile-mcp-server` package, writes an
# environment file + systemd service, and configures Caddy with automatic HTTPS.
#
# It does NOT touch your firewall or VPN — the app binds to 127.0.0.1 and is only
# reachable through Caddy on 443. (Ensure ports 80 + 443 are reachable so Caddy
# can obtain a TLS certificate.)
#
# Usage (run as root on the VPS):
#   sudo YOUGILE_API_KEY=... MCP_PUBLIC_HOST=yougile.example.com ./deploy.sh
#
# Config via environment (prompts for missing required values on a TTY):
#   YOUGILE_API_KEY   (required)   YouGile Bearer key
#   MCP_PUBLIC_HOST   (required)   domain or <dashed-ip>.sslip.io
#   MCP_AUTH_TOKEN    (optional)   auto-generated if unset
#   PORT              (default 3000)
#   YOUGILE_BASE_URL  (default https://ru.yougile.com/api-v2)
#   YOUGILE_USER_ID   (optional)
#   SERVICE_USER      (default yougile)
#   INSTALL_FROM_SOURCE=1          build+install from this checkout instead of npm
set -euo pipefail

SERVICE_USER="${SERVICE_USER:-yougile}"
PORT="${PORT:-3000}"
YOUGILE_BASE_URL="${YOUGILE_BASE_URL:-https://ru.yougile.com/api-v2}"
ENV_FILE="/etc/yougile-mcp.env"
UNIT_FILE="/etc/systemd/system/yougile-mcp.service"
CADDYFILE="/etc/caddy/Caddyfile"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    err "Run as root (e.g. with sudo)."
    exit 1
  fi
}

prompt_if_missing() {
  # prompt_if_missing VAR "message" [secret]
  local var="$1" msg="$2" secret="${3:-}"
  if [[ -z "${!var:-}" ]]; then
    if [[ -t 0 ]]; then
      if [[ -n "$secret" ]]; then read -rs -p "$msg" value && echo; else read -r -p "$msg" value; fi
      printf -v "$var" '%s' "$value"
    fi
  fi
}

derive_sslip_host() {
  local ip
  ip="$(curl -fsS https://api.ipify.org || true)"
  if [[ -n "$ip" ]]; then
    echo "${ip//./-}.sslip.io"
  fi
}

install_node() {
  local major=0
  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  fi
  if [[ "$major" -ge 18 ]]; then
    log "Node $(node -v) already present."
    return
  fi
  log "Installing Node.js 20 LTS (nodesource)…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    log "Caddy already present."
    return
  fi
  log "Installing Caddy…"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update
  apt-get install -y caddy
}

install_app() {
  if [[ "${INSTALL_FROM_SOURCE:-0}" == "1" ]]; then
    log "Building + installing from source ($SCRIPT_DIR/..)…"
    ( cd "$SCRIPT_DIR/.." && npm ci && npm run build && npm install -g . )
  else
    log "Installing yougile-mcp-server from npm…"
    npm install -g yougile-mcp-server
  fi
  APP_BIN="$(command -v yougile-mcp-server)"
  if [[ -z "$APP_BIN" ]]; then
    err "yougile-mcp-server binary not found after install."
    exit 1
  fi
  log "Binary: $APP_BIN"
}

write_env_file() {
  log "Writing $ENV_FILE (chmod 600)…"
  umask 077
  cat > "$ENV_FILE" <<EOF
TRANSPORT=http
PORT=$PORT
YOUGILE_API_KEY=$YOUGILE_API_KEY
YOUGILE_BASE_URL=$YOUGILE_BASE_URL
MCP_AUTH_TOKEN=$MCP_AUTH_TOKEN
MCP_PUBLIC_HOST=$MCP_PUBLIC_HOST
${YOUGILE_USER_ID:+YOUGILE_USER_ID=$YOUGILE_USER_ID}
EOF
  chown "$SERVICE_USER":"$SERVICE_USER" "$ENV_FILE" 2>/dev/null || true
  chmod 600 "$ENV_FILE"
}

ensure_user() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    log "Creating system user $SERVICE_USER…"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

write_service() {
  log "Writing $UNIT_FILE…"
  sed -e "s|^ExecStart=.*|ExecStart=$APP_BIN|" \
      -e "s|^User=.*|User=$SERVICE_USER|" \
      -e "s|^Group=.*|Group=$SERVICE_USER|" \
      "$SCRIPT_DIR/yougile-mcp.service" > "$UNIT_FILE"
  systemctl daemon-reload
  systemctl enable yougile-mcp.service
  systemctl restart yougile-mcp.service
}

write_caddy() {
  log "Writing $CADDYFILE for host $MCP_PUBLIC_HOST…"
  mkdir -p "$(dirname "$CADDYFILE")"
  cat > "$CADDYFILE" <<EOF
$MCP_PUBLIC_HOST {
    encode gzip
    reverse_proxy 127.0.0.1:$PORT
}
EOF
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
}

main() {
  require_root
  apt-get update -y

  prompt_if_missing YOUGILE_API_KEY "YouGile API key: " secret
  if [[ -z "${MCP_PUBLIC_HOST:-}" ]]; then
    local guess; guess="$(derive_sslip_host)"
    prompt_if_missing MCP_PUBLIC_HOST "Public host (domain or sslip.io)${guess:+ [$guess]}: "
    MCP_PUBLIC_HOST="${MCP_PUBLIC_HOST:-$guess}"
  fi
  : "${YOUGILE_API_KEY:?YOUGILE_API_KEY is required}"
  : "${MCP_PUBLIC_HOST:?MCP_PUBLIC_HOST is required}"
  MCP_AUTH_TOKEN="${MCP_AUTH_TOKEN:-$(openssl rand -hex 32)}"

  install_node
  install_caddy
  install_app
  ensure_user
  write_env_file
  write_service
  write_caddy

  log "Done. Verifying…"
  sleep 2
  systemctl --no-pager --full status yougile-mcp.service | sed -n '1,8p' || true
  echo
  log "Health check (local): $(curl -fsS "http://127.0.0.1:$PORT/healthz" || echo 'FAILED')"
  echo
  cat <<EOF

────────────────────────────────────────────────────────────
Deployment summary
  URL:        https://$MCP_PUBLIC_HOST/mcp
  Auth token: $MCP_AUTH_TOKEN
  (Caddy will obtain a TLS cert on first request; ports 80+443 must be reachable.)

Client config (Claude Desktop / Cursor) via the mcp-remote bridge:

{
  "mcpServers": {
    "yougile-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://$MCP_PUBLIC_HOST/mcp",
               "--header", "Authorization: Bearer $MCP_AUTH_TOKEN"]
    }
  }
}

Logs:    journalctl -u yougile-mcp -f
Restart: systemctl restart yougile-mcp
────────────────────────────────────────────────────────────
EOF
}

main "$@"
