# packages/adapters

GitHub and GitLab backends behind one contract, plus a Planka ticket source (see Planka below). Private until the `@bauherr` scope is needed.

Drivers: `GithubBackend` (`github.ts`), `GitlabBackend` (`gitlab.ts`, self-hosted or gitlab.com, PAT), `FakeBackend` (`fake.ts`). Live-forge contract suites: `pnpm test:github`, `pnpm test:gitlab` (skipped unless `GITLAB_TOKEN`, `GITLAB_BASE_URL`, `GITLAB_SANDBOX` are set).

## Planka

`PlankaTicketSource` (`planka.ts`) is a `TicketSource` on a Planka 2.x board; Planka hosts no code, so pair it with a forge backend: `withTickets(new GithubBackend(...), new PlankaTicketSource({ baseUrl, token, boardId, lists?, closedList? }))`. Contract suite `pnpm test:planka` (skipped unless `PLANKA_BASE_URL`, `PLANKA_TOKEN`, `PLANKA_SANDBOX_BOARD` are set; the board needs a `Done` list and the token user as member). Not yet selectable in Settings (follow-up).

- Every card on the board is a Ticket; `id` is its ticket number, kept in a hidden footer of the card description (`<!-- bauherr:planka -->`, with the relations block of `body-convention.ts` after it). Cards without a number get the next one on first read. Hand-editing the footer away gives the card a new number.
- Stage, type and other markers are card labels (`bauherr:stage:<stage>`); a missing board label is created on demand. With `lists` (stage -> list name), adding a stage label also moves the card; moving a card by hand changes no label (labels are the source).
- Closed = in `closedList` (default `Done`) or in a closed, archive or trash list; `close` adds `bauherr:close-reason:<r>` and moves the card, `reopen` returns it to its stage list or the first open list.
- `poll` reads the board once and returns cards with `updatedAt >= cursor` (comments do not touch it). `labelEvents` come from the footer log of label changes made through the adapter; changes made by hand in Planka have no actor and are not logged.
- Assignees are card members (the token user and anyone named must be board members). Sub-tickets, blockers and links live in the description footer; no attachments, native sub-tickets, native blocking or webhooks.
