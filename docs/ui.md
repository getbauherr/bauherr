# UI

The Bauherr UI is the Next.js route group `apps/server/src/app/(app)/`, served at `/`. Payload stays at `/admin` and `/api`, MCP at `/mcp`.

## Routes

| Path | Page |
|---|---|
| `/login` | email + password (local `payload.login`, not the REST endpoint); plus "Sign in with …" when OIDC is configured, see [auth](auth.md) |
| `/` | Tickets overview of the selected Workspace, views by `?view=list\|board\|runs` |
| `/requests` | Requests of the selected Workspace: Intake sessions (embed-widget ones included) newest first, read-only. Status `Draft` (open) or `Linked` (submitted, with Ticket and sub-ticket links); abandoned hidden; no conversation text; newest 100. `/requests/new` starts one |
| `/runs` | redirects to `/?view=runs` |
| `/tickets/<id>` | Ticket page, see below |
| `/runs/<id>` | Run page, tab by `?tab=graph\|timeline\|list` |
| `/knowledge` | Knowledge: documents, search, write-backs, see below |

Pages under `(shell)/` get the top bar and require a session; unauthenticated requests redirect to `/login`. Sign out and Workspace selection are server actions in `lib/actions.ts`. The top bar holds the logo, Tickets (needs-you badge), Knowledge (only when the Workspace has a connected Knowledge repo; `/knowledge` stays reachable by URL), the persistent primary "New request" button and the avatar menu (shadcn `DropdownMenu`): email, the Workspace list (only with more than one Workspace), the Theme row, Settings, Sign out. Requests are not in the nav: "Your drafts" on `/requests/new` links to `/requests` ("All requests").

## Overview

Tabs **List**, **Board**, **Runs** on `/`, plus a Product filter and an Open/All toggle (`?product=<id>&state=all`). The chosen tab is stored per user in `bauherren.uiPrefs` (`{ view }`, written by the server action `setView`, which validates the view and merges into the freshly read prefs); `/` without `?view=` redirects to the saved one. Data comes from `lib/overview.ts` (`loadOverview(workspace, all)`: open tickets, plus the newest 200 closed ones when `all`; latest Run per ticket from one query; the newest 100 Runs of the Workspace; Products).

- **List**: "Needs you" first, then one section per stage (`triage, plan, build, review, release, done`); empty sections are omitted and a ticket in "Needs you" is not repeated below. Tickets without a stage label count as `triage`, closed ones as `done`.
- **Board**: one column per stage. Cards follow `frontierOrder` (`lib/frontier.ts`): in-flight first (review/release, a Run that needs a human, a Build Run that follows another), then the owner's rank, then number; blocked and leased Tickets last. Open cards are sortable by drag and drop or Alt+ArrowUp/Down on a focused card; a move calls `rankTicketAction`, which writes `tickets.rank` (a base-62 fractional key between the two neighbours, per Workspace, never written to the forge). The small number on a card is its position in the column. New Tickets from the poller rank after the last of their Workspace. `claim_next` takes work in the same order.
- **Runs**: the newest 100 Workspace Runs first (duration, cost); a line says so when there are more.
- **Graph** (`?view=graph`): columns by blocker depth. Order inside a column and in the no-dependency section is `executionOrder` (`lib/frontier.ts`): Release, Review, Build, Plan, Triage, then the rest, inside a stage the owner's rank. The no-dependency section is a wrapping grid of small nodes grouped by stage, one heading per stage; Tickets without an execution stage (done, split) sit behind "Show N more". A Ticket whose latest Run is `running` gets `data-running` on its node and Board card: a marching dashed border (stripe on cards) and the activity word from `activity()` (`lib/format.ts`: building, reviewing, planning, deploying, triaging); `awaiting_session` is not animated. With `prefers-reduced-motion` the border is solid accent and the word stays. The Tickets page refreshes every 10 s (`AutoRefresh`), so the state appears and disappears without a reload.

"Needs you" (`needsYou()` in `lib/needs-you.ts`, first match wins): `Approve plan` (stage `plan`, no `bauherr:approved:plan` label, latest Run is a succeeded plan Run), `Run needs you` (latest Run `needs_human`), `Review MR` (stage `review`), `Run failed` (an addition to D5). A plan Run that is `running`, `queued` or `awaiting_session` is "Plan in progress" and not needs-you; D5 (c): when the plan has unanswered critical decisions it reads `Answer decisions` instead of `Approve plan`. The overview fetches the plan Comment from the forge only for tickets that would say `Approve plan`, at most 20 per load (`DECISIONS_LOOKUPS` in `lib/overview.ts`); beyond that they keep `Approve plan` there and the List says "Decisions checked for the first 20 tickets"; the Ticket page is always exact. Lookups use one forge source per Product per load and a 3 s timeout; a slow or unreachable forge degrades to `Approve plan`. The Tickets nav item shows the count over open tickets. The need on a card is shown as the bar's verb (`GATES[need].verb`, e.g. `Accept on staging`, `Re-run build`); sorting and counts still use the need. A card with a notified gate also reads `· @login · waiting <age>` (from `tickets.gateNotified*`).

## Ticket page

`/tickets/<id>` (Workspace-scoped, 404 otherwise): header with Product, forge link and the stage pipeline (`components/StagePipeline.tsx`, reused by the Run page), then in order: **ActionBar** (see below), the **Gate** details card (`id="details"`, shown while needs-you is set: what is approved, budget, model tiers, decision status, staging summary, findings; no buttons except the required-note "Request changes" form; `Plan approved` once the label exists), **DecisionSheet**, **Plan**, **Worklog** (markdown without its own `## Worklog` heading; the Plan is shown without its `## Decisions` block, the sheet carries it; the worklog Comment is the first match as before, plan and decisions Comments the latest). Markdown is rendered by `lib/markdown.ts` (the D4 implementation: raw HTML escaped, images reduced to alt text, links only http(s)), **Runs** (evidence excerpt). Plan, worklog and labels are read live from the forge through the Product's ticket source; if it is unreachable the page says so.

Writes are server actions in `lib/actions.ts` over `src/lib/actions.ts` (`approvePlan`, `updateWorklog`, `requestReview`, `postDecisions`), the same functions the MCP tools `approve`, `update_worklog`, `request_review` call. `approvePlan` itself refuses while critical rows are unanswered ("Answer the critical decisions first: D2, …"), so the MCP `approve` tool does too; the UI additionally disables the button. The UI actions pass the selected Workspace id and 404 for a ticket of another Workspace. `postDecisions` runs under an in-process per-ticket mutex (double submit); multi-instance deployments need a DB lock later. Submit buttons disable while pending (`SubmitButton`).

**ActionBar** (`components/ActionBar.tsx`, copy in `lib/gates.ts`): the first element of the Ticket page in every state, `data-testid="action-bar"`. Sticky at the top on desktop, fixed to the bottom of the viewport at 640px and below. Left: one sentence for the current need; right: "Show details" (anchor to the Gate card), at most one secondary action and exactly one primary button whose label is the verb of the step. Without a need it shows who is working or what is awaited ("Nothing to do: build is running (Run #5, scheduler)") and no button. Overview cards show the same verb.

| Need | Primary | Secondary |
|---|---|---|
| Answer questions | Answer questions (`#decisions`) | |
| Answer decisions | Answer decisions (starts the interactive chat) | |
| Approve plan | Approve plan | |
| Accept on staging, Staging not confirmed | Accept on staging | Request changes (`#changes`) |
| Configure production checks | Configure checks (`/settings/products`) | |
| Approve production | Approve production | |
| Production deploy failed | Approve again | |
| Release failed | Open workflow run (link to the failed `release.yml` run) | |
| Round cap reached | Grant one more round | Stop |
| Run needs you, Run failed | Re-run <stage> | |

**Staging gate** (backend in `src/lib/actions.ts`, UI follows): a Ticket in `release` whose `releaseState` is `on_staging` shows Gate "Accept on staging" with the summary Comment and the Product's `stagingUrl`; the bar's "Accept on staging" calls `acceptStaging`, "Request changes" (note required) calls `requestChanges`. Needs-you reads "Accept on staging" for that state and "Staging not confirmed" for `timed_out`. MCP: `post_staging_summary`, `accept_staging`, `request_changes`. Per-Product `stagingUrl`, deploy mode, webhook URL, required checks, gate owners (GitHub logins notified at human gates; empty = Admins with a GitHub login) and the checkbox "Ask me before deploying to production" are edited on `/settings/products`.

**Approve production** (on by default, or per Product with "Ask me before deploying to production"): after "Accept", the Ticket page shows Gate "Approve production deploy" (needs-you "Approve production") whose bar button calls `approveProduction`; after a failed or timed out deploy the Gate reads "Production deploy failed" with "Approve again". "Approved for production" appears once the label is set. MCP: `approve_production`. Product settings: "Ask me before deploying to production", production webhook URL, production checks. Bauherr's own Product: `production.yml` builds `ghcr.io/getbauherr/bauherr:edge` from the approved sha and reports `production`. Recipe for another Product's label workflow: trigger `issues: labeled` filtered to `bauherr:approved:production` on issues (not PRs); take the Ticket's merge sha from its merged factory PR (head branch `bauherr/<ticket>-*`, not the workflow's HEAD); deploy it; report a check on that sha with the Checks API after the approval (see `.github/scripts/report-check.sh`).

**Round cap gate**: a review Ticket with `reviewState` `needs_human` and `reviewRounds` above the cap shows Gate "Round cap reached" (`ReviewCapGate`) with the escalation Comment's findings, "Grant one more round" (primary) and "Stop" (no note) in the bar; needs-you reads "Round cap reached". Backend: `grantReviewRound`, `stopReview`; MCP: `grant_review_round`, `stop_review`.

The Gate card holds no primary button; the action lives in the ActionBar.

**Where you are asked** (`/settings/workflow`, Admin): a table of the four human touch points in flow order (Refine, Approve plan, Accept on staging, Approve production) with When, What you do, Where, On/Off (from `humanGates()`) and How to change. Names live in `GATE_NAMES` (`lib/needs-you.ts`); the ActionBar copy in `lib/gates.ts` reads them from there.

### Decision-sheet format (D6)

Rows come from the plan Comment's `## Decisions` block, one bullet each (continuation lines allowed):

`- **D<n> <title>[, critical | — critical | - critical | (critical)]**. Default: <text>. Alternative: <text>. Alternatives: <text>; <text>.`

The options are the default plus each Alternative(s) item (split at `;` and sentence ends outside parentheses and code); "critical" only counts as a suffix marker of the title (a title that merely contains the word does not block approval). Without `Default:` the default is the first sentence; a row with no alternatives is single-choice (one "Accept the default" radio). Saving posts one Comment `<!-- bauherr:decisions -->` with `D<n>: <answer>` lines (replaced on re-save) and appends `- <date> D<n> <title>: <answer>. By: <email>.` under `**Decisions**` in the worklog Comment (created from the worklog template when missing; unchanged answers are not appended again). Only listed options of rows in the live plan are accepted.

### Fake forge (E2E only)

`BAUHERR_E2E_FAKE_FORGE=1` makes `githubFor` (`src/lib/adapters.ts`) return an in-memory `FakeBackend` (`src/lib/fake-forge.ts`) holding ticket #1 of `acme/web` with a plan (two decisions, one critical) and a worklog; state lives in the server process only. `seed:e2e` adds the matching Connection and ticket source. Start the dev server with the variable and run Playwright with `E2E_FAKE_FORGE=1` to enable `e2e/ticket.spec.ts`. Never set it outside tests: `adapters.ts` throws at load when it is set with `NODE_ENV=production`, and imports the fake only in that branch.

## Run page

`/runs/<id>` (404 outside the selected Workspace), loaded by `lib/run.ts`. Header `Run <id> · #<ticket> <title>`, status chip, mode, stage pipeline; main column with tabs **Graph**, **Timeline**, **List**, details panel on the right (stacked on phones). No new tables (D5): flow = stage names of `pack/workflow.yaml` (`workflowStages()` in `lib/mode.ts`, fallback the six stages), data = `runs`, `steps` (by `seq`) and `tool_calls` (linked by `step`).

- **Graph**: one node per stage with the ticket's latest Run status and duration, linking to that Run; the current Run's stage has the accent ring.
- **Timeline**: one bar per Step from its `startedAt` (else `createdAt`) to the next Step (last: Run end, or now while running), scale start/mid/end; tool calls nested as thin bars, laid out back to back from the Step start by `durationMs` (the recorder stores no call start). Bars span step to next step, not the Step's own `createdAt`/duration (accepted drift).
- **List**: Steps with tokens, start, duration; the tool-call count expands (`<details>`) to name, stored input digest, status.
- **Details**: launched by (session owner's email for `session` mode, else "scheduler"), start/end/duration, status, model, tokens, cost with `costSource`, evidence (rendered with `lib/markdown.ts`), error, links to the Ticket and the MR (`artifacts.prUrl`).
- **Re-run stage**: shown for `failed` and `needs_human` Runs. The server action `rerunStage` (`lib/actions.ts`) re-checks status and Workspace membership (Admins see all Workspaces), calls `startRunIfNeeded` (a Run already active for the stage is opened instead), records a `human_touches` row `rerun:<stage>` and redirects to the new Run. Two-click confirm via `ConfirmButton`.

## Workspace

`currentWorkspace()` (`lib/session.ts`) returns `{ user, workspace, workspaces }`. Admins see all Workspaces, others those in `tenants`. The choice lives in the cookie `bauherr-ws` (slug); missing or invalid falls back to the first.

## Knowledge

`/knowledge` (main nav, every Bauherr): left a document list per source (core pack, Knowledge repo, and each Product's repo: `README.md` + `docs/**/*.md`, indexed at its default-branch commit as product layer `repo-docs/<path>`; markdown only), right the search hits for `?q=` (same backend as `search_knowledge`, each with `source · path · commit`) or the document of `?doc=<source>:<path>` rendered with `renderMarkdown` (raw HTML escaped). Below, "Write-backs": open `bauherr/*` PRs of the Knowledge repo with the merge-gate checks (`mergeChecks`); a forge that does not answer within 3 s shows one line instead. Without a Knowledge repo only the core pack is listed, with a link to settings. Read-only; editing is a separate page. Loaders: `lib/knowledge.ts`.

## Settings

Routes `/settings/workspace`, `/products`, `/connections`, `/bauherren`, and for Admins `/audit`, `/workflow` (`/settings` redirects to the first), with a left sub-nav on desktop and tabs on phones. Entry point: avatar menu "Settings" (non-Admins land on `/settings/api-key`). The sub-nav also lists "Bauherren", "API key" (every Bauherr) and, for Admins, "Runs" (`/runs`).

**Admin is part of the product.** Every admin function is a page of this UI in the same design system. `/admin` (Payload) is a developer escape hatch only: Admin-only, linked nowhere in the product UI, and switched off with `BAUHERR_DISABLE_ADMIN=1`. The guard is two checks: the `/admin` page and the `(payload)` layout's server function (`notFound()`, so a POSTed server action gets 404 too). `/api` and `/mcp` are unaffected. e2e: `E2E_ADMIN_DISABLED=1` against a dev server started with the flag.

- **Who edits what** (D8): an Admin edits everything. A Bauherr sees the pages read-only, except `budgetUnit`, the budget amount and `modelByTier` of their own Workspaces on `/settings/workspace`. Every server action in `(shell)/settings/actions.ts` re-checks the role; the UI only hides controls.
- **Writes** use the Payload local API with the current user as `user` and `overrideAccess: false` (not `fetch` to `/api`; this is the D9 implementation, not REST): same collection access, hooks and validation, no cookie/Origin round-trip. Every write also asserts that the target and the Products/Connections it references belong to the current Workspace (`lib/settings-guards.ts`). Reads in `lib/settings.ts` use `overrideAccess: true`, filtered by the current Workspace, and load `secret` and `gatewayKey` with `select: false`, so they never enter memory.
- **Validation errors**: `run()` in `lib/settings.ts` turns Payload's `ValidationError` (`errors[].path/message`, e.g. `awsRegion: required for bedrock`) into `FormState.fields`; `Field` renders the message under the input with the same `name`. Other errors show as one line next to the button; success shows "Saved". Forms submit with `startTransition` instead of a form action so a failed save keeps the typed values.
- **Workspace**: empty model tiers store the provider preset's defaults; a preset without defaults (Bedrock, Vertex, compatible endpoints) requires them. Budget amount is one input mapped to `budgetUsd30d` or `budgetTokens30d` by the unit. Spend shows when `GATEWAY_ADMIN_URL` and `GATEWAY_DATABASE_URL` are set. "Rotate key" needs a second click ("Confirm rotate"); with the gateway off it is replaced by a note.
- **API key** (`/settings/api-key`, every Bauherr, own record only): primary section **Agent keys** (`agent_keys`, `lib/api-key.ts`: `mintAgentKey` / `revokeAgentKey` / `resolveAgentKey`): "Create agent key" with a label, shown once as the `claude mcp add` line; a table with prefix, last used and "Revoke" (second click "Confirm revoke"). Agent keys cannot use gate tools ([session mode](session-mode.md#agent-identity)). Secondary section **Personal key (human)** with the warning "Never give this key to an agent; it can approve gates.": "Create/Rotate personal key" / "Revoke personal key". The personal key is the Payload API key (`enableAPIKey`, `apiKey`, encrypted at rest) is generated in `lib/api-key.ts`, shown once as the ready-made `claude mcp add` line and never logged. It is the same credential `/mcp` accepts ([session mode](session-mode.md)). `rotateApiKey(payload, user)` / `revokeApiKey` take the signed-in Bauherr and assert `user.id`; they are the one write that uses `overrideAccess: true`, because Payload's `canCreateOrUpdateAPIKey` is admin-only and this is self-service. The connect line uses `PUBLIC_URL` (fallback `http://localhost:3000`), never the Host header. "Rotate key" is the primary button; "Revoke key" is a plain button with danger text in its own section.
- **Audit** (`/settings/audit`, Admin only, others get 404): tabs Touches (factory rows, actor `factory`, show a muted Factory label) and Tool calls of the selected Workspace, newest 200, filters Ticket (`#12` or `repo#12`, repo = repository full name or Product slug; shown as `<repo>#<number>`), Run id (malformed values show a field error) and (touches only) actor (substring, `%`/`_` escaped), linking to Ticket and Run pages.
- **Workflow** (`/settings/workflow`, Admin only): read-only stage table of `pack/workflow.yaml` with the mode each stage resolves to in the Workspace (`modeFor` precedence), steps, and the latest `workflow_versions` row per Product; "differs from base" marks a compiled workflow that is not the base (Knowledge overlay).
- **Knowledge editor** (`/knowledge/edit?path=<repo path>`): edits one `.md` file of the Workspace's Knowledge repo. Save opens a PR `bauherr/edit-<ts>`; the `watch-knowledge-prs` job squash-merges it once its checks are green. A stale save shows a diff and is not written; a PR that cannot merge is recreated once, then commented `needs-you`.
- **Factory health** (block on `/settings/workspace`, Admin only): `payload-jobs` queued / running / failed of the last 24 h (instance-wide, `payload.count` per state), age of the oldest queued job (looked up within 7 days), last poll per source (`ticket_sources.lastPolledAt`, written on every poll attempt; `lastError` shown in danger color when the last attempt failed), gateway budget as a word (OK, Near limit, Exhausted, No limit, Gateway off).
- **Products**: delete is offered only when no repository, ticket source, ticket or workflow version references the Product (the reason is shown otherwise).
- **Connections**: preset fields come from `PRESETS[preset].required`; the secret is write-only (empty = unchanged). "Verify again" re-saves unchanged, which runs the `afterChange` verify.
- **Bauherren**: a new Bauherr gets a server-generated temporary password, shown once in the form result and never logged. `oidcSubject` links an existing Bauherr to SSO (`<issuer>|<user ID>`, see `docs/auth.md`); the table shows only a linked flag, the raw subject appears in the Admin edit drawer. Non-Admins see only Bauherren sharing the current Workspace, with Workspaces reduced to their own. You cannot remove yourself, and a change that would leave no Admin is refused ("Add another Admin first").

## Theming

`pnpm --filter server tokens` generates `(app)/tokens.css` from `docs/design/tokens.json` (also run by `predev`/`prebuild`; commit the result). Light and dark follow `prefers-color-scheme`; the avatar-menu Theme row (System / Light / Dark, menu stays open) sets `data-theme` and stores it in `localStorage` (`bauherr-theme`). Shared classes are in `app.css`.

## Add a page

Create `(app)/(shell)/<path>/page.tsx` as a server component, call `currentWorkspace()`, build from `components/` and the token variables. Add a nav entry in `components/Nav.tsx` only for daily-business pages; settings are reached via the avatar menu.

## E2E

`pnpm e2e` (Playwright, from `apps/server`) runs against `BASE_URL` (default `http://localhost:3000`) with `E2E_EMAIL` and `E2E_PASSWORD_FILE`. Needs `npx playwright install chromium` and the system libraries it lists.

## Smoke test

`pnpm --filter server seed:e2e` seeds the e2e DB (admin, Workspace, one ticket). The e2e suite expects a freshly seeded DB (re-runs leave active Runs behind). `pnpm e2e` reads `BASE_URL`, `E2E_EMAIL` and `E2E_PASSWORD_FILE`. Payload accepts the session cookie only from the `serverURL` origin (`PUBLIC_URL`); from another origin run Chromium with `--host-resolver-rules=MAP localhost <host-ip>` (or leave `PUBLIC_URL` unset on the dev server).

CI (`.github/workflows/ci.yml`) runs the suite twice, seeded via `seed:e2e`. Job `e2e` uses the production image (built once with `docker/build-push-action`, GHA layer cache scope `image`, shared with `cli-smoke`; the `Dockerfile` installs dependencies in a layer keyed on the lockfile before `COPY . .`); the image refuses `BAUHERR_E2E_FAKE_FORGE`, so the fake-forge specs are skipped there. Job `e2e-fake` runs `next dev` with `BAUHERR_E2E_FAKE_FORGE=1 INTAKE_FAKE=1 BAUHERR_PACK_DIR=<abs>/apps/server/tests/fixtures/gated-pack` and Playwright with `E2E_FAKE_FORGE=1 E2E_GATED_PACK=1` (the gated pack turns the plan gate on) and runs those specs, sharded in two (`--shard=N/2`, one Postgres and dev server per shard; specs must not depend on each other across files). All jobs cache the pnpm store via `actions/setup-node` (`cache: pnpm`, keyed on `pnpm-lock.yaml`).

Local fake-forge run: migrate and `seed:e2e` a fresh DB, start `BAUHERR_E2E_FAKE_FORGE=1 INTAKE_FAKE=1 BAUHERR_PACK_DIR=$PWD/tests/fixtures/gated-pack pnpm exec next dev --port <port>` from `apps/server`, then run `npx playwright test` with `E2E_FAKE_FORGE=1 INTAKE_FAKE=1 E2E_GATED_PACK=1` (plus `BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD_FILE`). Drop `E2E_GATED_PACK` and `BAUHERR_PACK_DIR` to run against the default pack. Only the OIDC and admin-disabled specs stay skipped in both (they need dedicated servers).
