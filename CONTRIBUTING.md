# Contributing

Contributions are licensed under Apache-2.0 (Section 5: inbound = outbound). No CLA, no sign-off.

Open an issue before large changes. Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.

State guards never use `payload.update` with `where` (find-then-update, not atomic). Use one conditional `UPDATE ... RETURNING`, via `cas()` for Tickets, and act only on a returned row. `apps/server/tests/state-guards.test.ts` enforces it.

AI chat UIs use [assistant-ui](https://www.assistant-ui.com/elements/) (`@assistant-ui/react`, an approved dependency) as much as possible; see the Chat pattern in [docs/design/README.md](docs/design/README.md).

Adding a migration = adding one file `apps/server/src/migrations/YYYYMMDD_HHMMSS_slug.ts`. Never edit `index.ts`: it is generated (git-ignored) by `pnpm --filter server gen:migrations`, which `dev`, `build`, `test` and `typecheck` run first (run it yourself before a bare `payload migrate`). Migrations run in file-name order. New job task slugs need no migration: `syncJobEnums` adds them to the Postgres enums on startup.

An e2e spec (`apps/server/e2e/*.spec.ts`) must pass alone on a freshly seeded DB and in any order: it never relies on what another spec leaves behind. Give it its own data in `apps/server/scripts/seed-e2e.ts` (its own Tickets, and a Workspace of its own when it changes Workspace-wide settings), never mutate a seeded Ticket another spec reads, and filter assertions down to your own rows. A forge-backed Ticket needs its twin in `apps/server/src/lib/fake-forge.ts` under the same number. A spec that signs out signs in as a user of its own (`signout-*@example.com` in the seed): a sign-out ends every session of that user, which would log the other workers out. The `e2e-fake` job runs 3 workers and `retries: 1` (`E2E_WORKERS`, `E2E_RETRIES`; both default to 1 worker and no retry locally): a test that passes on retry is reported as flaky, so fix it or file it, never ignore it. The burn-in of changed specs runs 3 workers without retries. Check with `apps/server/scripts/e2e-isolation.sh` (the env of the CI `e2e-fake` job, after a `BAUHERR_TEST_BUILD=1` build).

Rules every e2e test follows (the mechanical ones are pinned by `apps/server/tests/e2e-conventions.test.ts`):

- **A test that mutates a record owns it.** Seeded Ticket, Product, account or Workspace setting: it gets its own in `seed-e2e.ts` (and its twin in `fake-forge.ts`), never one another spec file reads or writes. Workspace settings, templates, Connections, the workflow: a Workspace of its own, entered with the `bauherr-ws` cookie like `setup.spec.ts` (`newco`) and `settings.spec.ts` / `templates.spec.ts` (`settingsco`). An account that is edited is not one another spec signs in as (a sign-in rewrites the user it read). Specs that reorder the same list live in one file (`workflow-rank.spec.ts`): tests of one file run one after the other. Before adding a spec, list the records it changes and grep the other specs for them.
- **A mutating test is repeatable.** The e2e-fake job retries once: the retry must not fail on what the first attempt changed (a retry twin of the Ticket, as `ticket.spec.ts` does with #42 for #24, or a name made unique with `Date.now()`).
- **Wait on an end signal, never on time.** The visible result of the step (the chat card moved on, `Saved`, the checks list loaded), not a longer timeout or `waitForTimeout` (only in screenshot helpers, marked `allow-wait`). Counts of rows that other specs change are read in one `page.evaluate`, and a count that moves with other specs' work is asserted as a direction (`toBeLessThan(before)`), not an exact number.
- **Signed-in API calls come from the page**: `page.evaluate(() => fetch('/api/...'))`. `page.request` sends no `Origin`/`Sec-Fetch-Site`, which Payload's cookie check treats as anonymous on the production image; a deliberate use says `allow-page-request` on its line.
- **Prove a change to a spec the way CI does**: `BAUHERR_TEST_BUILD=1` production build, `apps/server/scripts/e2e-burnin.sh <spec files>` (3 passes, 3 workers, no retries, fresh DB each).


## UI rules for agents

Bauherr's own UI rules, for the UX specialist and any agent changing the UI of this repository: [docs/ui.md](docs/ui.md) (pages, states, e2e), [docs/design/README.md](docs/design/README.md) (tokens, patterns, chat), and the shadcn components in `apps/server/src/app/(app)/components/ui`. They are not part of the core pack, which names no Product's paths.

## Regenerate README screenshots

```bash
pnpm screenshots
```

Starts a throwaway Postgres 17 container and the app on seeded demo data, runs `apps/server/e2e/screenshots.spec.ts` in Playwright's Docker image and writes every picture of the README and the landing page, light and dark (1440x900, 2x), to `docs/assets/`; a rerun replaces them. The spec fails when a seeded e2e identifier is visible on a page. Needs Docker, Node 24 and pnpm. A new picture also needs a symlink in `docs/site/docs/screenshots/`.

Look at every PNG before you commit it. The banner (`docs/assets/banner*.svg`) is hand-written SVG.

