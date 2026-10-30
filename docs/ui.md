# UI

The Bauherr UI is the Next.js route group `apps/server/src/app/(app)/`, served at `/`. Payload stays at `/admin` and `/api`, MCP at `/mcp`.

## Routes

| Path | Page |
|---|---|
| `/login` | email + password (local `payload.login`, not the REST endpoint) |
| `/` | open Tickets of the selected Workspace |
| `/runs` | Runs of the selected Workspace |

Pages under `(shell)/` get the top bar and require a session; unauthenticated requests redirect to `/login`. Sign out and Workspace selection are server actions in `lib/actions.ts`.

## Workspace

`currentWorkspace()` (`lib/session.ts`) returns `{ user, workspace, workspaces }`. Admins see all Workspaces, others those in `tenants`. The choice lives in the cookie `bauherr-ws` (slug); missing or invalid falls back to the first.

## Theming

`pnpm --filter server tokens` generates `(app)/tokens.css` from `docs/design/tokens.json` (also run by `predev`/`prebuild`; commit the result). Light and dark follow `prefers-color-scheme`; the top-bar toggle (System / Light / Dark) sets `data-theme` and stores it in `localStorage` (`bauherr-theme`). Shared classes are in `app.css`.

## Add a page

Create `(app)/(shell)/<path>/page.tsx` as a server component, call `currentWorkspace()`, build from `components/` and the token variables. Add a nav entry in `components/Nav.tsx` only for daily-business pages; settings are reached via the Workspace switcher and user menu.

## E2E

`pnpm e2e` (Playwright, from `apps/server`) runs against `BASE_URL` (default `http://localhost:3000`) with `E2E_EMAIL` and `E2E_PASSWORD_FILE`. Needs `npx playwright install chromium` and the system libraries it lists.

## Smoke test

`pnpm --filter server seed:e2e` seeds the e2e DB (admin, Workspace, one ticket). `pnpm e2e` reads `BASE_URL`, `E2E_EMAIL` and `E2E_PASSWORD_FILE`.
