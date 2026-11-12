# The gateway

Every model call of the factory goes through one bundled gateway ([agentgateway](https://agentgateway.dev), image `cr.agentgateway.dev/agentgateway:v1.7.0`): the Runner and CI Runs, chat answers, and, when you set it up, your own coding sessions. The gateway counts tokens, prices them and enforces the budget. This is how Insights knows what a session cost, without the session having to report anything.

Set up a session in one step: Settings › AI usage › **Measure session cost**, or the **Agent team** page (pick a role: the connect block has the same lines). Both fill in your session name, role and addresses.

## What it measures, and what it does not

| Logged per call | Not logged |
|---|---|
| Time, status, model asked for and answered, input, output, cache read and cache write tokens, price | Prompts and answers (`accessLog.database.llm: metadata`; nothing switches this to `full`) |
| Which key made the call, its Workspace, the session name, role and coding tool (`user-agent`) from request headers | Your Claude login token, the provider key, the gateway key, any header |
| For Runner Runs: Run, stage, Product, Ticket | |

Request logs are deleted after 180 days (`BAUHERR_REQUEST_LOG_RETENTION_DAYS`).

## How a session is measured

1. You start the coding tool from a terminal (or an editor window) with the lines from the setup block. They send every model call to the gateway and add two headers: `x-bauherr-session: <session name>` and `x-bauherr-role: <role>`.
2. The gateway logs the headers with the key's Workspace.
3. Every minute the factory (`watch-gateway`) reads the new log rows and matches them:
   - The **key** decides the Workspace. The header only picks a session inside that Workspace, so a made-up name can never put cost into another Workspace.
   - The session name is the name your session passes to `connect` (`session`). The setup block uses one name for both, and the connect prompt contains it.
   - A call made while the session held a Run belongs to that Run (the Run's span, from claim to last call; a running Run holds its span open). A call between Runs belongs to the session without a Run.
   - A call with a name that matches no connected session, or with no name at all, is counted as "Unnamed gateway session". It is never lost.
4. Insights › Cost & tokens shows tokens and cost per session, model, role, stage and Ticket. The recompute covers the last two days and is idempotent: a rerun, a restart or a late log row never counts a call twice.

Cache tokens are split out of the input count (the gateway reports input including cache; Insights shows input, cache read and cache write separately and prices each at its own rate).

If you also run the [usage hook](cost.md#the-usage-hook), the gateway wins from the first gateway call of a session on: the hook's rows of that session are ignored.

### Which key, which payment route

- **Your own Claude subscription login** (`sub/*` and `claude-*`, Claude Code only): your tool keeps sending its login token; the gateway forwards it to Anthropic and never stores it. The calls are priced at list price so you can see the volume, but the Workspace pays nothing. Allowed only for the Workspace's session key (`kind: owner-session`) and only for your own unmodified Claude Code ([legal.md](legal.md#owner-session-passthrough)).
- **The Workspace's API key** (`ws-<workspace>/<connection>/<model>`): the gateway puts the Workspace's provider key on the call. The tools below use this route unless they say otherwise.

The session key is shown once under Settings › AI usage › Measure session cost ("Create a session key", Admin). Creating a new one replaces the old one: sessions that use the current key stop working until they get the new one. It has its own budget (`SESSION_BUDGET_USD`, default 100 per 30 days) that only warns.

## What the gateway proxies

| API | Path | Works for | Notes |
|---|---|---|---|
| Anthropic Messages | `/v1/messages`, streaming, tools, extended thinking, prompt caching | Anthropic, Bedrock, Vertex, Foundry and every Connection (converted when needed) | Logged with cache tokens. Checked live with streaming and non-streaming calls. |
| Anthropic token count | `/v1/messages/count_tokens` | Anthropic-type Connections | Passes through; logged without tokens (nothing to bill) |
| OpenAI Chat Completions | `/v1/chat/completions` | Every Connection | Converted to Messages for Anthropic. Checked live. |
| OpenAI Responses | `/v1/responses` | Only an **OpenAI** Connection (preset `openai`) | Refused for Anthropic upstreams: "unsupported conversion from Responses to provider anthropic". |
| Gemini | `/v1beta/models/<model>:generateContent` | A **Gemini** Connection (preset `gemini`) | The model name carries the gateway prefix `ws-<workspace>/<connection>/<model>`. Checked with a simulated upstream, not with the real Gemini CLI. |

Not proxied: realtime and audio APIs, and anything that logs in with a vendor subscription other than Claude Code's (see below).

A gateway key can arrive in `x-agw-key`, `x-api-key`, `x-goog-api-key` or `Authorization: Bearer`, whatever the tool's SDK uses; all four are removed before a call leaves for a provider, so a gateway key never reaches a provider.

## Setup per coding tool

Each tool's lines are generated for you in the UI; what follows is what they are based on. Facts below come from each tool's current official documentation (read 2026-11-12). Tools change quickly: if a line stops working, check the linked page for your installed version.

"Per session" means the tool can send the session name, so its cost shows up under that name. "Per key" means it cannot send a header: its calls are counted as "Unnamed gateway session".

| Tool | Measured | Pay with | How (details in the UI block) | Source |
|---|---|---|---|---|
| Claude Code (terminal, JetBrains terminal) | per session | own login, or Workspace key | `ANTHROPIC_BASE_URL`, and `ANTHROPIC_CUSTOM_HEADERS` (newline-separated, v2.1.227 and newer). With your own login set no `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` and put the gateway key in the header `x-agw-key`; with the Workspace key set `ANTHROPIC_AUTH_TOKEN` and the three `ANTHROPIC_DEFAULT_*_MODEL` to `ws-…` names. Verify with `/status`. | [llm-gateway-connect](https://code.claude.com/docs/en/llm-gateway-connect) |
| Claude Code in VS Code | per session, fixed per window | same | The same variables in the setting `claudeCode.environmentVariables`. | [vs-code](https://code.claude.com/docs/en/vs-code) |
| Claude Code in JetBrains | per session | same | The plugin runs `claude` in the IDE terminal: use the terminal lines. It has no setting for variables. | [jetbrains](https://code.claude.com/docs/en/jetbrains) |
| Claude Agent SDK | per session | Workspace key (Anthropic asks products built on the SDK to use API keys) | The same variables in the `env` option (TypeScript: spread `process.env` first, the option replaces the environment). | [llm-gateway-connect](https://code.claude.com/docs/en/llm-gateway-connect#agent-sdk) |
| Claude desktop app | per session | Workspace key | Ignores `ANTHROPIC_BASE_URL`. Help, Troubleshooting, Enable Developer Mode, Developer, Configure Third-Party Inference: gateway URL, key, header scheme Bearer, custom headers. Whether a subscription login can stay is not documented. | [claude-desktop gateway](https://claude.com/docs/third-party/claude-desktop/gateway) |
| OpenAI Codex CLI | per session | Workspace key (an OpenAI Connection) | `~/.codex/config.toml`: a `model_providers` entry with `base_url`, `wire_api = "responses"` and `env_http_headers`. A project-level file is ignored. Codex speaks only the Responses API, so it cannot reach Anthropic or Gemini models. Its ChatGPT login is not routed through the gateway. | [config reference](https://learn.chatgpt.com/docs/config-file/config-reference) |
| Gemini CLI | per key | Workspace key (a Gemini Connection) | `GOOGLE_GEMINI_BASE_URL` and `GEMINI_API_KEY`. A custom endpoint works only with an API key (no Google login) and no custom header is documented. | [configuration](https://geminicli.com/docs/reference/configuration/) |
| GitHub Copilot in VS Code (agent mode) | per session | Workspace key | Model provider "Custom Endpoint" in `chatLanguageModels.json` with `requestHeaders`. Models need tool calling; an organisation can switch bring-your-own-key off. | [language models](https://code.visualstudio.com/docs/copilot/customization/language-models) |
| GitHub Copilot CLI | per key | Workspace key | `~/.copilot/providers.json` with a base URL and bearer token; no header option is documented. | [BYOK](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models) |
| GitHub Copilot in JetBrains | not measurable | | Documents bring-your-own-key with an API key only, no endpoint headers. | [changelog](https://github.blog/changelog/2026-07-14-github-copilot-for-jetbrains-expands-byok-capabilities/) |
| Cursor | not measurable | | Sends model calls through Cursor's servers and documents no base URL override, so a gateway on your machine is out of reach. | [API keys](https://cursor.com/help/models-and-usage/api-keys) |
| opencode | per session | Workspace key | A provider with `baseURL` and `headers` in `~/.config/opencode/opencode.json`. The docs use two schemas (`providers.*.settings`, older `provider.*.options`): check yours. | [providers](https://opencode.ai/docs/providers/) |
| Aider | per session | Workspace key | `OPENAI_API_BASE`, `OPENAI_API_KEY`, and `extra_headers` in `.aider.model.settings.yml`. No MCP client, so it cannot connect to the factory. | [model settings](https://aider.chat/docs/config/adv-model-settings.html) |
| Cline, Roo Code | per key | Workspace key | Provider "OpenAI Compatible": base URL, key, model. No custom header for a personal install. | [Cline](https://docs.cline.bot/provider-config/openai-compatible) |

For tools that are not measurable through the gateway, the fallback is the [usage hook](cost.md#the-usage-hook) (Claude Code only) or the `usage` argument of the factory tools.

Adding the factory (MCP) differs per tool: the UI block has the exact command or file for each. Claude Code: `claude mcp add --transport http bauherr <factory>/mcp --header "Authorization: Bearer <agent key>"`.

**Check that it works:** after the first answer the session shows under Agent team (Idle, then Working), and within a few minutes Insights › Cost & tokens lists it under Session with tokens and cost.

There is no `bauherr session start` command: the CLI keeps no credentials, so a generated wrapper would have to ask for the key itself. The lines in the UI do that with `read -rs`, which keeps the key out of your shell history.

## Prices and models update themselves

The gateway prices a call from a model catalog: per model input, output, cache read and cache write rates. Once a day (`refresh-prices`, checked hourly, fetched once a day, retried hourly after a failure) Bauherr fetches the catalog that the agentgateway project itself publishes (`https://raw.githubusercontent.com/agentgateway/agentgateway/main/catalog/model-catalog.json`; `agentgateway.dev/model-catalog` redirects there, and redirects are refused, so the final address is the default; the same catalog the gateway UI's "Refresh base costs" uses), rewrites it to what the pinned gateway reads and writes `catalogs/base-costs.json`. The gateway watches that file and reloads it without a restart; the file is listed in the gateway config automatically.

The gateway can fetch this catalog itself (`POST /api/costs/refresh-base` on its admin port, the gateway UI's "Refresh base costs"), but on v1.7.0 that call fails on the published file: it answers HTTP 500 `decode model catalog from GitHub` (tested 2026-11-12), and the same file loaded by hand is refused with `unknown variant \`fast\`` for a price tier. So Bauherr keeps its own fetch and conversion, and `lib/cost.ts` reads the same `catalogs/` directory the gateway reads. The gateway has no setting for a catalog URL or refresh interval (`modelCatalog` takes only `file` and `inline`).

Guards, because a bad catalog would put wrong numbers on every page:

- One fixed host. A redirect is an error. At most 5 MB. Parsed as JSON and rewritten field by field; nothing from it is ever run.
- Rewritten to name, text rates (input, output, cache read, cache write, 1 h cache write) and the price tiers the pinned gateway understands. The published file already contains a tier value (`fast`) that v1.7.0 refuses as a whole file, so everything else is dropped.
- Refused, with the previous prices kept and the reason stored: fewer than 300 models, a loss of more than 30 % of the models, or any known input/output price moving by more than 10 times.
- Shipped fallback: `deploy/gateway/catalogs/` (a dated base catalog for the Anthropic models, plus GreenPT prices as an overlay). The gateway also has a built-in catalog.

Settings › Models & budget shows "Prices updated <time> from <source>, N models", the last error, **Update now** (Admin), and, when a refresh changed the price of a model your tiers or roles use, a line such as "Changed: claude-haiku-5-5 input 1 → 0.1, output 5 → 0.5". The first refresh is compared with the shipped prices, so a change from the shipped file to the published one is shown, not silent. The same refresh keeps the model lists of Settings › Models & budget and of the role model select current: non-deprecated models of the Connection's provider are offered; a model a tier or role already uses stays selectable and is marked "no longer in the price catalog" when it disappeared, and the choice itself is never changed.

Calls that had no price when they were logged (a new model) are priced as soon as the catalog knows the model: the unpriced count on Insights goes down by itself, at the catalog's list price.

Air-gapped installs: `BAUHERR_PRICES_REFRESH=0` switches the fetch off; the shipped files stay in use. `BAUHERR_PRICES_URL` pins another mirror (same format, one host, no redirects).

Where your own contracted prices go: a file in `/gateway/catalogs/` **without** a `metadata` block is an overlay and wins over the base (the way `greenpt.json` does).

## Where it listens

- Port 4000 is published on **loopback only** (`127.0.0.1:4000`): sessions on the same machine reach it, nothing else does.
- Sessions on another machine need a TLS proxy in front of port 4000 (your own Caddy, nginx or Traefik). Then set `GATEWAY_PUBLIC_URL=https://gateway.example.com` so the setup blocks show that address. Keys travel in headers: never expose port 4000 without TLS.
- Port 15000 (the gateway's admin API and UI) has **no sign-in** and is not published by default: only Bauherr reaches it inside the compose network. The opt-in `gateway-ui` profile forwards it on loopback only (see below).

### The gateway UI

The gateway has its own UI (analytics, request log, costs, keys). It is **off by default**. Port 15000 has no sign-in and can read and change gateway keys; while the UI is on, every program on this machine can reach it. It is published on `127.0.0.1` only, never on `0.0.0.0`.

To switch it on, put these two lines in the environment file next to `compose.yaml` (if `COMPOSE_PROFILES` is already set there, add `gateway-ui` to it with a comma) and run `docker compose up -d`:

```bash
COMPOSE_PROFILES=gateway-ui
GATEWAY_UI_URL=http://127.0.0.1:15000/ui/
```

The first line starts the `gateway-ui` service, a small forward (`alpine/socat`, pinned by digest) from `127.0.0.1:15000` to the gateway. The second makes **Open the gateway UI** in Settings › AI usage, Models & budget and the Insights notice (Admin) a working link; it shows only while the gateway runs. Remove both lines and run `docker compose up -d --remove-orphans` to switch it off again. While it is off the button is disabled and the page says how to switch it on.

It cannot be served through Bauherr's admin proxy: the UI loads its files and calls its API from the root of its own host (`/ui/assets/…`, `/api/…`), and the proxy's sandbox (an opaque origin, so that a script from the upstream cannot reach your Bauherr session) blocks those requests. The gateway's settings stay readable through the proxy, read-only, for an Admin: `/-/gateway/config_dump`.

## Never downgrade the gateway image

Version 1.7.0 migrates the request-log database to migration 3. An older image refuses to start on it ("migration 2 was previously applied but is missing") and crash-loops. Pin and move forward only; to go back, restore a database backup from before the upgrade. The v1.7.0 image is the newest stable release (checked 2026-11-12). Bauherr checks the database every minute: when the gateway does not answer and the database is newer than the image knows, Settings and the Insights notice say so in plain words.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The tool answers 401 `authentication failed` | The key is wrong, revoked or replaced. Create a new session key (Settings › AI usage › Measure session cost). With Claude Code and your own login, the key must be in `x-agw-key`, not in `ANTHROPIC_AUTH_TOKEN`. |
| 403 `model_not_allowed` | The key may not use that model: `sub/*` and `claude-*` need the session key, and Workspace models must start with `ws-<workspace>/`. |
| 400 `unsupported conversion from Responses` | The tool speaks the OpenAI Responses API but the model is not served by an OpenAI Connection. Add one (preset `openai`). |
| "Sessions show no cost" | The calls did not go through the gateway or carry another key. Check `echo $ANTHROPIC_BASE_URL` in the terminal that started the tool, and Claude Code's `/status`. Costs appear within about two minutes; check that the status on Settings › AI usage says "Gateway running". |
| Cost shows under "Unnamed gateway session" | The call had no `x-bauherr-session` header, or the name does not match the `session` of any connected session. Use the lines from the UI: the prompt and the headers carry the same name. |
| Tokens but no price | The model is not in the catalog yet. It is priced after the next daily refresh (or Update now). |
| "Gateway not reachable" | `docker compose logs gateway`. A database newer than the image: see "Never downgrade". |
| The prices page shows an error | The daily refresh refused or could not fetch the catalog; the previous prices are in use. The message says why. |
