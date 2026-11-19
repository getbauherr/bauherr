# UI development

Notes for agents and contributors who change the Bauherr UI. The user guide is [docs/ui.md](../ui.md). Tokens and patterns are in [docs/design/README.md](../design/README.md).

## Rules

- A page render reads only the database. Forge, gateway and trace reads belong to jobs, server actions or a `<Suspense>` component with a skeleton and a timeout. `tests/render-no-forge.test.ts` enforces it.
- Add a page as `(app)/(shell)/<path>/page.tsx`, a server component that calls `currentWorkspace()`. Add a sidebar entry in `components/nav-items.ts` only for daily-business pages. Add the page to the axe scan, see [accessibility](../accessibility.md).
- Run `pnpm --filter server tokens` after editing `docs/design/tokens.json`. It writes `(app)/tokens.css`, which you commit. Use Tailwind utilities and the shadcn components in `components/ui`. `app.css` holds no component classes.
- Add no route-level `loading.tsx`. React holds a revealed Suspense boundary back for about 300 ms, which made fast pages slower. Use a skeleton only around genuinely slow sections.
- Click feedback comes from `components/LinkPending.tsx` and `components/NavProgress.tsx`. `AutoRefresh` polls `/api/changes` every 5 s and refreshes only when its value changed.
- Fonts are vendored in `(app)/fonts/` and loaded with `next/font/local`, so the build needs no network.
- Status labels come from `ticketStatus()` in `lib/status.ts`. The chat dock picks tool widgets by tool `kind`, never by name.
- A page that sets the last breadcrumb label uses `<PageTitle>`.

## Run the e2e suite

Install the browser once with `npx playwright install chromium`. Seed a fresh database and run the suite from `apps/server`:

```bash
pnpm --filter server seed:e2e
pnpm e2e
```

`pnpm e2e` reads `BASE_URL`, `E2E_EMAIL` and `E2E_PASSWORD_FILE`. Payload accepts the session cookie only from the `PUBLIC_URL` origin. From another origin, start Chromium with `--host-resolver-rules`, or leave `PUBLIC_URL` unset on the dev server.

Specs that read a repository or its checks need the fake forge (`BAUHERR_E2E_FAKE_FORGE=1` on the server, `E2E_FAKE_FORGE=1` for Playwright). The production image refuses the fake forge, so those specs run in the `e2e-fake` job, which builds with `BAUHERR_TEST_BUILD=1`. The isolation rules for specs are in [CONTRIBUTING.md](../../CONTRIBUTING.md) and pinned by `tests/e2e-conventions.test.ts`.

`e2e/perf.spec.ts` budgets the click feedback at 100 ms and the content at 400 ms on the production server.
