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

Seed env: BAUHERR_ADMIN_EMAIL, BAUHERR_ADMIN_PASSWORD, GITHUB_TOKEN, GATEWAY_URL, GATEWAY_KEY.

Deviations / open:
- `tickets.updatedAt` named `sourceUpdatedAt` (Payload owns `updatedAt`).
- `jobs:run` is one-shot; worker script adds `--cron "*/5 * * * * *"` and `JOBS_AUTORUN=0`. App autoRuns only queue `poll` (`poll-tickets`, one job iterates all sources, every 60s).
- `db.push: true` (no migrations yet). Importmap is generated `.js`. No workspace cascade delete, no append-only access on steps/tool_calls, no stuck-job sweeper.
- First Bauherr created becomes `admin`; Admin = `userHasAccessToAllTenants`.
- `connections.secret`: single AES-256-GCM field, read access false; "set/not set" indicator missing.
- Dockerfile/compose app image untested end to end.
