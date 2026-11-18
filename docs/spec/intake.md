# Intake, templates and progress

## Templates

Every text written for people has a template in `pack/templates/`: `request`, `plan`, `decision`, `review`, `staging-summary`, `release-note`, `worklog`, `triage-questions`, `progress`. A Workspace overrides them in Settings > Templates, table `templates`, one row per Workspace and name.

- `template()` and `renderTemplate()` render the staging summary, release notes, request issue body, triage sheet, worklog start and decision comment. A default template produces the text the factory wrote before.
- Agents get the same structure. `load_skill` appends the skill's templates under `## Template: <title>`. `SKILL_TEMPLATES` maps run-contract to plan and worklog, review to review, triage to triage-questions and intake to request.
- The autonomous Runner receives them in `RunCtx.templates` and appends them to the materialised skills.
- The plan's TL;DR is found by the Workspace template's current heading text, default `TL;DR`.

## Intake

The embeddable widget calls the intake API. The signed-in app files requests in the request conversation, which calls the same engine, `advance` and `submitIntake`, in-process. See [chat](../chat.md#request-conversation).

| Endpoint | Purpose |
|---|---|
| `POST /intake/api/sessions` | Start, with the Product |
| `POST .../:id/messages` | One interview turn, SSE `turn` event |
| `POST .../:id/submit` | Create the Ticket |
| `GET .../:id` | Resume: status, messages, draft, split, last turn |

- The engine asks one question per turn through the gateway, standard tier, at most 6. Skill: [intake](https://github.com/getbauherr/bauherr/blob/main/pack/skills/intake/SKILL.md).
- The engine computes completeness, not the model: problem, context, at least 2 criteria, and a screenshot for screen requests.
- Submit creates the Ticket without a stage label, so Triage picks it up. It has `type:` and `product:` labels, an `## Open` section for gaps and the interview as a comment.
- A request with several independent problems gets a `split` of 2 to 6 drafts, each checked on its own. The requester confirms the count, and submit with `{ expect: N }` is refused with 409 when N differs.
- A split creates one Ticket per item, with marker `session=<id> part=<i>` so a retry never duplicates. Each gets the interview, the screenshots and an `intake-siblings` comment listing the others.
- The Requests page lists the requester's open drafts. The conversation resumes from the stored session.

### Persona owner

The refinement conversation of a Ticket starts it while the decision sheet has points. See [chat](../chat.md#refinement-conversation).

- It is an `intake_sessions` row with persona `owner` and `draft.ticket`. Its messages are in a `chat_threads` row linked by `intakeSession`.
- Points are the sheet's rows, critical first with the default marked recommended, plus rows the conversation added. A point is `open`, `answered` or `dropped`, written `D<n>: (no longer needed) <reason>`.
- A click on an option, "Why does this matter?" and "Use the recommended answers for the rest" need no model call.
- Every typed message is one turn of the refinement model. It ends with one validated `refine` result: settled, dropped, added points, optional ticket text edits, next. `postDecisions` applies it, the same `bauherr:decisions` comment and worklog Decisions as the MCP tools, without releasing the hold.
- "Send to planning" applies the text edits, releases a Triage hold as the last answered row does, and ends the session `submitted`.

## Progress comment

A person who files an issue may never open the factory. The factory says in plain words where the issue is.

- `progressOf(wf, ticket, facts, template)` in `lib/progress.ts` derives one of 15 keys: received, question, planning, approval, building, reviewing, agent, human, staging, waiting, released, stuck, closed, split, blocked.
- Inputs are `ticketStatus()`, the one status every page shows, plus stored `needsYou`, `liveness` and release fields, by stage kind. A custom `agent` or `human` stage uses its `title`. Stage names never appear.
- Text comes from the Workspace's `progress` template: one section per key. First line is the headline, a `Next:` line is the next step, other lines are detail. `{{placeholder}}` lines drop out when empty.
- `syncProgress` keeps one comment marked `bauherr:progress`, edited in place: headline, detail, next step and the six-step path Received, Planned, Built, Reviewed, On staging, Released.
- The body hash is claimed on `tickets.progressHash` before the write and released if it fails. An unchanged state makes no forge call. The first post lists once to adopt an existing marked comment, then `tickets.progressCommentId` is used. A forge failure is logged and retried by the next sweep.
- Only the `sync-progress` job writes the first comment. `record()` queues it for every non-sweep transition, 3 retries, throwing when the forge refuses. An upgrade posts nothing on untouched issues.
- The `notify-gates` sweep only heals Tickets that already have a progress comment, open ones and closed ones for 2 days. It never creates one. No request path calls the forge.
- Editing mails nobody. On arrival at `question`, `staging`, `released` or `stuck`, one new comment `bauherr:progress-notice:<key>` mentions the issue's author, `Ticket.author`, only them. It posts once per arrival, tracked in `tickets.progressNotified`, cleared when the Ticket leaves the key. A second `stuck` episode posts again.
- Nobody is mentioned when the author is the factory account or a bot. Intake issues are filed by the factory credential. The same holds for a gate owner that `syncGate` already mentioned.
- The switch is `workspaces.progressComments`, Settings > General, default on. Off means no comment and no notice. There is no per-Product override.
