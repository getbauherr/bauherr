# Contributing

Contributions are licensed under Apache-2.0 (Section 5: inbound = outbound). No CLA, no sign-off.

Open an issue before large changes. Report vulnerabilities as described in [SECURITY.md](SECURITY.md), not in public issues.

Adding a migration = adding one file `apps/server/src/migrations/YYYYMMDD_HHMMSS_slug.ts`. Never edit `index.ts`: it is generated (git-ignored) by `pnpm --filter server gen:migrations`, which `dev`, `build`, `test` and `typecheck` run first (run it yourself before a bare `payload migrate`). Migrations run in file-name order. With `BAUHERR_TEST_SCHEMA_READY=1` set, `dev` neither pushes the schema nor migrates: run `pnpm --filter server migrate`. New job task slugs need no migration: `syncJobEnums` adds them to the Postgres enums on startup.

An e2e spec (`apps/server/e2e/*.spec.ts`) must pass alone on a freshly seeded DB and in any order: it never relies on what another spec leaves behind. Give it its own data in `apps/server/scripts/seed-e2e.ts` (its own Products, and a Workspace of its own when it changes Workspace-wide settings), never mutate a seeded record another spec reads, and filter assertions down to your own rows. A forge-backed Product needs its repository in `apps/server/src/lib/fake-forge.ts`. A spec that signs out signs in as a user of its own (`signout-*@example.com` in the seed): a sign-out ends every session of that user, which would log the other workers out. The `e2e-fake` job runs 3 workers and `retries: 1` (`E2E_WORKERS`, `E2E_RETRIES`; both default to 1 worker and no retry locally): a test that passes on retry is reported as flaky, so fix it or file it, never ignore it. The burn-in of changed specs runs 3 workers without retries. Check with `apps/server/scripts/e2e-isolation.sh` (the env of the CI `e2e-fake` job, after a `BAUHERR_TEST_BUILD=1` build).

Rules every e2e test follows (the mechanical ones are pinned by `apps/server/tests/e2e-conventions.test.ts`):

- **A test that mutates a record owns it.** Seeded Product, account or Workspace setting: it gets its own in `seed-e2e.ts` (and its repository in `fake-forge.ts`), never one another spec file reads or writes. Workspace settings and Connections: a Workspace of its own, entered with the `bauherr-ws` cookie like `settings.spec.ts` (`settingsco`). An account that is edited is not one another spec signs in as (a sign-in rewrites the user it read). Before adding a spec, list the records it changes and grep the other specs for them.
- **A mutating test is repeatable.** The e2e-fake job retries once: the retry must not fail on what the first attempt changed (a name made unique with `Date.now()`).
- **Wait on an end signal, never on time.** The visible result of the step (`Saved`, the checks list loaded), not a longer timeout or `waitForTimeout`. Counts of rows that other specs change are read in one `page.evaluate`, and a count that moves with other specs' work is asserted as a direction (`toBeLessThan(before)`), not an exact number.
- **Signed-in API calls come from the page**: `page.evaluate(() => fetch('/api/...'))`. `page.request` sends no `Origin`/`Sec-Fetch-Site`, which Payload's cookie check treats as anonymous on the production image; a deliberate anonymous probe goes through a const named `anonymousApiProbe`.
- **OIDC sign-in specs** (`@oidc`, `apps/server/e2e/oidc.spec.ts`) run against a second server on :3001 with OIDC on and a fake provider on :4010 (`apps/server/e2e/fake-oidc.ts`, started by `apps/server/scripts/e2e-oidc.sh` in `e2e-fake` and the burn-in; Playwright gets `E2E_OIDC=http://localhost:3001`). The http issuer is allowed only by `BAUHERR_E2E_OIDC_INSECURE=1` in a `BAUHERR_TEST_BUILD=1` build or outside production.
- **Prove a change to a spec the way CI does**: `BAUHERR_TEST_BUILD=1` production build, `apps/server/scripts/e2e-burnin.sh <spec files>` (3 passes, 3 workers, no retries, fresh DB each).

## Adding a provider

Presets live in `apps/server/src/lib/providers/`, one file per preset exporting a `Def`; `index.ts` lists them in `PRESETS` and `shared.ts` holds `Preset`, `Def` and the `entry` and `custom` helpers.

1. Add the slug to `Preset` in `shared.ts`, create `providers/<slug>.ts` and register it in `PRESETS`.
2. A `Def` needs `auth` (`file`, `inline` or `ambient`), `required` (the config fields the preset needs, from `PRESET_FIELDS`), `secret` (`ext` and a `hint` shown in the Connection form), `catalog` (whether the gateway reports USD cost), `defaultModels` (a model per Tier, or `null` so the Workspace sets `modelByTier`) and `render`, which returns the gateway config entry via `entry(...)`.
3. A new config field goes into `PRESET_FIELDS` (and `FIELD_PATTERNS` in `index.ts` when it needs validation).
4. Tests: a rendered-entry case in `apps/server/tests/providers.test.ts` and a gateway-config case in `apps/server/tests/gateway-config.test.ts`.

## UI rules for agents

AI chat UIs use [assistant-ui](https://www.assistant-ui.com/elements/) (`@assistant-ui/react`, an approved dependency) as much as possible; see the Chat pattern in [DESIGN.md](DESIGN.md).

Bauherr's own UI rules, for the UX specialist and any agent changing the UI of this repository: [docs/agents/ui-development.md](docs/agents/ui-development.md) (rules, e2e) and [docs/ui.md](docs/ui.md) (pages), [docs/design/README.md](docs/design/README.md) (tokens, patterns, chat), and the shadcn components in `apps/server/src/app/(app)/components/ui`. They are not part of the core pack, which names no Product's paths.

Every page meets WCAG 2.2 AA; an axe scan per page runs in the e2e job and a new page must be added to it: [docs/accessibility.md](docs/accessibility.md).

## Intake eval

`apps/server/src/modules/intake/eval/cases.ts` holds twelve labelled Intake cases. `pnpm --filter server eval:intake` runs each through the real Runner against the gateway (model call, so it costs money) with the Intake skill and a pack of the real shape, prints expected and actual outcome per case and exits 1 below 80% correct. It needs `BAUHERR_EVAL_GATEWAY_URL`, `BAUHERR_EVAL_GATEWAY_KEY` and `BAUHERR_EVAL_MODEL`; without them it exits 2 and runs nothing. The `cut-rc` workflow runs it before it tags: set the two secrets (a budget-capped key) and the repository variable of the same names.
