# Contributing

Contributions are licensed under Apache-2.0 (Section 5: inbound = outbound). No CLA, no sign-off.

Open an issue before large changes. Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.

State guards never use `payload.update` with `where` (find-then-update, not atomic). Use one conditional `UPDATE ... RETURNING`, via `cas()` for Tickets, and act only on a returned row. `apps/server/tests/state-guards.test.ts` enforces it.

AI chat UIs use [assistant-ui](https://www.assistant-ui.com/elements/) (`@assistant-ui/react`, an approved dependency) as much as possible; see the Chat pattern in [docs/design/README.md](docs/design/README.md).

Adding a migration = adding one file `apps/server/src/migrations/YYYYMMDD_HHMMSS_slug.ts`. Never edit `index.ts`: it is generated (git-ignored) by `pnpm --filter server gen:migrations`, which `dev`, `build`, `test` and `typecheck` run first (run it yourself before a bare `payload migrate`). Migrations run in file-name order. New job task slugs need no migration: `syncJobEnums` adds them to the Postgres enums on startup.
