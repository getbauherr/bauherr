# Chat

One assistant chat is docked on every page. Open it with the Ask button or `Ctrl/Cmd+J`. Code is in `apps/server/src/lib/chat/` and `apps/server/src/app/api/chat/`.

## What it knows

The assistant sees the page you are on, limited to your current Workspace. The chip above the composer shows that context. The server builds it from the path alone, so the client never sends page content.

Ask about Tickets, Runs, the Workflow, Insights, the Knowledge base or who is working right now. Write `#123` to refer to a Ticket. A number that exists in several Products returns a list to choose from.

Text from Tickets, worklogs and Knowledge reaches the model fenced as untrusted data. It cannot give the assistant orders.

## Confirmations

The assistant reads freely but never writes on its own. These actions need your approval:

`approve`, `accept_staging`, `approve_production`, `grant_review_round`, `stop_review`, `request_changes`, `send_back`, `approve_skill_proposal` and `post_comment`.

1. The assistant proposes the action and the stream ends with a card.
2. The card shows the Ticket, the stage and what happens next.
3. Approve runs exactly the stored call as you, once. Decline asks for an optional reason.

A gate for a Ticket that is not at that gate is refused before any card appears. A new message discards an unanswered card.

Agent session tools such as claim, heartbeat and finish are not available in chat.

## Images and feedback

Paste, drop or attach up to 6 images per message in png, jpeg or webp. Thumbs up sends at once. Thumbs down opens reasons and a note. Admins read the ratings at `/settings/chat-feedback`.

## Limits

- 60 runs per person and hour.
- 100 messages and 8000 characters per message.
- Every answer shows model, tokens, cost and time.

## Ticket threads

A Ticket thread is your conversation about one Ticket. There is one per person and Ticket, and it brings itself back from the archive.

The Ticket's open questions are answered in the [refinement conversation](#refinement-conversation) on the Ticket page. The thread serves comments and reads.

To comment you have two ways. Ask the assistant to draft one and approve the card. Or type `/comment <text>` in the composer of a Ticket thread, which posts without a model. Pasted images are attached to the comment.

Slash commands are `/context`, `/new`, `/request` and `/help`.

## Refinement conversation

When Triage has open points, the Ticket page for a Ticket labelled `bauherr:needs-refinement` is a conversation. `?view=conversation` opens it for any Ticket with a decision sheet, and `?view=ticket` opens the normal page. Only a Bauherr or Admin sees it.

- Type an answer, click an option or choose Use recommended. Why this matters shows the reason behind a question.
- The refinement model settles, drops or adds points and rewrites the Ticket text. It adds at most 3 points per turn and keeps 10 open at most.
- The artifact beside the stream is the refined Ticket. Changed sections are marked and each open point has a placeholder.
- Choose a model tier in the header. The cost chip sums the turns and opens a breakdown per turn.
- Stop aborts a running turn and stores nothing.
- Send to planning is refused while a point is open. After it, the conversation is read-only and the foot says where the Ticket is.

A reply is only applied when the whole result is valid. A bad result is retried once, then the turn fails and changes nothing.

## Request conversation

`/requests/new` opens a conversation with the Factory assistant that drafts a request. It uses the intake engine and is not a chat thread. The [UI guide](ui.md#request-conversation) describes the screen.

- Each turn asks the next question with suggested answers and updates the request card.
- You can edit the card by hand, and the next turn keeps your edit.
- Up to 20 drafts per person and hour. An empty draft is deleted after an hour.
- A Product owner uses the same page, with their Products only and the Workspace's standard model.
- Images go to the same media store as chat. Several problems in one message file as several Tickets.

## Testing without a gateway

`CHAT_FAKE=1` or `INTAKE_FAKE=1` answers with a scripted model. Production builds refuse it.

- Any text is echoed as `[fake] you said: <text>`.
- A message with `status` calls `factory_status`. `approve #<n>` calls `approve` and `comment #<n>: <text>` calls `post_comment`.
- In the request conversation three answers make the draft ready. `and also` in the first message proposes three tickets, `Question:` makes it a question and `outage` makes it an urgent bug.
- In a refinement conversation, `refine:{json}` in the text is the whole result.
