# Product-owner accounts, Requests and intake

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- A third account role `product-owner` (`admin`, `bauherr`, `product-owner`). Its assignment is `{ workspace, scope: 'workspace' | 'products', products }`. An empty `products` list under `products` grants nothing. Anything outside the assignment answers 404, never 403.
- A Product owner saw only Requests, a reduced Ticket page (no Runs, cost, plan, models, settings) and plain-word status. Every collection and route was closed to them by default.
- `/requests` listed four sections: Needs you, Drafts, In the factory, Done. `/requests/new` and `/requests/<id>` held the request conversation with a living request card (title, type bug/feature/change/question, urgency normal/urgent).
- The intake interview asked one question per turn, at most 6 (`MAX_QUESTIONS`), at most 40 visitor messages. The engine, not the model, decided completeness: `readiness` needs a problem, context for bugs, at least one criterion (not for questions), an urgent reason when urgent, and a screenshot when the text refers to a screen.
- A message with several independent problems got a `split` of 2 to 6 drafts. Submit with `{ expect: N }` answered 409 if N differed. Each part became one Ticket, marked `session=<id> part=<i>` so a retry never duplicated it.
- The embeddable widget (`/intake/widget.js`, shadow root, 250 KB gzip cap) used a token `bemb_...`: one Product, allowed origins, 20 new sessions per hour by default, hash stored, revocable. Other origins got 403.
- The refine conversation answered Triage's decision sheet: points open/answered/dropped, at most 3 added per turn, at most 10 open, 60 user messages. Option clicks, "Why does this matter?" and "Use the recommended answers" needed no model call. "Send to planning" released the hold.
- Progress comment: `progressOf` derived one of 15 keys (received, question, planning, approval, building, reviewing, agent, human, staging, waiting, released, stuck, closed, split, blocked) and `syncProgress` edited one forge comment `bauherr:progress` in place. A mention comment `bauherr:progress-notice:<key>` went to the issue author on question, staging, released, stuck.

## The requirement behind it

- People who file requests (product owners, end users of a Product) must not need to open the factory or see its internals (#512, #520).
- A request must reach Triage complete enough to plan without asking: criteria, context, screenshot (#145, #146, #149).
- Reporting from the Product's own site, not only from the portal (#149); several problems in one report (#223).
- The Bauherr answers Triage's questions in one conversation instead of forge comments (#148, #521, #531).
- The requester is told in plain words where the issue is (progress comment, `docs/spec/intake.md`).

## Where the code is

- `apps/server/src/lib/intake/` (engine.ts 195, card.ts 79, media.ts 143, embed.ts 44, api.ts 54, fake.ts 55, turn.ts, kinds.ts, media-check.ts), `apps/server/src/lib/request-conversation.ts` (226), `request-order.ts` (18), `apps/server/src/lib/people.ts` (99).
- `apps/server/src/lib/refine/` (engine.ts 389, model.ts 146, artifact.ts 45); routes `apps/server/src/app/api/refine/[ticket]`, `api/requests/`.
- `apps/server/src/lib/progress.ts` (230); job `sync-progress`, sweep `notify-gates`; templates `pack/templates/progress.md`, `request.md`; skill `pack/skills/intake/`.
- Routes: `apps/server/src/app/intake/` (api/sessions, api/media, widget/), `(shell)/requests/` (page, new, [id]); `apps/server/public/intake-embed-test.html`.
- UI: `apps/server/src/app/(app)/components/` `RequestCard.tsx`, `RequestParts.tsx`, `RequestComments.tsx`, `OrderedRequests.tsx`, `conversation/` (RequestConversation, RefineConversation, RequestArtifact), `chat/intake-adapter.ts`; `app/(app)/lib/requests.ts`.
- Collections in `apps/server/src/collections.ts`: `intake_sessions` (persona product-user/owner, status, messages, draft, split, turn, kind, urgency, ticketNumbers, embedToken), `embed_tokens`, `media`; `bauherren.role` and `assignments`; `workspaces.progressComments`; `tickets.progressCommentId/progressHash/progressNotified`.
- Tests in `apps/server/tests/`: `intake*.test.ts`, `request*.test.ts`, `refine-*.test.ts`, `people.test.ts`, `progress.test.ts`, `widget-size.test.ts`.
- Docs: `docs/spec/people.md`, `docs/spec/intake.md`, `docs/intake-embed.md`, `docs/chat.md` (request and refinement sections).

## Why it was cut

The first lean core takes tickets from forge issues only. The request pages, chat and widget return as a module on top of Intake. The owner wants this back as a later module.

## What a module on the new core needs

- Core contracts: Intake as the trigger (a module that creates a forge issue or a record with `source`), the Ticket record fields `goal`, `criteria`, `type`, `risk`, the forge writer for the issue and progress comment, and Cards for the Brief. A Product-owner view reads only the mirror.
- Kept and reused by the new Intake: the deterministic `readiness` check and `splitReadiness` in `lib/intake/engine.ts`. Also liftable almost unchanged: `cardOf` and `missingWords` (`card.ts`), `people.ts` visibility helpers (`assignmentOf`, `canSeeProduct`, `requestsVisibleTo`, `mediaVisibleTo`), `progressOf` (pure), embed token hash and origin check (`embed.ts`).
- To design again: the interview must end in a record write, not a forge issue body; Product-owner access on the new Postgres mirror; the refine conversation must act on Question-card options, not free text; the progress text must come from the record, since editable templates are gone.
- Traps: closed-by-default access had to be set per collection (`col()` default `bauherrOnly`); a Product owner must never be raised by SSO resync (`resyncRole`); retries of split submit need the idempotency marker; the progress comment needs a claimed hash before the write or it posts twice; the first post lists once to adopt an existing marked comment; images must not get public links (signed `/m/<id>/<sig>` only for images in forge text).
