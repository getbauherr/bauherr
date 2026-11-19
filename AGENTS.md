# AGENTS.md

Bauherr is an AI software factory: it turns forge issues into reviewed, verified pull requests through staged runs of AI roles.
This monorepo holds the web app and engine (`apps/server`, Next.js and Payload on Postgres), the forge adapters, the runner and the CLI.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck     # builds the packages, then type-checks every project
pnpm lint          # eslint.config.mjs, type-checked; baseline in eslint-suppressions.json
pnpm test          # package tests and the server's vitest suite (needs Postgres: DATABASE_URL, default 127.0.0.1:54330)
```

Add a migration: one file `apps/server/src/migrations/YYYYMMDD_HHMMSS_slug.ts`, never edit the generated `index.ts`
(details in CONTRIBUTING.md). `pnpm lint` and `pnpm typecheck` run before every push; the pre-commit hook lints
staged TypeScript. Hooks are installed by `pnpm install`.

## Where things live

- `apps/server/src/core/`: the lifecycle core. `apps/server/src/modules/<name>/`: one lifecycle module each.
- `apps/server/src/lib/`: kept helpers (connections, people, gateway, secrets, knowledge).
- `apps/server/src/app/`: pages and server actions. `apps/server/src/collections.ts`: Payload collections.
- `packages/adapters`: GitHub, GitLab and fake forge. `packages/runner`: Claude Agent SDK runs. `packages/cli`: the CLI.
- `pack/`: the roles' rules and skills. `docs/`: product and design documentation.
- `CONTEXT.md` is the domain language, `DESIGN.md` the UI language.

## The rules are the tools

`eslint.config.mjs` (lint rules, each with a message that names the fix), `tsconfig*.json` (compiler flags) and
`apps/server/tests/` (structural tests) are the rules. If one of them fails, the message says what to do instead;
do not work around it, and do not add to `eslint-suppressions.json` (it only shrinks, and holds nothing for
`src/core` or `src/modules`). The comment allowlist is `pack/rules/no-comments.md`.

## Judgment, which no check enforces

- Prefer the boring solution; build nothing speculative.
- Ask in one round, numbered, each question with a recommended answer worded so that "yes" accepts it.
  Finding facts is your job, not the person's.
- End every run with a handoff written for a stranger who has not seen the run.
- Proceed, then present; stop only for actions that cannot be undone.
- Lead a card with the decision; evidence is a pointer, not prose.
- Add one automation at a time, and only on a loop that already produces clean output.
