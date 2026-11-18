# Gates and approvals

Human gates are config in the Workspace's factory file, `pack/factory.yaml` by default. `humanGates()` in `apps/server/src/lib/mode.ts` lists the enabled ones.

## Gates

| Gate | Default | Before | Approval lives in |
|---|---|---|---|
| Refine | Always on | Plan | Answers to Triage's decision sheet |
| Plan | On, `gate: human` on `plan` | Build | Label `bauherr:approved:plan`, set in the UI or the forge |
| MR | Factory, no human | Merge | Clean review, green checks, `## Evidence`, Product `autoMerge` |
| Staging | Optional, `gate: human` on `release` | Done, or production | Label `bauherr:approved:staging`, set in the UI |
| Production | On, `production_gate: human` on `release` | Deploy | UI gate or MCP `approve_production` |

- The shipped file asks the Product owner for refinement, and for staging acceptance per Product with `gate: {by: product-owner}`. A file without `gate` on `release` has no staging gate.
- A Product without `productionChecks` shows the gate "Configure production checks" until checks exist.
- With `production_gate` removed, a staging-confirmed Ticket goes to `done`. A Product can also turn the gate on with `productionGate`.
- The label `bauherr:approved:production` is an output signal only. The factory sets it after a production approval.
- A file without `gate: human` on `plan`, such as `tests/fixtures/bare-pack`, reaches a merged MR and the production gate without an owner touch.
- Per-Product overlays: see [Jobs and history](history.md).

## Who is asked

Every checkpoint is addressed to the Bauherr or the Product owner. Without `by:` it asks the Bauherr. A Bauherr or Admin can always decide for the Product owner. The key syntax, the fallback and `mayDecide` are in [People](people-checkpoints.md).

## Gate off

- Plan gate off: `advancePlan` in `poll-tickets` moves a Ticket in `plan` to `build`, or to `parent`. It needs a succeeded plan Run, a plan comment and no open critical decision. It adds no approval label, records no human touch and posts one audit comment. Sub-tickets are created with `bauherr:stage:build` only.
- Release gate off: `watch-release` runs the acceptance step itself once staging is confirmed. It then opens the production gate, else sets `done`, without a touch. `timed_out` stays a blocker.
- The needs-you values Approve plan, Answer decisions and Accept on staging appear only while their gate is on.
- With the plan gate off, an unanswered critical decision on a posted plan reopens the refine hold. Answering it re-plans, and the Ticket then proceeds without approval.

## Decision sheet

One sheet per Ticket per gate, in the newest plan or triage comment. Only answers posted after it count. Rows have recommended defaults and a `critical` flag. At most one human touch. Protocol: [decision-sheet](https://github.com/getbauherr/bauherr/blob/main/pack/skills/decision-sheet/SKILL.md).

## Plan format

- A plan starts with a required `## TL;DR` section. Its lines are `Decision:`, `Recommendation:`, `Why:` with 1 to 3 bullets, `Risk:`, and optionally `Options:`. Parser: `src/lib/tldr.ts`.
- `submit_plan` refuses a plan without them and lists the missing lines. Hotfix plans are exempt. The parsed block is stored as `tickets.planTldr`.
- An autonomous plan without TL;DR is posted anyway, and its card says to read the plan.
- A plan lists the paths it changes in `## Files`, one glob per line. `planFiles` in `app/(app)/lib/plan.ts` parses it. Only paths count, so the rule is language-agnostic.
- Every checkpoint shows as a prepared Decision, see [ui](../ui.md#decision-card).

## Gate labels

The factory accepts `bauherr:approved:plan` and `bauherr:approved:staging` only from a trusted actor. The list is in `apps/server/src/lib/gate-labels.ts`.

| Actor of the latest `labeled` event | Result |
|---|---|
| A login linked to a person who may decide, see the forge channel in [People](people-forge.md) | Accepted, human touch recorded with that login |
| The factory credential, with a recorded touch `approve:plan`, `approve:inherited` or `accept:staging` written before the label | Accepted |
| Anyone else | Label removed, one comment `bauherr:label-rejected:<label>:<time>` points at the Approve button, the Ticket does not advance |
| Unreadable, events call failed | Not approved, label kept, checked on a later poll |

- Agent sessions under the owner's own token are rejected like strangers.
- A solo owner whose login equals the factory credential approves in the UI or MCP, not by hand.
- The plan label of a gate that is off is stripped the same way.

## Stage labels

Stage labels are trusted for backward moves only.

- `poll-tickets` accepts a forward move only when the factory recorded it in `tickets.factoryStage` before the label. The field clears on the next poll that sees the label equal it or change.
- Forward order: triage, plan, build, review, release, done.
- An unrecorded forward move is reverted to the stored stage with one comment `bauherr:stage-rejected:<stage>:<time>` and starts no Run. The first sight of a Ticket is accepted.
- An open critical decision holds the Ticket at the plan-to-build move. Other forward moves are not blocked by it.
- Owners move forward through the UI.

## Send back

A Bauherr or Admin can send an open Ticket in `plan`, `build`, an `agent` stage, `review` or `release` back. Targets are earlier stages its outcomes lead to, or the Backlog, from `sendBackTargets`. A note is optional.

- A Product owner can only send a Ticket from staging to Build, through Request changes.
- One conditional UPDATE of the stage claims the move, so a double submit moves once.
- Live Runs end `cancelled`. There is no `Run failed`, no escalation and no successor.
- `moveStage` makes it a recorded move, so the poller does not revert it.
- The note is posted as "Sent back to `<stage>` by `<person>`: `<why>`". One `sendBack` transition and the touch `send-back:<stage>` are recorded.
- The target stage starts as for any entry. A plan target drops the plan approval. Leaving `release` clears release and production state.
- WIP limits do not apply.

Gate tools over MCP are human-only: `approve`, `accept_staging`, `grant_review_round`, `stop_review`, `request_changes`. `/mcp` refuses an agent key, see [session mode](../session-mode.md#agent-identity).

## Sub-tickets

A plan may end with `## Sub-tickets`, one item per child: `- **Title** — one-line body`. Indented lines continue the body, for example acceptance criteria.

- An indented `after: <sibling title>` line, with the exact title of another item, blocks the child on that sibling through forge `addBlockedBy` and `tickets.blockedBy`. `claim_next` and the frontier skip it until the sibling closes. An unknown title is ignored with a warning. There is no implicit chain.
- On plan approval, by UI, MCP `approve` or the label, the factory creates each item as a forge sub-issue with `addSubTicket`. GitLab Free has none and uses a `Parent: #n` body line.
- Children get `bauherr:stage:plan` and `bauherr:approved:plan`, so Build starts without a second approval. `tickets.inheritedApprovalFrom` records it.
- Only items listed at approval inherit. A child created later gets no label from the factory. A label a human sets on a child is an ordinary approval.
- Creation is idempotent. Children are matched by title, also against local rows whose forge link failed, which are only linked. The parent leaves `plan` only after all exist.
- The parent moves to stage `parent`, shown as "Split" on the Board with n/m done and no Runs. `poll-tickets` closes it with a comment listing the children once all are closed.
- Nested children and moving children between parents are out of scope.
- A parent without children and without `tickets.epic` is split as an [epic](epics.md).

## Notifying the gate's person

Every needs-you value is a human gate. The task `notify-gates` runs every minute.

- It assigns the gate's people on the forge issue: Bauherren and Admins with a linked `githubLogin`, or the assigned Product owners where the gate asks them.
- It posts one comment `bauherr:gate:<value>:<sha1 of value+run id>` that mentions them and links the Ticket page at `PUBLIC_URL`.
- Once per gate value, tracked in `tickets.gateNotified` and `gateNotifiedAt`. Approve plan and Answer decisions count as one gate. There are no reminders.
- When the gate passes or changes, the factory unassigns exactly the logins it added in `tickets.gateAssignees` that do not own the next gate.
- Failed claims retry every minute. A gate counts as notified only when every owner is assigned.
- Without owners nothing is notified. When every owner is rejected for good, `tickets.gateUnreachable` shows "no reachable owner" and the task retries.
- A login with a running session Run stays assigned. A session Run's release unassigns only its own login.
