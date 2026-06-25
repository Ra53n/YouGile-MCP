# yougile-mcp-server

An [MCP](https://modelcontextprotocol.io) server for **[YouGile](https://yougile.com)**.
Connect an AI agent (Claude Desktop, Cursor, or any MCP client) to your YouGile
boards and tasks — browse projects/boards/columns, read and create/update/move/
complete/archive tasks, comment, and tag with stickers.

- **Read + safe writes** — the strongest mutation is *archive* (reversible). There are
  **no hard-delete tools**.
- **Two transports in one codebase** — `stdio` (local) and Streamable **HTTP** (remote, e.g. on your VPS).
- **Secrets stay in the environment** — your YouGile API key is read from `YOUGILE_API_KEY`, never hard-coded.

---

## Quick start (local, recommended)

You don't need to clone anything — once published, the server runs via `npx`.

### 1. Get a YouGile API key

```bash
npx yougile-mcp-server   # (after install) — or, from a clone:
npm run get-key
```

`get-key` asks for your YouGile login + password (sent only to YouGile, never
stored), lists your companies, creates an API key, and prints ready-to-paste
config. You can also create a key manually in **YouGile → Settings → API keys**.

### 2. Add it to your MCP client

**Claude Desktop** — `claude_desktop_config.json`
(`~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "yougile": {
      "command": "npx",
      "args": ["-y", "yougile-mcp-server"],
      "env": {
        "YOUGILE_API_KEY": "<your-key>",
        "YOUGILE_BASE_URL": "https://ru.yougile.com/api-v2"
      }
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json` (or project `.cursor/mcp.json`): same `mcpServers` block.

Restart the client; the `yougile_*` tools appear.

---

## Tools

| Group | Tools |
| --- | --- |
| Projects | `yougile_list_projects`, `yougile_get_project`, `yougile_create_project`, `yougile_update_project` |
| Boards | `yougile_list_boards`, `yougile_get_board`, `yougile_create_board`, `yougile_update_board` |
| Columns | `yougile_list_columns`, `yougile_get_column`, `yougile_create_column`, `yougile_update_column` |
| Tasks | `yougile_list_tasks`, `yougile_get_task`, `yougile_create_task`, `yougile_update_task`, `yougile_move_task`, `yougile_complete_task`, `yougile_archive_task` |
| Comments | `yougile_get_task_comments`, `yougile_add_task_comment` |
| Users | `yougile_list_users`, `yougile_get_user` |
| Stickers | `yougile_list_string_stickers`, `yougile_list_sprint_stickers`, `yougile_get_string_sticker`, `yougile_create_string_sticker`, `yougile_set_task_stickers` |
| Workflow | `yougile_board_summary`, `yougile_my_tasks`, `yougile_overdue_tasks` |

Every list tool supports `limit`, `offset`, and `response_format` (`markdown` | `json`).
Typical flow: `list_projects` → `list_boards` → `list_columns` → `list_tasks` → act.

---

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `YOUGILE_API_KEY` | yes | — | Bearer key. Get it with `npm run get-key`. |
| `YOUGILE_BASE_URL` | no | `https://ru.yougile.com/api-v2` | Region host. |
| `YOUGILE_USER_ID` | no | — | Enables `my_tasks` / `overdue_tasks` "me" (find via `yougile_list_users`). |
| `TRANSPORT` | no | `stdio` | `stdio` (local) or `http` (remote). |
| `PORT` | http only | `3000` | Bound to `127.0.0.1`. |
| `MCP_AUTH_TOKEN` | http only | — | Bearer token clients must send. `openssl rand -hex 32`. |
| `MCP_PUBLIC_HOST` | http (recommended) | — | Public hostname; enables DNS-rebinding protection. |

---

## Remote deployment (your VPS)

Run one always-on HTTPS endpoint and connect from anywhere. The Node process
binds to localhost; Caddy provides automatic TLS. See **[deploy/README-deploy.md](deploy/README-deploy.md)**.

In short, on the VPS:

```bash
sudo YOUGILE_API_KEY='<key>' MCP_PUBLIC_HOST='yougile.example.com' INSTALL_FROM_SOURCE=1 deploy/deploy.sh
```

Then point clients at it through the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge
(works in Claude Desktop and Cursor):

```json
{
  "mcpServers": {
    "yougile-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://yougile.example.com/mcp",
               "--header", "Authorization: Bearer <MCP_AUTH_TOKEN>"]
    }
  }
}
```

Cursor can also connect to a remote MCP by URL + header directly.

---

## Development

```bash
npm install
npm run build           # compile TypeScript → dist/
npm run inspect         # build + open the MCP Inspector against the server
npm run get-key         # obtain an API key interactively

# run locally
YOUGILE_API_KEY=... node dist/index.js                      # stdio
TRANSPORT=http MCP_AUTH_TOKEN=secret YOUGILE_API_KEY=... node dist/index.js   # http on :3000
```

### Publishing to npm

```bash
npm login
npm publish            # runs build via prepublishOnly; publishes publicly
```

Or push a `vX.Y.Z` tag to trigger `.github/workflows/publish.yml` (needs an `NPM_TOKEN` secret).

---

## Notes & limitations

- YouGile rate-limits ~50 requests/minute per company; the client retries 429s with backoff.
- `stickers` on a task is a map `{ stickerId: stateId }`; `yougile_set_task_stickers` merges into
  the existing map (it never drops other stickers) and detaches with the `"-"` sentinel.
- Deadlines/dates are millisecond epoch timestamps.
- `board_summary` fans out one request per column — heavy boards may approach the rate limit.

## License

MIT — see [LICENSE](LICENSE).
