# Docked chat assistant and owner chat

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- One assistant docked on every page of the shell, opened by the Ask button or `Ctrl/Cmd+J`. It saw the current page and Workspace; the server built the context from the path alone, the client sent no page content. `#123` referred to a Ticket.
- Read tools: `factory_status`, `list_tickets`, `team_status`, `cost_summary`, `get_run`, `list_frontier`, `get_ticket`, `read_worklog`, `read_knowledge`, `search_knowledge`. Text from Tickets, worklogs and Knowledge reached the model fenced as untrusted data.
- Write tools never ran on their own. These stopped on a confirmation card: `approve`, `accept_staging`, `approve_production`, `decide`, `grant_review_round`, `stop_review`, `request_changes`, `send_back`, `post_comment`, plus Admin-only `approve_skill_proposal` and `reject_skill_proposal`. Approve ran the stored call once as the user. A gate for a Ticket not at that gate was refused before a card appeared. A new message discarded an unanswered card.
- Stored threads: a plain thread, one thread per person and Ticket, and one per person and request. Slash commands `/context`, `/new`, `/request`, `/help`, and `/comment <text>` which posted without a model.
- Limits: 60 runs per person and hour, 100 messages, 8000 characters, up to 6 images (png, jpeg, webp). Every answer showed model, tokens, cost and time.
- Feedback: thumbs up sent at once; thumbs down asked for reasons and a note. An Admin read ratings at `/settings/chat-feedback`.
- Owner chat on the ticket page: the refinement conversation (`?view=conversation`) beside the refined Ticket text, with a model tier choice, a per-turn cost chip and Stop. A Product owner had no chat at all (`chatWho` refused them, 403).

## The requirement behind it

- Ask about the factory in words instead of reading several pages (#484, #488).
- Act on a Ticket (approve, send back, comment) without leaving the conversation, with a human confirmation (#510, #631).
- One chat surface for requests and comments (#510); owner answers to Triage questions as one conversation (#521, #531).
- Owner feedback on answers, to improve the assistant.

## Where the code is

- `apps/server/src/lib/chat/` (tools.ts 331, engine.ts 233, context.ts 173, stream.ts 144, threads.ts 128, fake.ts 91, http.ts 56, insights.ts 44, collections.ts 41; 1241 lines in all).
- API: `apps/server/src/app/api/chat/` (threads, threads/[id]/messages, run, confirm, feedback, media, context, fake-gate, fake-requests).
- UI: `apps/server/src/app/(app)/components/chat/` (ChatDock, ChatPanel, thread.tsx, tools.tsx, feedback.tsx, dock-state.ts, 1424 lines in all), `components/assistant-ui/`, `components/conversation/` (1135 lines), `settings/chat-feedback/page.tsx`.
- Collections: `chat_threads` (owner, ticket, intakeSession, context, pending confirmation) and `chat_messages` (thread, assistant-ui message verbatim, answer with model, tokens, costUsd, ms, toolCalls, feedback) in `apps/server/src/lib/chat/collections.ts`.
- Reuses `mcpTools` from `apps/server/src/lib/mcp-tools.ts`. Chat cost is read from `chat_messages.answer.costUsd` by the cost views.
- Tests in `apps/server/tests/`: `chat.test.ts`, `chat-guard.test.ts`, `chat-stream.test.ts`, `chat-ticket.test.ts`, `migrations-chat-requests.test.ts`.
- Docs: `docs/chat.md`, `docs/ui.md` (Chat).

## Why it was cut

The lean core asks the owner through cards with fixed options; a free chat is not part of the decision path. On 2026-11-12 the owner also asked for chats embedded where they are needed, not a page-independent dock.

## What a module on the new core needs

- Core contracts: read the mirror and the record store only; for actions, hand a chosen option to the lifecycle engine as a Card answer. A chat must never write the record or the forge itself.
- Liftable almost unchanged: the confirm-card flow (`describe`, `resolveInput`, `runChatTool` in `tools.ts`: propose, store the call in `pending`, run it once on approve), the untrusted-data fencing, `chat_messages` with per-answer cost, the rate limits in `http.ts`, the feedback form.
- To design again: the tool set against the nine MCP tools and the record (the old tools wrap Payload collections and the old gate tools); embedding in the place of use (Brief, Result, Question card) instead of a dock; page context from the card, not the path.
- Traps: a gate tool must check that the Ticket is at that gate before the card (#622: open decisions only while the plan gate is open); a new message must drop the pending card; chat cost is not in `usage_entries`, it is read at query time (inferred: it would be lost if messages are pruned); the `assistant-ui` message is stored verbatim and the answer id must be matched when the client stores it; the docked chat must stay closed to Product owners.
