# UI

The Bauherr UI is the Next.js route group `apps/server/src/app/(app)/`, served at `/`. Payload stays at `/admin` and `/api`, MCP at `/mcp`.

## Routes

| Path | Page |
|---|---|
| `/login` | email + password (local `payload.login`, not the REST endpoint); plus "Sign in with …" when OIDC is configured, see [auth](auth.md) |
| `/` | Tickets overview of the selected Workspace, views by `?view=list\|board\|runs` |
| `/runs` | redirects to `/?view=runs` |
| `/tickets/<id>`, `/runs/<id>` | stubs until the Ticket and Run pages land |

Pages under `(shell)/` get the top bar and require a session; unauthenticated requests redirect to `/login`. Sign out and Workspace selection are server actions in `lib/actions.ts`.

## Overview

Tabs **List**, **Board**, **Runs** on `/`, plus a Product filter and an Open/All toggle (`?product=<id>&state=all`). The chosen tab is stored per user in `bauherren.uiPrefs` (`{ view }`, written by the server action `setView`, which validates the view and merges into the freshly read prefs); `/` without `?view=` redirects to the saved one. Data comes from `lib/overview.ts` (`loadOverview(workspace, all)`: open tickets, plus the newest 200 closed ones when `all`; latest Run per ticket from one query; the newest 100 Runs of the Workspace; Products).

- **List**: "Needs you" first, then one section per stage (`triage, plan, build, review, release, done`); empty sections are omitted and a ticket in "Needs you" is not repeated below. Tickets without a stage label count as `triage`, closed ones as `done`.
- **Board**: one column per stage.
- **Runs**: the newest 100 Workspace Runs first (duration, cost); a line says so when there are more.

"Needs you" (`needsYou()` in `lib/needs-you.ts`, first match wins): `Approve plan` (stage `plan`, no `bauherr:approved:plan` label, latest Run is a succeeded plan Run), `Run needs you` (latest Run `needs_human`), `Review MR` (stage `review`), `Run failed` (an addition to D5). A plan Run that is `running`, `queued` or `awaiting_session` is "Plan in progress" and not needs-you; D5 (c), unanswered critical decisions, arrives with the Ticket page slice. The Tickets nav item shows the count over open tickets.

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
