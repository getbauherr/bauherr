> Superseded: the gateway Connection described here is replaced by the bundled gateway (#50). Kept as history.

# Walking skeleton smoke run

Chain: GitHub Ticket (sandbox repo) -> poll job -> `runs` row -> worker -> runner (clone, Agent SDK, credential proxy) -> stub gateway -> persisted Run + Ticket comment.

Prereqs: `docker compose up -d db` (Postgres on 127.0.0.1:54330), `apps/server/.dev-secrets` (PAYLOAD_SECRET, ENCRYPTION_KEY, DATABASE_URL), `gh` authenticated.

| # | Step (cwd `apps/server`) | Result |
|---|---|---|
| 1 | `pnpm install && pnpm build:packages` (root) | ok |
| 2 | `GITHUB_TOKEN=$(gh auth token) BAUHERR_SMOKE_REPO=getbauherr/sandbox GATEWAY_URL=http://127.0.0.1:4010 GATEWAY_KEY=stub BAUHERR_ADMIN_EMAIL=.. BAUHERR_ADMIN_PASSWORD=.. pnpm seed` | Product `sandbox` + ticket source `getbauherr/sandbox` |
| 3 | `gh label create bauherr:stage:plan -R getbauherr/sandbox`; `gh issue create -R getbauherr/sandbox -t "Skeleton smoke test" -b "## Acceptance criteria\n\n- a plan comment is posted" -l bauherr:stage:plan` | issue #72 |
| 4 | `JOBS_AUTORUN=0 pnpm exec payload jobs:run --queue poll --handle-schedules` | 1 job; `tickets` row (number 72, stage `plan`); `runs` row `queued` |
| 5 | `pnpm exec tsx scripts/stub-gateway.ts 4010 &` | stub gateway on 127.0.0.1:4010 |
| 6 | `JOBS_AUTORUN=0 pnpm exec payload jobs:run --queue runs` | Run -> `needs_human` |
| 7 | DB check | run 2: `needs_human`, tokens in/out 20/10, cost 0.00007 USD, 2 `steps`, 1 `tool_calls` |
| 8 | `gh issue view 72 -R getbauherr/sandbox --json comments` | comment "Bauherr needs a human: Unmet Goal statements after re-prompt: a plan comment is posted" |
| 9 | `gh issue close 72 -R getbauherr/sandbox` | closed |

## Outcome

`needs_human` is expected: the stub replies with text only and never edits `.bauherr/goal.json`, so the Stop hook blocks once, then ends the Run `needs_human` (same as the runner's own test). The server glue posts the reason as a Ticket comment.

Proved: GitHub poll via adapters, Ticket mapping (`id` -> `externalId`, `number`), stage label to Run, secrets decrypted in memory, real clone with the PAT, Agent SDK against the credential proxy (gateway key injected upstream), Step/ToolCall/usage persistence, status write-back, comment back to the Ticket.

Not proved: a real LLM writing the plan (needs a gateway consumer key), the `succeeded` path, the Build stage PR path, GitHub App auth.

Note: the poll task is scheduled; `--handle-schedules` enqueues it for the one-shot run.
