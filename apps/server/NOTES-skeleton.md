# Skeleton notes (lane A)

Dev env: `apps/server/.dev-secrets` (gitignored; PAYLOAD_SECRET, ENCRYPTION_KEY, DATABASE_URL) -> `set -a; . ./.dev-secrets; set +a`.
Local temp stubs of `@bauherr/{adapters,runner}` were used for verification and removed; `pnpm install` needs the real packages (workspace:*).

| Command (cwd apps/server) | Result |
|---|---|
| `docker compose -f ../../compose.yaml up -d db` | `bauherr-db` on 127.0.0.1:54330 |
| `pnpm install` (with stub packages) | ok |
| `pnpm typecheck` | clean |
| `pnpm test` | 1 passed (isolation, DB `bauherr_test`) |
| `pnpm seed` | workspace `getbauherr`, 2 connections, product, source, workflow v1; idempotent |
| `pnpm dev` + curl `/admin` | 200 |
| `pnpm jobs` (worker, cron every 5s) + stub adapters/runner | poll created ticket + run; worker ran it: succeeded, 1 step, 1 tool_call; no duplicate run on later polls |
| `pnpm build` | ok; `docker compose config -q` ok (image not built) |

Seed env: BAUHERR_ADMIN_EMAIL, BAUHERR_ADMIN_PASSWORD, GITHUB_TOKEN, ANTHROPIC_API_KEY (-> `llm-provider` Connection, `config.provider: anthropic`).

## Gateway (agentgateway v1.6.0 sidecar)

- Compose: `gateway` (`:4000` on 127.0.0.1 only; admin API `:15000` unauthenticated, Docker-internal, never publish), volume `bauherr-gateway` (`config.yaml`, `catalog.json`, `providers/ws-<slug>.key`; app/worker rw, gateway ro), database `gateway` (`deploy/db-init.sql`, first DB init only). `init` renders `/gateway/config.yaml` from `deploy/gateway/config.yaml.tmpl` if missing; delete it from the volume to re-render. `OTEL_ENABLED=1` renders `tracing.otlpEndpoint: http://jaeger:4317`.
- Control plane `src/lib/gateway.ts`: keys via admin API (`PUT /api/config/resources/llm.apiKey` with `{"resources":[{"value":{...}}]}` creates, `PUT .../{id}` with `{"value":{...}}` updates, `DELETE .../{id}`; POST is 405); models via the rendered `llm.models` block (`ws-<slug>/*`, key file, `stripPrefix`), hot-reloaded. Hooks are no-ops when `GATEWAY_ADMIN_URL` is unset.
- Workspace: `gatewayKey` (generated on create, write-only, encrypted), `budgetUsd30d` (default 50), `modelByTier`. Run without an `llm-provider` Connection fails with `no LLM provider connected`.
- `budgetStatus(slug)` sums `request_logs.cost` for `workspace-<slug>` over 30 d (60 s cache); the gateway's own accounting is `budget_usage`.
- Gateway image is distroless (no shell/wget): no compose healthcheck; app/worker wait on `service_started`, `gateway.ts` retries. Gateway runs as root because provider files are 0600 root.
- Catalog rates for the 5.5 models are placeholders copied from the 4.5 generation; verify in G3.

Deviations / open:
- `tickets.updatedAt` named `sourceUpdatedAt` (Payload owns `updatedAt`).
- `jobs:run` is one-shot; worker script adds `--cron "*/5 * * * * *"` and `JOBS_AUTORUN=0`. App autoRuns only queue `poll` (`poll-tickets`, one job iterates all sources, every 60s).
- `db.push: true` (no migrations yet). Importmap is generated `.js`. No workspace cascade delete, no append-only access on steps/tool_calls, no stuck-job sweeper.
- First Bauherr created becomes `admin`; Admin = `userHasAccessToAllTenants`.
- `connections.secret`: single AES-256-GCM field, read access false; "set/not set" indicator missing.
- Dockerfile/compose app image untested end to end.
