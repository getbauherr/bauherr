# Contributing

Contributions are licensed under Apache-2.0 (Section 5: inbound = outbound). No CLA, no sign-off.

Open an issue before large changes. Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.

State guards never use `payload.update` with `where` (find-then-update, not atomic). Use one conditional `UPDATE ... RETURNING`, via `cas()` for Tickets, and act only on a returned row. `apps/server/tests/state-guards.test.ts` enforces it.

AI chat UIs use [assistant-ui](https://www.assistant-ui.com/elements/) (`@assistant-ui/react`, an approved dependency) as much as possible; see the Chat pattern in [docs/design/README.md](docs/design/README.md).

Adding a migration = adding one file `apps/server/src/migrations/YYYYMMDD_HHMMSS_slug.ts`. Never edit `index.ts`: it is generated (git-ignored) by `pnpm --filter server gen:migrations`, which `dev`, `build`, `test` and `typecheck` run first (run it yourself before a bare `payload migrate`). Migrations run in file-name order. New job task slugs need no migration: `syncJobEnums` adds them to the Postgres enums on startup.

An e2e spec (`apps/server/e2e/*.spec.ts`) must pass alone on a freshly seeded DB and in any order: it never relies on what another spec leaves behind. Give it its own data in `apps/server/scripts/seed-e2e.ts` (its own Tickets, and a Workspace of its own when it changes Workspace-wide settings), never mutate a seeded Ticket another spec reads, and filter assertions down to your own rows. A forge-backed Ticket needs its twin in `apps/server/src/lib/fake-forge.ts` under the same number. The `e2e-fake` job runs 3 workers and `retries: 1` (`E2E_WORKERS`, `E2E_RETRIES`; both default to 1 worker and no retry locally): a test that passes on retry is reported as flaky, so fix it or file it, never ignore it. The burn-in of changed specs runs 3 workers without retries. Check with `apps/server/scripts/e2e-isolation.sh` (the env of the CI `e2e-fake` job, after a `BAUHERR_TEST_BUILD=1` build).
