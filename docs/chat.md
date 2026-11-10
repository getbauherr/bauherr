# Factory chat (server contract)

One assistant chat on every page. This file is the contract the UI builds against; code is in `apps/server/src/lib/chat/` and `apps/server/src/app/api/chat/`. The UI is assistant-ui (`useRemoteThreadListRuntime` + `useLocalRuntime` with a `ChatModelAdapter` that reads the NDJSON stream).

## Rules

- **Auth**: the session cookie (or an API key) of a Bauherr. The Workspace is the `bauherr-ws` cookie checked against the person's memberships, else their first Workspace. No session: `401`. A thread of another Bauherr or another Workspace is `404`, the same as one that does not exist.
- **Tool widgets are chosen by `kind`** (`read` | `confirm`), never by tool name.
- **Confirmation rule**: a `confirm` tool never runs in the turn that asks for it. The server resolves and stores the exact call (`thread.pending`), sends a card and ends the stream. Only `POST .../confirm` with the stored `toolCallId` runs it, as the confirming person, exactly once and exactly as stored (name and input; the model cannot change it). A wrong or already answered id is `409`. A new run in the thread discards an unanswered card.
- **Context rule**: the page context is built on the server from the `path` only, limited to the current Workspace; the client never sends page content. An id of another Workspace reads as `Not found`. At most 1500 characters. It goes into the system prompt as a `<page>` block; the person's text and tool results go only into user turns.
- **Untrusted text**: Ticket bodies, goals, worklogs, evidence and knowledge snippets in tool results are wrapped in an `<untrusted-data>` fence.
- **Tickets are addressed by number** in tool inputs (`ticket: 123`, optional `product` slug). A number shared by several Products answers `{ambiguous, candidates}` instead of acting.
- **Usage**: every answer carries model, tokens, cost (`null`: no gateway price is known) and time.

## Routes

All under `/api/chat`, JSON unless noted.

| Route | Body | Answer |
|---|---|---|
| `GET /threads?archived=1` | | `{threads: Meta[]}` own, newest message first, at most 200; archived only with `archived=1` |
| `POST /threads` | `{path?}` | `201 Meta`; `path` sets the starting context |
| `GET /threads/:id` | | `Meta` |
| `PATCH /threads/:id` | `{title?: string \| null, archived?: boolean}` | `Meta` |
| `DELETE /threads/:id` | | `204`; messages go with it |
| `GET /threads/:id/messages` | | `{context, pending, messages: [{parentId, message, answer, feedback}]}` oldest first |
| `PUT /threads/:id/messages` | `{parentId?, message, answerId?}` | `204`; upsert by `message.id` |
| `POST /threads/:id/run` | `{messages, context: {path}}` | NDJSON stream |
| `POST /threads/:id/confirm` | `{toolCallId, approved, reason?}` | NDJSON stream; `409` nothing matching to confirm |
| `POST /threads/:id/feedback` | `{messageId, value: 'up' \| 'down' \| null, reasons?: string[], note?: string}` | `204`; `null` withdraws |
| `POST /media` | multipart `file` (png, jpeg, webp) | `201 {id, url}` |
| `GET /context?path=/tickets/12` | | `{label, markdown}` |

`Meta` = `{id, title, archived, lastMessageAt, createdAt, context: {path, label} | null}`. `pending` (in `GET messages`) = `{toolCallId, name, kind, input, summary, title, details, destructive}` or `null`: restore the card after a reload.

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
{"type":"tool-result","id","ok","result"}                                                      read tools: right after; result is a string of at most 4000 characters
{"type":"confirm","id","name","title","details":[{"label","value"}],"destructive"}             a card; the stream then ends with done
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

`kind` is fixed per tool; the model never sees it. Reads (`read`): `factory_status`, `list_tickets`, `get_run`, `list_frontier`, `get_ticket`, `read_worklog`, `read_knowledge`, `search_knowledge`. Owner decisions (`confirm`): `approve`, `accept_staging`, `approve_production`, `grant_review_round`, `stop_review`, `request_changes`, `approve_skill_proposal`. Session-run tools (claim, heartbeat, report, submit, finish ...) are not exposed (`tests/chat-guard.test.ts`). Every call, read or write, writes a `tool_calls` row. A gate for a Ticket that is not at that gate is refused before any card.

## Stored shapes

- `chat_threads`: `workspace`, `owner`, `title`, `context` `{path, label}`, `pending` `{toolCallId, name, kind, input, summary, issuedAt, card, state}` or null (`state` = the model conversation to resume, images as references), `archivedAt`, `lastMessageAt`. The pending slot is set and cleared by single conditional UPDATEs.
- `chat_messages`: `thread`, `messageId` (unique per thread), `parentId`, `message`, `role`, `answer`, `feedback` (`up`/`down`), `feedbackReasons`, `feedbackNote`, `feedbackAt`.
- Admin read model: `chatFeedback(payload, workspace, {limit})` in `lib/chat/insights.ts`: rated answers with question, answer excerpt, tools, usage, thread and rater.

## UI notes

The assistant skill is read from `skills/assistant/SKILL.md` of `BAUHERR_PACK_DIR`, falling back to the built-in pack (the gated test pack has no skills). `#123` in an answer is a link to `/tickets/n/123` (UI route: the newest Ticket with that number in the Workspace). A feedback `POST` right after the answer waits for the client's save of that message (the UI chains them); the UI sends the reasons and note of a thumbs-down as `reasons` and `note`. Docked UI: [ui.md](ui.md#chat).

## Testing without a gateway

`CHAT_FAKE=1` (or `INTAKE_FAKE=1`; refused in production builds like the other fakes) answers with a scripted model: any text is echoed as `[fake] you said: <text>`, a message containing `status` calls `factory_status`, `approve #<n>` calls `approve` for Ticket `<n>`, and a tool result is acknowledged as `[fake] tool result: ...`.
