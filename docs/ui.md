# UI

The Bauherr UI is the Next.js route group `apps/server/src/app/(app)/`, served at `/`. Payload stays at `/admin` and `/api`, MCP at `/mcp`.

## Routes

| Path | Page |
|---|---|
| `/login` | email + password (local `payload.login`, not the REST endpoint); plus "Sign in with …" when OIDC is configured, see [auth](auth.md) |
| `/` | Tickets overview of the selected Workspace, views by `?view=list\|board\|runs` |
| `/runs` | redirects to `/?view=runs` |
| `/tickets/<id>` | Ticket page, see below |
| `/runs/<id>` | stub until the Run page lands |

Pages under `(shell)/` get the top bar and require a session; unauthenticated requests redirect to `/login`. Sign out and Workspace selection are server actions in `lib/actions.ts`.

## Overview

Tabs **List**, **Board**, **Runs** on `/`, plus a Product filter and an Open/All toggle (`?product=<id>&state=all`). The chosen tab is stored per user in `bauherren.uiPrefs` (`{ view }`, written by the server action `setView`, which validates the view and merges into the freshly read prefs); `/` without `?view=` redirects to the saved one. Data comes from `lib/overview.ts` (`loadOverview(workspace, all)`: open tickets, plus the newest 200 closed ones when `all`; latest Run per ticket from one query; the newest 100 Runs of the Workspace; Products).

- **List**: "Needs you" first, then one section per stage (`triage, plan, build, review, release, done`); empty sections are omitted and a ticket in "Needs you" is not repeated below. Tickets without a stage label count as `triage`, closed ones as `done`.
- **Board**: one column per stage.
- **Runs**: the newest 100 Workspace Runs first (duration, cost); a line says so when there are more.

"Needs you" (`needsYou()` in `lib/needs-you.ts`, first match wins): `Approve plan` (stage `plan`, no `bauherr:approved:plan` label, latest Run is a succeeded plan Run), `Run needs you` (latest Run `needs_human`), `Review MR` (stage `review`), `Run failed` (an addition to D5). A plan Run that is `running`, `queued` or `awaiting_session` is "Plan in progress" and not needs-you; D5 (c): when the plan has unanswered critical decisions it reads `Answer decisions` instead of `Approve plan`. The overview fetches the plan Comment from the forge only for tickets that would say `Approve plan`, at most 20 per load (`DECISIONS_LOOKUPS` in `lib/overview.ts`); beyond that they keep `Approve plan` there and the List says "Decisions checked for the first 20 tickets"; the Ticket page is always exact. Lookups use one forge source per Product per load and a 3 s timeout; a slow or unreachable forge degrades to `Approve plan`. The Tickets nav item shows the count over open tickets.

## Ticket page

`/tickets/<id>` (Workspace-scoped, 404 otherwise): header with Product, forge link and the stage pipeline (`components/StagePipeline.tsx`, reused by the Run page), then in order: **Gate** (shown while needs-you is `Approve plan` or `Answer decisions`: what is approved, budget, model tiers, decision status, one primary button, disabled with the reason while critical rows are open; `Plan approved` once the label exists), **DecisionSheet**, **Plan**, **Worklog** (markdown without its own `## Worklog` heading; the Plan is shown without its `## Decisions` block, the sheet carries it; the worklog Comment is the first match as before, plan and decisions Comments the latest). Markdown is rendered by `lib/markdown.ts` (the D4 implementation: raw HTML escaped, images reduced to alt text, links only http(s)), **Runs** (evidence excerpt). Plan, worklog and labels are read live from the forge through the Product's ticket source; if it is unreachable the page says so.

Writes are server actions in `lib/actions.ts` over `src/lib/actions.ts` (`approvePlan`, `updateWorklog`, `requestReview`, `postDecisions`), the same functions the MCP tools `approve`, `update_worklog`, `request_review` call. `approvePlan` itself refuses while critical rows are unanswered ("Answer the critical decisions first: D2, …"), so the MCP `approve` tool does too; the UI additionally disables the button. The UI actions pass the selected Workspace id and 404 for a ticket of another Workspace. `postDecisions` runs under an in-process per-ticket mutex (double submit); multi-instance deployments need a DB lock later. Submit buttons disable while pending (`SubmitButton`).

Deviation from the Gate spec: no secondary "Ask for changes" button (nothing to call yet); a blocked primary button shows the disabled style (`surface-200`, `ink-muted`).

### Decision-sheet format (D6)

Rows come from the plan Comment's `## Decisions` block, one bullet each (continuation lines allowed):

`- **D<n> <title>[, critical | — critical | - critical | (critical)]**. Default: <text>. Alternative: <text>. Alternatives: <text>; <text>.`

The options are the default plus each Alternative(s) item (split at `;` and sentence ends outside parentheses and code); "critical" only counts as a suffix marker of the title (a title that merely contains the word does not block approval). Without `Default:` the default is the first sentence; a row with no alternatives is single-choice (one "Accept the default" radio). Saving posts one Comment `<!-- bauherr:decisions -->` with `D<n>: <answer>` lines (replaced on re-save) and appends `- <date> D<n> <title>: <answer>. By: <email>.` under `**Decisions**` in the worklog Comment (created from the worklog template when missing; unchanged answers are not appended again). Only listed options of rows in the live plan are accepted.

### Fake forge (E2E only)

`BAUHERR_E2E_FAKE_FORGE=1` makes `githubFor` (`src/lib/adapters.ts`) return an in-memory `FakeBackend` (`src/lib/fake-forge.ts`) holding ticket #1 of `acme/web` with a plan (two decisions, one critical) and a worklog; state lives in the server process only. `seed:e2e` adds the matching Connection and ticket source. Start the dev server with the variable and run Playwright with `E2E_FAKE_FORGE=1` to enable `e2e/ticket.spec.ts`. Never set it outside tests: `adapters.ts` throws at load when it is set with `NODE_ENV=production`, and imports the fake only in that branch.

## Workspace

`currentWorkspace()` (`lib/session.ts`) returns `{ user, workspace, workspaces }`. Admins see all Workspaces, others those in `tenants`. The choice lives in the cookie `bauherr-ws` (slug); missing or invalid falls back to the first.

## Settings

Routes `/settings/workspace`, `/products`, `/connections`, `/bauherren` (`/settings` redirects to the first), with a left sub-nav on desktop and tabs on phones. Entry points only: Workspace switcher "Workspace settings" and user menu "Bauherren" (D9).

- **Who edits what** (D8): an Admin edits everything. A Bauherr sees the pages read-only, except `budgetUnit`, the budget amount and `modelByTier` of their own Workspaces on `/settings/workspace`. Every server action in `(shell)/settings/actions.ts` re-checks the role; the UI only hides controls.
- **Writes** use the Payload local API with the current user as `user` and `overrideAccess: false` (not `fetch` to `/api`; this is the D9 implementation, not REST): same collection access, hooks and validation, no cookie/Origin round-trip. Every write also asserts that the target and the Products/Connections it references belong to the current Workspace (`lib/settings-guards.ts`). Reads in `lib/settings.ts` use `overrideAccess: true`, filtered by the current Workspace, and load `secret` and `gatewayKey` with `select: false`, so they never enter memory.
- **Validation errors**: `run()` in `lib/settings.ts` turns Payload's `ValidationError` (`errors[].path/message`, e.g. `awsRegion: required for bedrock`) into `FormState.fields`; `Field` renders the message under the input with the same `name`. Other errors show as one line next to the button; success shows "Saved". Forms submit with `startTransition` instead of a form action so a failed save keeps the typed values.
- **Workspace**: empty model tiers store the provider preset's defaults; a preset without defaults (Bedrock, Vertex, compatible endpoints) requires them. Budget amount is one input mapped to `budgetUsd30d` or `budgetTokens30d` by the unit. Spend shows when `GATEWAY_ADMIN_URL` and `GATEWAY_DATABASE_URL` are set. "Rotate key" needs a second click ("Confirm rotate"); with the gateway off it is replaced by a note.
- **Products**: delete is offered only when no repository, ticket source, ticket or workflow version references the Product (the reason is shown otherwise).
- **Connections**: preset fields come from `PRESETS[preset].required`; the secret is write-only (empty = unchanged). "Verify again" re-saves unchanged, which runs the `afterChange` verify.
- **Bauherren**: a new Bauherr gets a server-generated temporary password, shown once in the form result and never logged. `oidcSubject` links an existing Bauherr to SSO (`<issuer>|<user ID>`, see `docs/auth.md`); the table shows only a linked flag, the raw subject appears in the Admin edit drawer. Non-Admins see only Bauherren sharing the current Workspace, with Workspaces reduced to their own. You cannot remove yourself, and a change that would leave no Admin is refused ("Add another Admin first").

## Theming

`pnpm --filter server tokens` generates `(app)/tokens.css` from `docs/design/tokens.json` (also run by `predev`/`prebuild`; commit the result). Light and dark follow `prefers-color-scheme`; the top-bar toggle (System / Light / Dark) sets `data-theme` and stores it in `localStorage` (`bauherr-theme`). Shared classes are in `app.css`.

## Add a page

Create `(app)/(shell)/<path>/page.tsx` as a server component, call `currentWorkspace()`, build from `components/` and the token variables. Add a nav entry in `components/Nav.tsx` only for daily-business pages; settings are reached via the Workspace switcher and user menu.

## E2E

`pnpm e2e` (Playwright, from `apps/server`) runs against `BASE_URL` (default `http://localhost:3000`) with `E2E_EMAIL` and `E2E_PASSWORD_FILE`. Needs `npx playwright install chromium` and the system libraries it lists.

## Smoke test

`pnpm --filter server seed:e2e` seeds the e2e DB (admin, Workspace, one ticket). `pnpm e2e` reads `BASE_URL`, `E2E_EMAIL` and `E2E_PASSWORD_FILE`. Payload accepts the session cookie only from the `serverURL` origin (`PUBLIC_URL`); from another origin run Chromium with `--host-resolver-rules=MAP localhost <host-ip>` (or leave `PUBLIC_URL` unset on the dev server).
