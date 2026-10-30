# Gateway smoke verification (#52)

Real Anthropic key, tier `cheap` (`claude-haiku-5-5`), Workspace `getbauherr`, Ticket `getbauherr/bauherr#65`.

## Setup

```bash
docker compose up -d --build
# seed on the compose network; the key file is mounted, never printed
docker compose run --rm --no-deps -T \
  -v ~/.config/bauherr/anthropic-key:/run/anthropic-key:ro -e ANTHROPIC_API_KEY_FILE=/run/anthropic-key \
  -e BAUHERR_ADMIN_EMAIL -e BAUHERR_ADMIN_PASSWORD -e GITHUB_TOKEN app sh -c 'cd /repo/apps/server && pnpm seed'
```

Seeding on the network fires the gateway hooks (key, provider file, `llm.models`). Budget was set to 2 USD right after.

## Results

| Check | Result |
|---|---|
| Gateway ready (`:15021/healthz/ready` in network) | 200 |
| Workspace key `workspace-getbauherr` in `llm.apiKey`, allowed `ws-getbauherr/*`, budget | present, 2 USD / 30 d |
| Provider file `providers/ws-getbauherr.key` | 0600, root |
| Real Plan Run 3 | `needs_human`: 16 requests, 451 745 in (cache incl.), 10 851 out, gateway cost 0.1409 USD |
| `request_logs` | `cost` > 0, `gen_ai_request_model` = `gen_ai_response_model` = `claude-haiku-5-5`; `attributes_json` has run, stage, product, ticket, `agw.ai.original_model` = `ws-getbauherr/claude-haiku-5-5` |
| Catalog lookup on prefixed name | works: the `stripPrefix` transformation runs before pricing, rates applied (input/output/cacheRead/cacheWrite) |
| Budget 0.0001 USD | Run 4 `budget_exhausted` ("gateway budget exceeded"), Ticket comment "the Workspace budget is exhausted"; gateway warns `API key budget exceeded used=0.1409` |
| Rotation (`rotateKey`) | old key 401, new key 200; Run 5 after rotation `needs_human`, 11 requests, 7 646 out, 0.0835 USD |
| Suites | `pnpm -r test` green |

`needs_human` reason (Runs 3 and 5): the Run session has no tool to post a Comment, so the plan stayed in `.bauherr/plan-comment.md` and the Goal statement "a plan comment is posted" was unmet. The model and gateway path is proven; the `succeeded` path needs the forge comment tool (or Runner-posts-the-file).

## Fixes made here

- Runner proxy sent `x-api-key`; agentgateway `apiKey` auth only reads `Authorization: Bearer` (401 "no API Key found"). Proxy now sends Bearer and drops `x-api-key`.
- Image: no `git` (clone failed `spawn git ENOENT`), no `procps` (worker healthcheck), no `.dockerignore` (host `node_modules` broke the build), packages not built in the image.
- Production had no schema (`push` is dev only): initial migration + `prodMigrations`; worker waits for app health so only one process migrates.
- `maxBudgetUsd` per Run 1 -> 0.5.
- GitHub fetch now `cache: 'no-store'`.
- Seed accepts `ANTHROPIC_API_KEY_FILE`.

## Providers

A `llm-provider` Connection picks a preset (`apps/server/src/lib/providers.ts`). The secret is written to `/gateway/providers/ws-<slug>.<ext>` (0600) and referenced by path; saving the Connection verifies it with a 1-token call and stores `capabilities.verifiedAt` or `lastError`.

| Preset | Fields | Secret to paste | Model IDs / default tiers | Budget |
|---|---|---|---|---|
| `anthropic` | none | Anthropic API key | `claude-haiku-5-5` / `claude-sonnet-5-5` / `claude-opus-5-5` | USD |
| `greenpt` | none | GreenPT API key | `glm-5.3-flash` / `glm-5.3` / `kimi-k3` | USD |
| `bedrock` | `awsRegion` | Bedrock API key | e.g. `us.anthropic.claude-sonnet-5-5-v1:0`; set `modelByTier` | tokens |
| `vertex` | `vertexProject`, `vertexRegion` | service-account JSON | e.g. `claude-sonnet-5-5@20260101`; set `modelByTier` | tokens |
| `foundry` | `azureResource` | Foundry API key | Anthropic IDs | tokens |
| `anthropic-compatible` | `baseUrl` | key of the Messages endpoint (e.g. upstream agentgateway) | upstream names; set `modelByTier` | tokens |
| `openai-compatible` | `baseUrl` | key of the Chat Completions endpoint | upstream names; set `modelByTier` | tokens |

Presets without a USD catalog flip the Workspace to `budgetUnit: tokens` (`budgetTokens30d`, default 20M); otherwise calls are priced at 0 and the budget never trips. To add prices, drop a catalog file into `deploy/gateway/catalogs/` (compose `init` copies every `*.json`; `renderModels` lists them all in `modelCatalog`) and set `catalog: true` on the preset.

## Open

- In-app `poll-tickets` (Next process, autoRun) processed label changes late or not at all (minutes), while the same handler run via `tsx` saw them at once. Cause not found; smoke polls were triggered with the handler directly. Candidates: Next-patched fetch/job context.
- `runs.cost_estimate_usd` (0.0141 for Run 3) is about 10x below the gateway cost (0.1409); `gateway_cost_usd` stays null, `reconcile_status` pending. Estimate ignores cache tokens.
- Catalog rates for the 5.5 models are still the 4.5-generation placeholders; the observed cost is only as right as they are.
- Gateway warns `failed to flush budget usage: pool timed out` once under load; budget enforcement still worked.
- Admin login with the generated password via `/api/bauherren/login` returned "incorrect"; not investigated (seeded user exists).
- No Plan comment tool in the Run session (see above).
