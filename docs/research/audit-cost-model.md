# Audit and cost model, gateway attribution

Ticket: getbauherr/bauherr#18. Builds on `runner-execution-model.md` section 6 (SDK usage per Step; not repeated).
Tags: [config] = read in `/home/sbuckpesch/projects/einsfuenf.de/ai-gateway`; [docs] = agentgateway.dev page read;
[unknown] = not found, needs a probe. Docs base: `https://agentgateway.dev/docs/standalone/latest/documentation/`.

## 1. What agentgateway exposes

| Fact | Status | Evidence |
|---|---|---|
| Token metric `agentgateway_gen_ai_client_token_usage`, labels `gen_ai_token_type` (input/output), `gen_ai_operation_name`, `gen_ai_system`, `gen_ai_request_model`, `gen_ai_response_model` | docs | `llm/observability/` |
| Cost: CEL `llm.cost`, log field `agw.ai.usage.cost.total`; needs `config.modelCatalog` (USD only for priced models). Counter `agentgateway_cost_catalog_lookups_total{status=Exact\|Unpriced\|Missing\|NoCatalog}` flags unpriced calls | docs + config | `llm/observability/`; `config/config.yaml` has `modelCatalog` (base-costs.json, 972 models) |
| Token CEL fields: `llm.inputTokens` (already includes cache), `llm.cachedInputTokens`, `llm.cacheCreationInputTokens`, `llm.providerInputTokens` | docs | same |
| Request-header to field: `frontendPolicies.accessLog.add: {run: 'request.headers["x-bauherr-run"]'}`; same `add` under `accessLog.otlp.fields` and `accessLog.database` | docs | `observability/access-logs/view/`, `.../export/`, `.../database/` |
| DB request log (SQLite or Postgres via `postgres://` URL): table `request_logs` (LLM traffic only), columns incl. cost, tokens, cache read/creation, status, error, model, trace id; custom fields in `attributes_json` | docs | `observability/access-logs/database/`. Retention: none documented |
| Metric label from key metadata: `config.metrics.fields.add: {user_id: apiKey.user}`; warned high cardinality | docs | `llm/api-keys/` |
| Metric label from a request header | unknown | only `apiKey.*` shown for metrics; headers shown only for logs |
| Native `/v1/messages` is a first-class (native) Anthropic format | docs | `llm/about/` |
| Native `/v1/messages` streaming usage (incl. cache tokens) parsed | unknown. README for the local gateway says "one line per LLM call ... tokens" and the Messages path is in daily use [config], but no doc statement and no evidence for streamed calls with cost non-null | needs probe (section 7) |
| Per-key budgets: `llm.policies.apiKey.keys[].budgets[]` `{name, limit:{unit: USD\|Tokens, amount}, window:{rolling: 24h\|30d}, onBudgetExceeded: Block\|Audit}`; key needs `metadata.name`; needs `config.database.url`; `usd` only charges priced models | docs | `llm/cost-controls/budget-limits/per-key/` |
| Exhaustion: HTTP **429**, body `{"error":{"message":"budget exceeded","type":"rate_limit_error","code":"budget_exceeded"}}`; rejected request not charged; the crossing request is charged after completion (overshoot possible); `Audit` never rejects | docs | same page |
| Key name logged as `agw.api_key.name`; `agctl standalone analytics --by agentgateway.user` | docs | `llm/api-keys/` |
| OTLP: traces `frontendPolicies.tracing {host, protocol: grpc}`; logs `frontendPolicies.accessLog.otlp {host, filter, fields}` | docs | `observability/traces/`, `.../access-logs/export/` |

Local deployment [config]: `agentgateway:v1.5.0`, **no `llm.policies.apiKey`** (README "Known limits" 2: no inbound auth), no budgets, `config.database` = SQLite
`/data/data.db`, no tracing/OTLP, Prometheus only scrapes the vLLM router, not the gateway. So everything Bauherr needs (consumer keys, budgets, header
fields) is documented but not deployed here. The production gateway (`ai.einsfuenf.de`, services repo) was not read. The docs page is "latest"; whether
every field exists in v1.5.0 is unknown.

Budget-exhaustion mapping for the runner: 429 with `code: budget_exceeded` must map to Run status `budget_exhausted` (not retried like a rate limit).
The SDK/CLI retries 429 by default [unknown for this code path]; the worker should treat the gateway error body as terminal.

## 2. Attribution

Decided: one consumer key per Workspace (carries the budget, `metadata.name = workspace-<slug>`). Finer levels without more keys:

| Option | Run | Product | Verdict |
|---|---|---|---|
| Header to access log (`add`) | yes | yes | Use. Free-form, high cardinality is fine in logs/DB |
| Header to metric label | unknown | unknown | Not for Run (cardinality). Product maybe, after probe |
| Key metadata (`group`, etc.) | no | per key only | Static; use for Workspace id/tier only |
| Separate route per Product | no | yes | Reject: route/model config per Product, no gain over header |
| One key per Run | yes | yes | Reject: key lifecycle churn, budget fragmentation |

Recommendation: headers on every gateway call from the Run process: `X-Bauherr-Run: <run uuid>`, `X-Bauherr-Product`, `X-Bauherr-Ticket`,
`X-Bauherr-Stage`, `X-Bauherr-Step` is not possible (Step is a response-side concept; join by time/model instead). Intake sessions send
`X-Bauherr-Intake: <session id>` and `X-Bauherr-Product` with no Run header (cost attributes to the Product, per #11). Set via the CLI custom-header env
(`ANTHROPIC_CUSTOM_HEADERS`) on the spawned process [unknown: confirm the SDK-bundled CLI honours it; fallback is a thin local proxy that injects headers].
Workspace comes from the key, not a header, so a Run cannot claim another Workspace's spend by lying in a header. Headers are advisory for Product/Run;
the key is the trust boundary.

Config to deploy (documented shapes):
```yaml
config: { database: { url: postgres://... } }   # budgets + request_logs
frontendPolicies:
  accessLog:
    database:
      add:
        run: 'request.headers["x-bauherr-run"]'
        product: 'request.headers["x-bauherr-product"]'
        ticket: 'request.headers["x-bauherr-ticket"]'
        stage: 'request.headers["x-bauherr-stage"]'
```

## 3. Postgres shape

Bauherr is the system of record for Runs/Steps; Tickets stay in the Ticket source (pointer only, per CONTEXT.md). Payload collections:

`runs` (one row per Run; mutable status, immutable identity):
`id`, `workspace`, `product`, `ticket_ref` (forge, repo, number, url), `stage`, `agent`, `model`, `skill_versions` (jsonb `{name: version}`),
`status` (queued, running, succeeded, failed, cancelled, budget_exhausted), `error` (code, message), `started_at`, `finished_at`, `num_turns`,
`tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write` (rollups from steps), `cost_estimate_usd` (SDK list price, `costBasis`),
`gateway_cost_usd` (nullable, reconciled), `cost_source` (`sdk-estimate` | `gateway`), `reconcile_status` (pending, matched, mismatch, unavailable),
`artifacts` (jsonb: MR url, commit sha, branch), `human_touches` (int rollup), `parent_run` (Sub-ticket Runs, optional).

`steps` (append-only; one per assistant `message.id`): `id`, `run`, `seq`, `message_id`, `model`, `tokens_in`, `tokens_cache_read`,
`tokens_cache_write`, `tokens_out` (placeholder until reconciled), `tokens_out_exact` (bool), `cost_estimate_usd`, `gateway_request_id` (nullable),
`started_at`, `finished_at`, `subagent_id` (nullable).

`tool_calls` (append-only; child of Step, kept separate so a Step with parallel calls is not a jsonb blob): `id`, `step`, `tool_use_id`, `name`,
`input_digest` (hash + redacted preview, not raw input), `status` (ok, error, denied), `duration_ms`, `denied_reason`.

`human_touches` (append-only): `id`, `ticket_ref`, `run` (nullable), `kind` (gate_approval, comment, reassign, manual_commit, retry), `actor`, `at`.
Derived from Ticket-source events + Bauherr gate actions; `runs.human_touches` is a rollup.

`intake_sessions`: `id`, `product`, `started_at`, `ended_at`, `outcome` (ticket_created, abandoned), `ticket_ref`, token + cost fields as in `runs`.

`cost_reconciliations` (append-only): `id`, `run`, `checked_at`, `gateway_cost_usd`, `sdk_cost_usd`, `delta_pct`, `gateway_rows` (count), `verdict`.

Mutable vs append-only: `steps`, `tool_calls`, `human_touches`, `cost_reconciliations` are insert-only (enforce with no update/delete access
in Payload plus a DB trigger or revoked privileges for the app role). `runs` is mutable only in status/rollup/reconcile columns; each status
transition also inserts a `run_events` row (`run`, `from`, `to`, `at`, `reason`) so history is recoverable without trusting the mutable row.

Retention: v0.1 keeps everything (volume: tens of Steps per Run; negligible). Never store raw prompts/tool inputs/outputs in these tables; the
transcript, if kept at all, goes to object storage with its own shorter retention (suggest 90 days) and a Workspace-delete cascade. Deleting a
Workspace deletes its rows (Workspace is the isolation boundary); audit rows are not shared across Workspaces. Gateway `request_logs`: no retention
built in, so a scheduled prune (e.g. 180 days) must be owned by Bauherr ops.

## 4. Reconciliation

Join key: `request_logs.attributes_json.run` = `runs.id` (header). Sum `cost`, tokens per run id, per key.
1. On Run finish, and again after a delay (e.g. 5 min; gateway write lag [unknown]), a job reads the gateway (Postgres `request_logs` directly if
   shared, else the admin/analytics API [unknown]) and writes `gateway_cost_usd`, `cost_source = gateway`, one `cost_reconciliations` row.
2. Per-Step exactness: if the log has per-request rows, match to Steps by `(run, model, started_at order)` and fill `tokens_out` and
   `gateway_request_id`. Response id match is not available [unknown]; do not rely on it.
3. Verdict: `matched` if `|gateway - sdk| / gateway <= 10%` (list-price vs catalog price and cache accounting differ slightly); else `mismatch`.
4. Mismatch: gateway wins for money (it enforces the budget), SDK values stay for per-Step shape; flag in the dashboard, never silently overwrite.
   Common causes to check: unpriced model (`cost_catalog_lookups_total{status!="Exact"}`), cache tokens double-counted (do not add
   `cachedInputTokens` to `llm.inputTokens`), Opus/Sonnet pricing drift, subagent usage missing from SDK `usage`.
5. No gateway rows for a Run id: `reconcile_status = unavailable`, keep `cost_source = sdk-estimate`, alert if it affects more than a few percent of Runs
   (header lost, wrong route, or key not on the gateway).
6. Weekly: key-level total from the gateway vs sum of Run + Intake costs per Workspace; the residual is untagged spend (should be about zero).

## 5. Dashboard widgets (Payload admin, v0.1 minimal)

All are SQL over `runs`/`steps`/`human_touches`; no new infra.
1. Cost per Workspace over time (daily), `gateway_cost_usd` else `cost_estimate_usd`, with estimate/gateway split visible.
2. Cost per Product and per Ticket (top 20) plus per stage (stacked bar).
3. Tokens per Run (in, out, cache read) with median and p90 by stage.
4. Run failure rate by stage and by status (failed, cancelled, budget_exhausted) over time.
5. Human touches per Ticket (from retrospective self-telemetry), next to tokens and wall-clock (`finished_at - started_at` summed) per Ticket.
6. Budget gauge per Workspace key (used vs limit, window reset) and reconcile mismatch count.
Defer: per-tool-call latency, model comparison, cost forecasting, per-skill-version cost.

## 6. OTel / Loki

Already shipping [config]: nothing from the gateway. The local gateway has no tracing, no OTLP logs, and Prometheus does not scrape it (only the vLLM
router, whose OTLP goes to Jaeger). Server-side Loki labels per `reference_grafana_loki.md` are `service`, `stack`, `env`, `host`, `container`
(Alloy from Docker stdout), so the gateway's stdout log line (one per LLM call) would arrive in Loki once the container runs on the prod host, but custom
`add` fields only appear if enabled for stdout too [docs: the `database.add` variant applies to DB only; stdout variant is `accessLog.add`].

Bauherr could add later: one OTel trace per Run (root span), child spans per Step and tool call, with `bauherr.run_id` propagated via `traceparent`
so gateway spans (tracing config, gen_ai attributes) join the same trace. Value: latency waterfall, Grafana Tempo/Jaeger drill-down. Cost: collector,
sampling, attribute hygiene.

Recommendation v0.1: Postgres only (section 3) plus gateway `request_logs` with header fields. OTel after v0.1; no schema change needed since
`runs.id` is already the correlation id.

## 7. Open risks and probes

1. Native `/v1/messages` streaming usage parsing and non-null cost: probe with one streamed call through a priced model; check `request_logs` row (tokens,
   cache columns, cost). Blocks the reconciliation design if cost is NULL.
2. `ANTHROPIC_CUSTOM_HEADERS` honoured by the SDK-bundled CLI: probe; else header-injecting proxy.
3. Header reaching `request_logs.attributes_json`: probe `database.add`.
4. v1.5.0 vs "latest" docs drift for `apiKey` budgets; production gateway config unread.
5. `apiKey` strict mode vs `sub/*` OAuth forwarding (README limit 2): irrelevant for Bauherr (uses API-key legs) but affects shared gateway sharing.
6. Budget overshoot: the crossing request is still charged; set budget below real hard limit.
7. Header-based Product/Run attribution is client-asserted; only Workspace (key) is trustworthy.
8. `request_logs` has no retention; Bauherr must prune.
9. `Block` 429 may be retried by the client; map `budget_exceeded` to terminal.
