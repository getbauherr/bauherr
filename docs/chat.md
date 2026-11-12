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
| `POST /threads` | `{path?}` or `{ticket}` | `201 Meta`; `path` sets the starting context. `{ticket: <Ticket id>}`: the person's one thread of that Ticket, `200` (created on first use, an archived one comes back), `404` for a Ticket of another Workspace |
| `GET /threads/:id` | | `Meta` |
| `PATCH /threads/:id` | `{title?: string \| null, archived?: boolean}` | `Meta` |
| `DELETE /threads/:id` | | `204`; messages go with it |
| `GET /threads/:id/messages` | | `{context, ticket, pending, messages: [{parentId, message, answer, feedback}]}` oldest first |
| `PUT /threads/:id/messages` | `{parentId?, message, answerId?}` | `204`; upsert by `message.id` |
| `POST /threads/:id/run` | `{messages, context: {path}}` | NDJSON stream |
| `POST /threads/:id/confirm` | `{toolCallId, approved, reason?}` | NDJSON stream; `409` nothing matching to confirm |
| `POST /threads/:id/feedback` | `{messageId, value: 'up' \| 'down' \| null, reasons?: string[], note?: string}` | `204`; `null` withdraws |
| `POST /media` | multipart `file` (png, jpeg, webp) | `201 {id, url}` |
| `GET /context?path=/tickets/12` | | `{label, markdown}` |

`Meta` = `{id, title, archived, lastMessageAt, createdAt, context: {path, label} | null, ticket: <Ticket id> | null}`. `pending` (in `GET messages`) = `{toolCallId, name, kind, input, summary, title, details, destructive}` or `null`: restore the card after a reload.

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

- **Questions are not answered here.** The Ticket's open points (decision sheet rows) are answered in the conversation shell of the Ticket page, [below](#refinement-conversation); the dock's Ticket thread only serves `/comment` and the helper's reads. Messages typed in the panel never reach this thread or the helper model, and the helper's thread list does not list the panel's thread.
- **Comments**: two ways, both end in `postComment` (text plus one `![name](url)` line per image, images marked sent before the forge call and released on failure). (1) The model drafts: `post_comment` is a `confirm` tool, the person approves a card showing the Ticket, stage and the text, only the stored call runs. (2) Direct, no model: `/comment <text>` in the composer of a Ticket thread (`postDockComment` over `postCommentFromChat`); images pasted into the composer are chat uploads (`/api/chat/media`), and the action adopts the unused ones of the Workspace as this Ticket's comment images (same limits as the comment box: `mediaLimits()`, at most `maxPerSession` per comment). Comment mode is the dock opened by the Ticket page's "Comment" button with `/comment ` already in the composer.

## Refinement conversation

One conversation per person and Ticket that holds Triage's open points, in the **conversation shell** (`components/conversation/`): the page of a Ticket that waits for answers (label `bauherr:needs-refinement` and a decision sheet) IS the conversation; `?view=conversation` opens it for any Ticket with a sheet (read-only after sending), `?view=ticket` the normal Ticket page. The Inbox card is a short card whose "Answer questions" is a link to it. Bauherr and Admin only (no product-owner route or action; not on the reduced Ticket page). No dock opens for it.

- **Engine** (`lib/refine/engine.ts`, pure parts in `lib/refine/model.ts` and `artifact.ts`): every typed message is one turn of the refinement model (the conversation's tier of the Workspace through the gateway, `chatModelFor(payload, ws, tier)`, the call forces the tool `refine`; the helper model never sees it). The turn ends with ONE `refine` result: `reply`, `settled[]`, `dropped[]`, `added[]` (max 3 per turn, max 10 open), optional `ticket` edits (`title`, full `body`; every `<!-- bauherr:... -->` marker must stay) and `next`. The prompt asks the model to write every settled answer into the Ticket text (its section, or a new `## Decisions`), so the artifact is the refined Ticket. `normalizeRefine` validates the whole result (all or nothing); one retry, then the turn fails and changes nothing. A valid result is applied with one `postDecisions` call; the text edits wait in the session (`draft.edits`, `draft.version {n, at}`) until "Send to planning".
- **Artifact** (`buildArtifact`): the sections (`#`/`##`/`###` headings, text before the first heading is "Summary") of the pending text (Ticket text plus `draft.edits`), diffed section by section against the Ticket's current text: a section whose text differs or that is new is `changed`, a removed one is a hunk too, `changes` counts hunks plus a title change. Every open point gets a placeholder section ("Waiting for your answer: ..." for the first, "Open: ..." for the rest) before the acceptance criteria. Settled points without a text edit show in the checklist only. The version chip is `v<1 + applied edits>` with the time of the last one. After sending, the Ticket text is the sent one and nothing is marked.
- **Points** are the sheet's rows plus rows the conversation added; status `open`, `answered` or `dropped` comes from the decisions Comment (`D<n>: <answer>`, a dropped point `D<n>: (no longer needed) <reason>`; added points are canonical rows under `## Decisions`). Old sheets parse unchanged.
- **Streaming** (`POST /api/refine/<ticket>/turn`, body `{ text, images? }` or `{ recheck: { point } }`; NDJSON `reply`, then `done {view}` or `error`): the person's message and an "is writing" message appear at once (`useRefineTurn`, layout-neutral); nothing is applied or stored until the whole result is valid; **Stop** aborts the request.
- **Re-check after an option click** (`refineRecheck`): one short turn that may only drop points or ask one differently; its text is not streamed (one quiet line "Checking the remaining points..."), nothing is stored when nothing changed.
- **No model call**: an option click, "Why this matters" (the stored `Why:`), "Use recommended" (one write) and "Change". They store a message whose `speaker.model` is null.
- **Model**: the model chip lists the Workspace's tier models (`modelByTier`, defaults `DEFAULT_MODEL_BY_TIER`); the choice is stored on the session (`draft.tier`, action `refineTier`, default `standard`), used by every later turn and shown on every message and in the header. **Cost**: the sum of the stored usage of the turns (`chat_messages.answer`), priced with the cost catalog (`priceOf`); "unpriced" when a model has no price. The chip opens the breakdown per turn.
- **Images**: pasted, dropped or attached images go to `/api/chat/media`; their ids ride along with the text (`images`, at most 4, of the Workspace), are stored on the message (`metadata.custom.images`, shown as thumbnails) and sent to the model as base64 image blocks of that turn (`withImages`). Earlier turns' images are not sent again.
- **Request contract**: `tests/helpers/anthropic-contract.ts` checks every body `chatBody` builds (model and `max_tokens` set, no forced `tool_choice`, first message from the user, no empty content or text block, base64 image blocks of png, jpeg, gif or webp and never an unresolved reference, tools with a name and an object `input_schema`); `tests/anthropic-contract.test.ts` covers an image block and the tier's model.
- **Send to planning** (`refineSend` -> `finishRefinement`): refused while a point is open; applies the edits, releases the hold the way the last decision row did; the session ends `submitted`, the shell becomes read-only and the foot says where the Ticket is now.
- **Storage**: the `intake_sessions` row of persona `owner` (`draft.ticket`, `draft.edits`, `draft.tier`, `draft.version`) is the session; messages are `chat_messages` of a `chat_threads` row linked by `intakeSession`, in assistant-ui's exported shape with `metadata.custom = { speaker, images?, settled? }` (`speaker = { kind: session|assistant|person, role, avatar, session, live, run, model, at }`, `settled` the ids of the points a message settled, shown as chips under it).
- **Who speaks**: the role is the persona (avatar, "Orchestrator"); the executor is shown on every message: the Triage session that asked (presence dot, "asked in Run #n") or the "Factory assistant" for a server-side reply, with model and time. The agent session is never shown as the author of a server-side reply. The header line says "<session> asked · Factory assistant replies · <model>"; its chevron opens the agent card.
- **Tests**: `tests/refine-artifact.test.ts` (section diff, placeholders), `tests/refine-engine.test.ts` (tier stored and used, cost, images), `tests/refine-model.test.ts`, `e2e/conversation.spec.ts` (own Workspace `conv`; `CHAT_FAKE=1`: the fake model reads `refine:{json}` in the typed text as the whole result, any other text settles the first open point, `hold:` makes the reply wait until `POST /api/chat/fake-gate`; `GET /api/chat/fake-requests` lists the requests the fake got: model, text, image count).

## Request conversation

Request drafting is not a chat thread: it is the [request conversation](ui.md#request-conversation) in the conversation shell, on the intake engine alone (`lib/intake/engine.ts`, its prompts and templates unchanged; the embeddable widget keeps its own surface). The `intake_sessions` row (`persona: product-user`, `user` = the person) holds everything: `messages` (with `at` and, for answers, `usage`), `draft`, `split`, `turn` (`{question, options, ready, missing, changed}`), `edited`. Code: `lib/request-conversation.ts`, `app/api/requests/`.

- **Starting**: `startDraft()` reuses the person's empty draft (no message, no card) or creates one (at most 20 sessions per person and hour); the Product is the first they may see (`productsVisibleTo`) or the chosen one until the first message. `pruneEmptyRequests()` deletes empty drafts older than an hour in the daily `prune-comment-media` job (and the legacy request threads without a message).
- **A turn** (`POST /api/requests/:id/turn`, body `{text, images?}`, NDJSON `reply` / `done {view}` / `error`; 404 for a request that is not the person's): `requestTurn()` adopts the uploaded images (`POST /api/requests/media`, same Workspace, at most `MEDIA_MAX_PER_SESSION` in all) and runs one interview turn (`advance()`, under the `intake:<id>` lock): the next question with its suggested answers, the updated card, and what changed. The gateway call streams (`gatewayModel` with `onPartial`; the fake model streams its JSON in chunks); an abort or an invalid answer stores nothing. The model is the Workspace's standard tier.
- **The view** (`RequestView`, answered whole by every action): card (`CardData`, with `needs` and `changed`), messages (`Msg` of the refinement, so `costOf` and the stream are shared), the last question's `options`, the foot's `status` and `next`, the `handoff` after filing.
- **Actions** (server actions, open to a Product owner too): `requestState`, `requestChange` (a card edit or one screenshot removed), `requestSubmit` (`submitIntake`: the engine decides completeness, a question or an incomplete card is refused with the reason), `discardIntake`. A person sees only their own requests of Products they may see (`ownSessionOf`: a Product owner never another Product's, the same refusal as a missing id).
- **Not in the dock**: the dock no longer has request threads, the `submit_request` tool, the `options` event or the Product card. `chat_threads.request` stays in the schema, unused.


## Stored shapes

- `chat_threads`: `workspace`, `owner`, `ticket` (nullable; unique with `owner`), `request` (boolean, unused since request drafting left the dock), `intakeSession` (nullable; unique with `owner`: the refinement conversation of a Ticket), `title`, `context` `{path, label}`, `pending` `{toolCallId, name, kind, input, summary, issuedAt, card, state}` or null (`state` = the model conversation to resume, images as references), `archivedAt`, `lastMessageAt`. The pending slot is set and cleared by single conditional UPDATEs.
- `chat_messages`: `thread`, `messageId` (unique per thread), `parentId`, `message`, `role`, `answer`, `feedback` (`up`/`down`), `feedbackReasons`, `feedbackNote`, `feedbackAt`.
- Admin read model: `chatFeedback(payload, workspace, {limit})` in `lib/chat/insights.ts`: rated answers with question, answer excerpt, tools, usage, thread and rater.

## UI notes

The assistant skill is read from `skills/assistant/SKILL.md` of `BAUHERR_PACK_DIR`, falling back to the built-in pack (the gated test pack has no skills). `#123` in an answer is a link to `/tickets/n/123` (UI route: the Ticket when the number is unique in the Workspace, else a chooser listing the Products). A feedback `POST` right after the answer waits for the client's save of that message (the UI chains them); the UI sends the reasons and note of a thumbs-down as `reasons` and `note`. Docked UI: [ui.md](ui.md#chat).

## Testing without a gateway

`CHAT_FAKE=1` (or `INTAKE_FAKE=1`; refused in production builds like the other fakes) answers with a scripted model; the request conversation's interview is the scripted one of `lib/intake/fake.ts` (it streams its JSON in chunks and reports fixed usage as the Workspace's standard tier model; the first answer offers two suggested answers; three answers make the draft ready; a first message containing `and also` proposes three separate tickets, `Question:` makes the draft a question, `outage` makes it an urgent bug with a reason). In other threads any text is echoed as `[fake] you said: <text>`, a message containing `status` calls `factory_status`, `approve #<n>` calls `approve` for Ticket `<n>`, `comment #<n>: <text>` calls `post_comment`, and a tool result is acknowledged as `[fake] tool result: ...`.
