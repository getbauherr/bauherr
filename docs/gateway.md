# The gateway

Every model call of the factory goes through one bundled gateway: [agentgateway](https://agentgateway.dev), image `cr.agentgateway.dev/agentgateway:v1.7.0`. That covers the Runner, CI Runs, chat answers and your own coding sessions. The gateway counts tokens, prices them and enforces the budget. Insights knows a session's cost without the session reporting anything.

Set up a session: Settings › AI usage › **Measure session cost**, or the **Agent team** page.

## What it measures, and what it does not

| Logged per call | Not logged |
|---|---|
| Time, status, models, input, output, cache read and cache write tokens, price | Prompts and answers (`accessLog.database.llm: metadata`, not switchable) |
| Key, Workspace, session name, role, coding tool from `user-agent` | Your Claude login token, the provider key, the gateway key, any header |
| Runner Runs: Run, stage, Product, Ticket | |

Request logs are deleted after 180 days. `BAUHERR_REQUEST_LOG_RETENTION_DAYS` changes that.

## How a session is measured

1. Start the coding tool with the lines from the setup block. They route every call to the gateway and add the headers `x-bauherr-session: <session name>` and `x-bauherr-role: <role>`.
2. The gateway logs them with the key's Workspace.
3. Every minute `watch-gateway` reads the new log rows and matches them:
   - The **key** decides the Workspace. The header only picks a session inside it.
   - The session name is the `session` your session passes to `connect`.
   - A call made while the session held a Run belongs to that Run. A call between Runs belongs to the session.
   - A call with an unknown or missing name counts as "Unnamed gateway session".
4. Insights › Cost & tokens shows cost per session, model, role, stage and Ticket. The recompute covers two days and never counts a call twice.

With the [usage hook](cost.md#the-usage-hook) also running, the gateway wins from a session's first gateway call on.

### Which key, which payment route

- **Your own Claude login**, models `sub/*` and `claude-*`, Claude Code only. The gateway forwards the tool's login token to Anthropic and never stores it. Calls are priced at list price; the Workspace pays nothing. Only the session key (`kind: owner-session`) and your own unmodified Claude Code may use it; see [legal.md](legal.md#owner-session-passthrough).
- **The Workspace's API key**, models `ws-<workspace>/<connection>/<model>`. The gateway adds the Workspace's provider key. All tools below use this route unless noted.

An Admin creates the session key under Settings › AI usage › Measure session cost. It is shown once, and a new key replaces the old one. Its budget `SESSION_BUDGET_USD` (default 100 per 30 days) only warns.

## What the gateway proxies

| API | Path | Works for |
|---|---|---|
| Anthropic Messages | `/v1/messages` | Every Connection; converted when needed |
| Anthropic token count | `/v1/messages/count_tokens` | Anthropic Connections |
| OpenAI Chat Completions | `/v1/chat/completions` | Every Connection; converted for Anthropic |
| OpenAI Responses | `/v1/responses` | Only an OpenAI Connection, preset `openai` |
| Gemini | `/v1beta/models/<model>:generateContent` | A Gemini Connection, preset `gemini`; the model carries the `ws-` prefix |

Not proxied: realtime and audio APIs, and vendor logins other than Claude Code's.

A gateway key may arrive in `x-agw-key`, `x-api-key`, `x-goog-api-key` or `Authorization: Bearer`. The gateway strips all four before calling a provider.

## Setup per coding tool

The UI generates each tool's lines from the official documentation read on 2026-11-12. If a line fails, check the linked page.

"Session" means the tool can send the session name. "Key" means it cannot, so its calls count as "Unnamed gateway session".

| Tool | Measured | How | Source |
|---|---|---|---|
| Claude Code, terminal and JetBrains | session | `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS`, v2.1.227 or newer. Own login: gateway key in header `x-agw-key`, no `ANTHROPIC_AUTH_TOKEN`. Workspace key: set `ANTHROPIC_AUTH_TOKEN` and the three `ANTHROPIC_DEFAULT_*_MODEL` to `ws-…` names. | [docs](https://code.claude.com/docs/en/llm-gateway-connect) |
| Claude Code in VS Code | session | The same variables in `claudeCode.environmentVariables`. | [docs](https://code.claude.com/docs/en/vs-code) |
| Claude Agent SDK | session | The same variables in the `env` option, after spreading `process.env`. Workspace key only. | [docs](https://code.claude.com/docs/en/llm-gateway-connect#agent-sdk) |
| Claude desktop app | session | Ignores `ANTHROPIC_BASE_URL`. Use Developer › Configure Third-Party Inference. Workspace key only. | [docs](https://claude.com/docs/third-party/claude-desktop/gateway) |
| OpenAI Codex CLI | session | `~/.codex/config.toml`: a `model_providers` entry with `base_url`, `wire_api = "responses"`, `env_http_headers`. OpenAI Connection only. | [docs](https://learn.chatgpt.com/docs/config-file/config-reference) |
| Gemini CLI | key | `GOOGLE_GEMINI_BASE_URL` and `GEMINI_API_KEY`. No custom header. | [docs](https://geminicli.com/docs/reference/configuration/) |
| GitHub Copilot in VS Code | session | Provider "Custom Endpoint" in `chatLanguageModels.json` with `requestHeaders`. | [docs](https://code.visualstudio.com/docs/copilot/customization/language-models) |
| GitHub Copilot CLI | key | `~/.copilot/providers.json` with base URL and bearer token. | [docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models) |
| opencode | session | A provider with `baseURL` and `headers` in `~/.config/opencode/opencode.json`. | [docs](https://opencode.ai/docs/providers/) |
| Aider | session | `OPENAI_API_BASE`, `OPENAI_API_KEY`, and `extra_headers` in `.aider.model.settings.yml`. | [docs](https://aider.chat/docs/config/adv-model-settings.html) |
| Cline, Roo Code | key | Provider "OpenAI Compatible": base URL, key, model. | [docs](https://docs.cline.bot/provider-config/openai-compatible) |

Not measurable: [GitHub Copilot in JetBrains](https://github.blog/changelog/2026-07-14-github-copilot-for-jetbrains-expands-byok-capabilities/) takes an API key only. [Cursor](https://cursor.com/help/models-and-usage/api-keys) routes through its own servers. Fall back to the [usage hook](cost.md#the-usage-hook) for Claude Code, or the `usage` argument of the factory tools.

The UI block shows how to add the factory as MCP server. For Claude Code:

```bash
claude mcp add --transport http bauherr <factory>/mcp --header "Authorization: Bearer <agent key>"
```

**Check that it works:** after the first answer the session shows under Agent team. Within minutes Insights › Cost & tokens lists it.

## Prices and models update themselves

The gateway prices a call from a model catalog with input, output, cache read and cache write rates. The `refresh-prices` job fetches the catalog from `https://raw.githubusercontent.com/agentgateway/agentgateway/main/catalog/model-catalog.json` once a day, retrying hourly after a failure. It rewrites it for the pinned gateway as `catalogs/base-costs.json`, which the gateway reloads without a restart.

The gateway's own "Refresh base costs" fails on v1.7.0: it refuses the price tier `fast`. So Bauherr keeps its own fetch, and `lib/cost.ts` reads the same `catalogs/` directory.

Guards against a bad catalog:

- One fixed host, no redirects, at most 5 MB. Rewritten field by field; nothing from it runs.
- Refused, previous prices kept, reason stored: fewer than 300 models, over 30 % of models lost, or a known price moving by more than 10 times.
- Fallback: `deploy/gateway/catalogs/` with a dated Anthropic catalog and GreenPT prices.

Settings › Models & budget shows the update time, the last error, **Update now** for Admins and price changes of models your tiers or roles use. The refresh also keeps the model selects current. A model in use stays selectable, marked "no longer in the price catalog". Calls logged without a price are priced once the catalog knows the model.

Air-gapped installs set `BAUHERR_PRICES_REFRESH=0`. `BAUHERR_PRICES_URL` pins a mirror.

For your own contracted prices, put a file without a `metadata` block in `/gateway/catalogs/`. It is an overlay and wins over the base, like `greenpt.json`.

## Where it listens

- The gateway is published on **loopback only**: `127.0.0.1:${GATEWAY_PORT:-4000}`. Change it with `GATEWAY_PORT` in the env file next to `compose.yaml`.
- `bauherr init --gateway-port <n>` (default 4000) refuses a port in use and writes `GATEWAY_PORT`. Re-running `init` keeps it.
- The setup blocks show `http://127.0.0.1:<GATEWAY_PORT>` unless `GATEWAY_PUBLIC_URL` is set.
- Sessions on another machine need a TLS proxy in front. Set `GATEWAY_PUBLIC_URL=https://gateway.example.com`. Never expose the port without TLS: keys travel in headers.
- Port 15000, the admin API and UI, has **no sign-in** and is not published. Only Bauherr reaches it.

### The gateway UI

The gateway UI shows analytics, request log, costs and keys. It is **off by default**: port 15000 can change gateway keys, and while it is on every program on this machine can reach it. It binds to `127.0.0.1` only.

To switch it on, add these lines to the env file and run `docker compose up -d`. If `COMPOSE_PROFILES` is set, append `gateway-ui` with a comma.

```bash
COMPOSE_PROFILES=gateway-ui
GATEWAY_UI_URL=http://127.0.0.1:15000/ui/
```

The first line starts a pinned `alpine/socat` forward. The second makes **Open the gateway UI** a working link. To switch it off, remove both lines and run `docker compose up -d --remove-orphans`.

Admins can read the gateway settings through Bauherr's proxy at `/-/gateway/config_dump`.

## Never downgrade the gateway image

Version 1.7.0 migrates the request-log database to migration 3. An older image crash-loops with "migration 2 was previously applied but is missing". Move forward only. To go back, restore a backup from before the upgrade. Settings and the Insights notice warn when the database is newer than the image.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| 401 `authentication failed` | Key wrong, revoked or replaced. Create a new session key. |
| 403 `model_not_allowed` | `sub/*` and `claude-*` need the session key. Workspace models must start with `ws-<workspace>/`. |
| 400 `unsupported conversion from Responses` | Add an OpenAI Connection, preset `openai`. |
| Sessions show no cost | Calls bypassed the gateway. Check `echo $ANTHROPIC_BASE_URL` and `/status`. Cost appears within two minutes. |
| "Unnamed gateway session" | No `x-bauherr-session` header, or the name matches no connected session. Use the UI lines. |
| Tokens but no price | The model is not in the catalog yet. Update now prices it. |
| "Gateway not reachable" | Run `docker compose logs gateway`. See "Never downgrade". |
