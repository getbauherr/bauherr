# Planka adapter

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- `PlankaTicketSource` implemented the `TicketSource` contract on a Planka 2.x board. Planka hosts no code, so `withTickets(backend, source)` paired it with a GitHub or GitLab backend for branches and pull requests.
- Every card on the board is a Ticket. The ticket number lives in a hidden footer of the card description (`<!-- bauherr:planka -->`, then the relations block of `body-convention.ts`). A card without a number got the next one on first read; the counter is `<!-- bauherr:planka-next=N -->` in a board counter card. Editing the footer away gives the card a new number.
- Stage, type and close reason are card labels (`bauherr:stage:<stage>`, `bauherr:close-reason:<r>`). A missing label is created on demand. With the option `lists` (stage to list name), adding a stage label also moves the card; moving a card by hand changes no label (labels are the source).
- Closed means in `closedList` (default `Done`) or in a closed, archive or trash list. `close` labels and moves; `reopen` returns the card to its stage list or the first open list.
- `poll` read the board once and returned cards with `updatedAt >= cursor` (comments do not touch it). Label events came from a log in the footer (max 200); hand changes in Planka have no actor and are not logged.
- Assignees are card members. Sub-tickets, blockers and links live in the footer. Capabilities: no attachments, native sub-tickets, native blocking or webhooks.
- The HTTP client sent a Bearer token, retried on 429 using `Retry-After` (max 3 retries, refused above `MAX_WAIT_MS`) and never put the token in an error.

## The requirement behind it

- Teams that keep tickets in Planka and code in GitHub or GitLab (#578, commit `865e287a`, 2026-11-13).

## Where the code is

- `packages/adapters/src/planka.ts` (425 lines): `PlankaHttp`, `PlankaTicketSource`, `withTickets`, `PlankaError`. Exported from `packages/adapters/src/index.ts`.
- Tests: `packages/adapters/test/planka.test.ts` (306 lines, fake HTTP), `packages/adapters/test/planka.sandbox.test.ts` (28, runs the contract suite, skipped unless `PLANKA_BASE_URL`, `PLANKA_TOKEN`, `PLANKA_SANDBOX_BOARD` are set), fixture `packages/adapters/test/fixtures/planka/board.json`. Scripts `test` and `test:planka` in `packages/adapters/package.json`.
- Docs: section "Planka" in `packages/adapters/README.md`, which says "Not yet selectable in Settings (follow-up)".
- History: `git log --oneline -- packages/adapters/src/planka.ts` shows two commits (`865e287a` add, `b94196f8` comment removal).
- Server: `apps/server/src/lib/adapters.ts` (`backendFor`) builds only `GithubBackend` and `GitlabBackend`; no reference to Planka anywhere under `apps/` or `pack/`.

## Why it was cut

The server never used it; GitHub and GitLab are the supported forges.

## What a module on the new core needs

- Contracts: the mirror. Cards would be mirrored into Postgres like issues; the forge writer would write labels, comments and moves. Intake reads the mirror, never Planka directly.
- Lift almost unchanged: `PlankaHttp`, `parseDesc`/`renderDesc` (footer format), `PlankaTicketSource` methods, `withTickets`, and the 306-line unit test with its fixture.
- Design again: the connection kind and settings form (never built); how a Planka card maps to `source` on the record; how pull requests find the ticket when the forge is separate.
- Traps: a hand-edited footer renumbers the card; labels are the truth, so a list move by hand is ignored; `poll` misses comment-only changes because comments do not move `updatedAt`; label events by hand have no actor (so a human-set label cannot be told from an agent's); writes go through a serial chain (`chain`) in the class, which suggests Planka needs ordered writes (inferred); the token user must be a board member. The sandbox contract suite never ran in CI (skipped without env), so behaviour against a live Planka is not proven here.
