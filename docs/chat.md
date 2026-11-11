# Factory chat (server contract)

One assistant chat on every page. This file is the contract the UI builds against; code is in `apps/server/src/lib/chat/` and `apps/server/src/app/api/chat/`. The UI is assistant-ui (`useRemoteThreadListRuntime` + `useLocalRuntime` with a `ChatModelAdapter` that reads the NDJSON stream).

## Rules

- **Auth**: the session cookie (or an API key) of a Bauherr. The Workspace is the `bauherr-ws` cookie checked against the person's memberships, else their first Workspace. No session: `401`. A thread of another Bauherr or another Workspace is `404`, the same as one that does not exist.
- **Tool widgets are chosen by `kind`** (`read` | `confirm`), never by tool name.
- **Confirmation rule**: a `confirm` tool never runs in the turn that asks for it. The server resolves and stores the exact call (`thread.pending`), sends a card and ends the stream. Only `POST .../confirm` with the stored `toolCallId` runs it, as the confirming person, exactly once and exactly as stored (name and input; the model cannot change it). A wrong or already answered id is `409`. A new run in the thread discards an unanswered card.
- **Context rule**: the page context is built on the server from the `path` only, limited to the current Workspace; the client never sends page content. An id of another Workspace reads as `Not found`. At most 1500 characters. `/` (Workflow) summarises the selected `?stage=`, the open Tickets and statuses per stage and the checkpoints waiting; `/insights` gives the range, the tiles and the bottleneck sentence as text. It goes into the system prompt as a `<page>` block; the person's text and tool results go only into user turns.
- **Untrusted text**: Ticket bodies, goals, worklogs, evidence and knowledge snippets in tool results are wrapped in an `<untrusted-data>` fence.
- **Tickets are addressed by number** in tool inputs (`ticket: 123`, optional `product` slug). A number shared by several Products answers `{ambiguous, candidates}` instead of acting.
- **Usage**: every answer carries model, tokens, cost (`null`: no gateway price is known) and time.

## Routes

All under `/api/chat`, JSON unless noted.

| Route | Body | Answer |
|---|---|---|
| `GET /threads?archived=1` | | `{threads: Meta[]}` own, newest message first, at most 200; archived only with `archived=1` |
| `POST /threads` | `{path?}`, `{ticket}`, `{request: true}` or `{requestSession}` | `201 Meta`; `path` sets the starting context. `{ticket: <Ticket id>}`: the person's one thread of that Ticket, `200` (created on first use, an archived one comes back), `404` for a Ticket of another Workspace. `{request: true}`: a thread for a new request (an empty one of the person is reused; with one Product in the Workspace its interview session is started at once), `200`, `404` when the Workspace has no Product. `{requestSession: <id>}`: the thread of one of the person's own requests (created on first use with the interview so far as messages, an archived one comes back), `200`, `404` for anyone else's |
| `GET /threads/:id` | | `Meta` |
| `PATCH /threads/:id` | `{title?: string \| null, archived?: boolean}` | `Meta` |
| `DELETE /threads/:id` | | `204`; messages go with it |
| `GET /threads/:id/messages` | | `{context, ticket, request, pending, messages: [{parentId, message, answer, feedback}]}` oldest first; `request` = `null` or `{session, sent, product, productId, products}` (`products`: the Products to choose from, only while the Workspace has several and nothing was said yet) |
| `PUT /threads/:id/messages` | `{parentId?, message, answerId?}` | `204`; upsert by `message.id` |
| `POST /threads/:id/run` | `{messages, context: {path}}` | NDJSON stream |
| `POST /threads/:id/confirm` | `{toolCallId, approved, reason?}` | NDJSON stream; `409` nothing matching to confirm |
| `POST /threads/:id/feedback` | `{messageId, value: 'up' \| 'down' \| null, reasons?: string[], note?: string}` | `204`; `null` withdraws |
| `POST /media` | multipart `file` (png, jpeg, webp) | `201 {id, url}` |
| `GET /context?path=/tickets/12` | | `{label, markdown}` |

`Meta` = `{id, title, archived, lastMessageAt, createdAt, context: {path, label} | null, ticket: <Ticket id> | null, request: boolean}`. `pending` (in `GET messages`) = `{toolCallId, name, kind, input, summary, title, details, destructive}` or `null`: restore the card after a reload.

Errors: `400` malformed body or a broken cap, `404` thread/image/answer not found, `409` see above, `415` not an image, `429` more than 60 runs per person per hour.

## Run

`POST /threads/:id/run` body:

```json
{ "messages": [{ "role": "user", "content": [{ "type": "text", "text": "..." }, { "type": "image", "mediaId": 12 }] }],
  "context": { "path": "/tickets/12" } }
```

`messages` is the visible history, text and images only (tool calls are not sent; the last message is the user's). Caps: 100 messages, 8000 characters of text and 6 images per message, images must come from `POST /media` in the same Workspace. The model sees the last 40.

Response `application/x-ndjson`, one JSON object per line, in this order per turn:

```
{"type":"context","label":"Ticket #4 Triage the onboarding feedback"}                          first line
{"type":"delta","text":"..."}                                                                  0..n, append to the answer
{"type":"tool-call","id","name","kind":"read"|"confirm","input","summary"}                     a tool call starts
{"type":"tool-result","id","ok","result","href"?}                                              read tools: right after; result is a string of at most 4000 characters; `href`: where the outcome opens (a sent request)
{"type":"options","id","options":[{"label","recommended"}]}                                    request threads: the interview's answers to pick from
{"type":"confirm","id","name","title","details":[{"label","value"}],"destructive","approve"?,"decline"?,"noReason"?}   a card; the stream then ends with done
{"type":"done","answerId","requiresAction"?,"usage":{"model","tokensIn","tokensOut","costUsd","ms"}}
{"type":"error","message"}                                                                     the stream ends, no done
```

- `tool-call` and `tool-result` share the model's call `id`. A read tool can repeat up to 8 rounds, then the model must answer.
- `confirm.id` equals the `tool-call` id of that call; send it back as `toolCallId`. `details` is the TL;DR: always a `Ticket`, `Stage` and `What happens next` row (plus a `Note` where one applies). `destructive` asks for a stronger confirm button.
- After a `confirm` the stream ends with `done` carrying `requiresAction: true`; the turn is not finished.
- `answerId` is the server's id of this answer.
- Aborting the request (stop button) stops the model call.

`POST /threads/:id/confirm` streams the continuation: `context`, then `tool-result` with `id` = the card's `toolCallId` (`ok: true` with the outcome, `ok: false` for a decline `declined by the person: <reason>` or a failure), then `delta`s, possibly further `tool-call`/`confirm`, and `done`. Fold the `tool-result` into the card that asked.

## Storing messages and ratings

The client stores each message in assistant-ui's exported shape through `PUT .../messages`: `{parentId, message}` with `message = {id, role: 'user'|'assistant', content: [...], ...}`, kept verbatim (at most 2 MB), upserted by `message.id`, so a retry is harmless. The first user text (60 characters) names an untitled thread.

To bind an assistant message to the server's record of its answer (usage, tools, feedback), send `answerId` (from `done`) with the PUT of that message: the server's row takes over the client's `message.id`. An answer that was never stored is not returned by `GET messages`. `GET messages` returns `answer` (`{model, tokensIn, tokensOut, costUsd, ms, toolCalls: [{name, kind, ok}]}`) and `feedback` (`{value, reasons, note}` or `null`) per message.

Feedback: `messageId` is the client's message id (before the PUT, the `answerId`). At most 10 reasons of 100 characters, note up to 2000.

## Tools

`kind` is fixed per tool; the model never sees it. Reads (`read`): `factory_status`, `team_status` (roles with their agent sessions, status, Ticket and active time: "who is working right now?"), `list_tickets`, `get_run`, `list_frontier`, `get_ticket`, `read_worklog`, `read_knowledge`, `search_knowledge`. Owner decisions (`confirm`): `approve`, `accept_staging`, `approve_production`, `grant_review_round`, `stop_review`, `request_changes`, `approve_skill_proposal`, and `post_comment` (chat only, no MCP twin: drafts a comment `{ticket, body}`; confirmed, it runs `postComment` as the person, text only). Session-run tools (claim, heartbeat, report, submit, finish ...) are not exposed (`tests/chat-guard.test.ts`). Every call, read or write, writes a `tool_calls` row. A gate for a Ticket that is not at that gate is refused before any card.

## Ticket threads

A thread with `ticket` set is the person's conversation about that Ticket: one per person and Ticket (unique index `owner` + `ticket`; `ticketThread()` finds or creates it, named `#<number> <title>` in the thread list, and brings it back from the archive). The server always uses the Ticket's page context for its runs and confirmations, whatever `context.path` the client sends, so "this ticket" is right from the Inbox or the Workflow view too.

- **Question card**: the client puts the card first in the loaded thread (`GET messages` returns `ticket`; the card is a tool part with `artifact.kind: 'questions'`, never stored, the first stored message hangs off it). The card calls the owner-intake server actions `startOwnerChat` / `askOwnerChat` (the functions the old answer box used: `startOwnerIntake` / `askOwnerIntake`), so Decisions, worklog, gates and `needsYou` change exactly as before; it shows "Question i of n", the full question and its `Why:` line when the row has one, hides when no row is open and keeps the summary after the last answer. An option click never calls a model; "Why does this matter?" is sent to the thread as a message; free text is `/answer <text>`.
- **Comments**: two ways, both end in `postComment` (text plus one `![name](url)` line per image, images marked sent before the forge call and released on failure). (1) The model drafts: `post_comment` is a `confirm` tool, the person approves a card showing the Ticket, stage and the text, only the stored call runs. (2) Direct, no model: `/comment <text>` in the composer of a Ticket thread (`postDockComment` over `postCommentFromChat`); images pasted into the composer are chat uploads (`/api/chat/media`), and the action adopts the unused ones of the Workspace as this Ticket's comment images (same limits as the comment box: `mediaLimits()`, at most `maxPerSession` per comment). Comment mode is the dock opened by the Ticket page's "Comment" button with `/comment ` already in the composer.

## Request threads

A thread with `request` set is the person's conversation with the intake interview (the engine of `lib/intake/engine.ts` and its prompts and templates are unchanged; the thread is only its surface, the signed-in page and `IntakeChat` are gone; the embeddable widget keeps its own surface). `intakeSession` links it to the request (`intake_sessions` row, `persona: product-user`, `user` = the person); unique `owner` + `intakeSession`, so a request has one thread per person and reopening the request reopens its conversation. Code: `lib/chat/request.ts`.

- **Drafts**: each request is its own thread (several per person, one per `intakeSession`); the Requests page lists the open ones (`loadDrafts`), Continue opens `{requestSession}`, Discard (`discardRequest()`) abandons the session and deletes the thread and its messages. A thread nobody wrote to (no `chat_messages` row at all) is not kept: `pruneEmptyRequests()` deletes it with its still empty session (`draft` null, no messages), per person on every new request (all but the reused one) and for everyone, older than an hour, in the daily `prune-comment-media` job.
- **Starting**: `newRequestThread()` reuses an empty request thread of the person (never one with messages) or creates one; with one Product it starts the session at once, with several the thread waits for the Product (`chooseProduct()`, via the server action `chooseRequestProduct`: a Product of the current Workspace only; until the first message the Product can still be changed, after it the session keeps it; at most 20 sessions per person and hour, as the widget). `requestThread(session)` opens (or creates, with the stored interview as messages) the thread of an own open or sent request; anyone else's request is `null` (404).
- **A turn** (`POST .../run` of a request thread goes to `runRequest()`, not to the model loop): the last user message is one interview turn (`advanceIntake()` in `lib/intake/turn.ts`, shared with `POST /intake/api/sessions/:id/messages`): `delta` with the question, `options` with its option buttons, and, when the draft is ready or the question cap is reached, a stored `pending` call `submit_request {session, expect?}` with a `confirm` card (Product, request(s), context, "It is done when", "Still open", "What happens next"; `approve` "Create request" / "Create n tickets", `decline` "Keep editing", `noReason`). Images in the message are chat uploads (`/api/chat/media`, same Workspace) that are adopted as the session's screenshots (`media.session`, counted in `screenshots`, at most `MEDIA_MAX_PER_SESSION`; an image that is missing, of another Workspace or used elsewhere ends the turn with `error`). The answer's usage is `request` with 0 tokens (the intake call reports none), so the UI shows no usage line. Without a Product the answer asks to choose one; a sent request answers that it is sent.
- **Confirming**: `POST .../confirm` claims the pending call as for any card; on a request thread no model runs. Approve runs `submit_request` as the person (`submitIntake`; the stored `session` must be theirs in this Workspace, else `NotInWorkspace`), writes the `tool_calls` row and answers `tool-result` `ok: true`, `Request #n sent. The factory takes it into Triage.` (or `Requests #a, #b, #c sent...`) with `href` `/requests/<session>`. Decline answers `ok: false`, `Not sent. Keep describing the request; I will ask again when it is complete.` and the interview goes on (the next message re-issues the card when the draft is ready). A refused submit (`draft incomplete`, `the list changed`) answers `ok: false`, `Not sent: <reason>`. Only this call creates the issue(s); the interview engine, its readiness rule and `submitIntake` are the ones of the widget.
- **Tools**: `submit_request` is `hidden` (never offered to the model, `kindOf` is undefined for it). Admin-only tools (`approve_skill_proposal`, `reject_skill_proposal`) are offered only to Admins: `chatTools(user)` and `kindOf(name, user)` take the person, so a member's model never sees them and a call by name is an unknown tool (`tests/chat-guard.test.ts`). Everything else a member may do in the dock is the same as on their pages: gates are the Workspace's members', `get_run` hides mode, model and cost from non-Admins.

## Stored shapes

- `chat_threads`: `workspace`, `owner`, `ticket` (nullable; unique with `owner`), `request` (boolean), `intakeSession` (nullable; unique with `owner`), `title`, `context` `{path, label}`, `pending` `{toolCallId, name, kind, input, summary, issuedAt, card, state}` or null (`state` = the model conversation to resume, images as references), `archivedAt`, `lastMessageAt`. The pending slot is set and cleared by single conditional UPDATEs.
- `chat_messages`: `thread`, `messageId` (unique per thread), `parentId`, `message`, `role`, `answer`, `feedback` (`up`/`down`), `feedbackReasons`, `feedbackNote`, `feedbackAt`.
- Admin read model: `chatFeedback(payload, workspace, {limit})` in `lib/chat/insights.ts`: rated answers with question, answer excerpt, tools, usage, thread and rater.

## UI notes

The assistant skill is read from `skills/assistant/SKILL.md` of `BAUHERR_PACK_DIR`, falling back to the built-in pack (the gated test pack has no skills). `#123` in an answer is a link to `/tickets/n/123` (UI route: the Ticket when the number is unique in the Workspace, else a chooser listing the Products). A feedback `POST` right after the answer waits for the client's save of that message (the UI chains them); the UI sends the reasons and note of a thumbs-down as `reasons` and `note`. Docked UI: [ui.md](ui.md#chat).

## Testing without a gateway

`CHAT_FAKE=1` (or `INTAKE_FAKE=1`; refused in production builds like the other fakes) answers with a scripted model; in request threads the interview is the scripted one of `lib/intake/fake.ts` (three answers make the draft ready; a first message containing `and also` proposes three separate tickets). In other threads any text is echoed as `[fake] you said: <text>`, a message containing `status` calls `factory_status`, `approve #<n>` calls `approve` for Ticket `<n>`, `comment #<n>: <text>` calls `post_comment`, and a tool result is acknowledged as `[fake] tool result: ...`.
