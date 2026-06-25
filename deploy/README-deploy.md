# Deploying the YouGile MCP server on an Ubuntu VPS

This runs one always-on HTTP endpoint you can connect to from any device. The
Node process binds to `127.0.0.1`; **Caddy** terminates TLS on port 443 and
reverse-proxies to it. Your existing VPN is untouched (different port, no
firewall changes are made by the script).

## Prerequisites

- An Ubuntu VPS with root/sudo.
- **A hostname that resolves to the server's public IP**, and ports **80 + 443
  reachable from the internet** (Caddy needs them to obtain a Let's Encrypt cert):
  - **Have a domain?** Add a DNS `A` record, e.g. `yougile.example.com → <IP>`.
  - **Only an IP?** Use a free `sslip.io` host: `203.0.113.7` → `203-0-113-7.sslip.io`
    (the deploy script can derive this automatically).
- A YouGile API key (`npm run get-key` on your laptop, or YouGile → Settings → API keys).

## One-command deploy

Copy this repo (or just the `deploy/` folder) to the VPS, or run from a clone:

```bash
# from a clone of the repo on the VPS:
sudo YOUGILE_API_KEY='<your-key>' \
     MCP_PUBLIC_HOST='yougile.example.com' \
     INSTALL_FROM_SOURCE=1 \
     deploy/deploy.sh
```

Or, once the package is on npm, without a clone:

```bash
sudo YOUGILE_API_KEY='<your-key>' MCP_PUBLIC_HOST='203-0-113-7.sslip.io' bash -c \
  "$(curl -fsSL https://raw.githubusercontent.com/OWNER/yougile-mcp-server/main/deploy/deploy.sh)"
```

The script will:

1. Install Node 20 LTS and Caddy (if missing).
2. Install `yougile-mcp-server` (from npm, or from source with `INSTALL_FROM_SOURCE=1`).
3. Generate `MCP_AUTH_TOKEN` if you didn't supply one.
4. Write `/etc/yougile-mcp.env` (chmod 600), a `yougile-mcp.service` systemd unit, and `/etc/caddy/Caddyfile`.
5. Start everything and print your **URL + auth token + ready-to-paste client config**.

## Connect a client

Use the printed config (Claude Desktop `claude_desktop_config.json` / Cursor `mcp.json`):

```json
{
  "mcpServers": {
    "yougile-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<MCP_PUBLIC_HOST>/mcp",
               "--header", "Authorization: Bearer <MCP_AUTH_TOKEN>"]
    }
  }
}
```

## Operate

```bash
systemctl status yougile-mcp        # service state
journalctl -u yougile-mcp -f        # live logs
systemctl restart yougile-mcp       # restart (e.g. after editing /etc/yougile-mcp.env)
curl https://<MCP_PUBLIC_HOST>/healthz   # should return {"status":"ok",...}
```

To update: `sudo npm install -g yougile-mcp-server && systemctl restart yougile-mcp`
(or re-run the deploy script with `INSTALL_FROM_SOURCE=1`).

## Security notes

- The endpoint requires `Authorization: Bearer <MCP_AUTH_TOKEN>`; rotate it by editing
  `/etc/yougile-mcp.env` and restarting.
- The YouGile API key lives only in `/etc/yougile-mcp.env` (chmod 600) — never in client config.
- The app listens on `127.0.0.1` only; nothing but Caddy can reach it.
- Optional hardening: restrict `/mcp` to your VPN subnet, or put Caddy behind your VPN
  interface. A firewall is **not** configured automatically to avoid disrupting your VPN —
  if you add `ufw`, remember to allow your VPN and SSH ports plus 80/443.
