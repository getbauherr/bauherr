# Contributing

Contributions are licensed under Apache-2.0 (Section 5: inbound = outbound). No CLA, no sign-off.

Open an issue before large changes. Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.

State guards never use `payload.update` with `where` (find-then-update, not atomic). Use one conditional `UPDATE ... RETURNING`, via `cas()` for Tickets, and act only on a returned row. `apps/server/tests/state-guards.test.ts` enforces it.

AI chat UIs use [assistant-ui](https://www.assistant-ui.com/elements/) (`@assistant-ui/react`, an approved dependency) as much as possible; see the Chat pattern in [docs/design/README.md](docs/design/README.md).

Adding a migration = adding one file `apps/server/src/migrations/YYYYMMDD_HHMMSS_slug.ts`. Never edit `index.ts`: it is generated (git-ignored) by `pnpm --filter server gen:migrations`, which `dev`, `build`, `test` and `typecheck` run first (run it yourself before a bare `payload migrate`). Migrations run in file-name order. New job task slugs need no migration: `syncJobEnums` adds them to the Postgres enums on startup.

An e2e spec (`apps/server/e2e/*.spec.ts`) must pass alone on a freshly seeded DB and in any order: it never relies on what another spec leaves behind. Give it its own data in `apps/server/scripts/seed-e2e.ts` (its own Tickets, and a Workspace of its own when it changes Workspace-wide settings), never mutate a seeded Ticket another spec reads, and filter assertions down to your own rows. A forge-backed Ticket needs its twin in `apps/server/src/lib/fake-forge.ts` under the same number. A spec that signs out signs in as a user of its own (`signout-*@example.com` in the seed): a sign-out ends every session of that user, which would log the other workers out. The `e2e-fake` job runs 3 workers and `retries: 1` (`E2E_WORKERS`, `E2E_RETRIES`; both default to 1 worker and no retry locally): a test that passes on retry is reported as flaky, so fix it or file it, never ignore it. The burn-in of changed specs runs 3 workers without retries. Check with `apps/server/scripts/e2e-isolation.sh` (the env of the CI `e2e-fake` job, after a `BAUHERR_TEST_BUILD=1` build).

## Regenerate README screenshots

`apps/server/e2e/screenshots.spec.ts` writes the PNGs of the README to `docs/assets/` (1440x900, 2x). It is skipped unless `SCREENSHOTS=1`. It needs a freshly seeded e2e database (`pnpm seed:e2e`) and a server started the way the `e2e-fake` CI job does it (`BAUHERR_E2E_FAKE_FORGE=1`, `CHAT_FAKE=1`, `INTAKE_FAKE=1`, `BAUHERR_PACK_DIR=apps/server/tests/fixtures/gated-pack`). The spec renames the seeded rows to the names of a small product in that database only, so give it a database of its own. From `apps/server`, with Playwright's Docker image like the other e2e specs:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --add-host=host.docker.internal:host-gateway \
  -v "$PWD/../..:/work" -v "$E2E_PASSWORD_FILE:/pw:ro" -w /work/apps/server \
  -e BASE_URL=http://host.docker.internal:3000 -e E2E_EMAIL=e2e@example.com -e E2E_PASSWORD_FILE=/pw \
  -e SCREENSHOTS=1 -e DATABASE_URL=postgres://bauherr:bauherr@host.docker.internal:54330/<screenshot db> \
  mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test e2e/screenshots.spec.ts
```

Look at every PNG before you commit it. The banner (`docs/assets/banner*.svg`) is hand-written SVG.

