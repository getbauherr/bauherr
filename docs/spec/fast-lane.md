# Fast lane

The fast lane is the user-facing name of the expedite lane: label `bauherr:expedite`, `tickets.expedite`, synced by `poll-tickets`. Board: see [ui](../ui.md).

## Getting on the lane

- A human sets the label or presses "Put on the fast lane" on the Ticket page, `expedite` in `src/lib/actions.ts`. Only an Admin may, `canPutOnFastLane` in `lib/expedite.ts`.
- An urgent request does the same at filing. `submitIntake` labels the issue `bauherr:expedite-proposed`, the need "Expedite?", shown as "Fast lane for `<title>`?" at the top of the Inbox with the requester's `intake_sessions.urgentReason`. The gate sweep raises it without waiting for Triage.
- When the sender is an Admin, `submitIntake` creates the Ticket row, records the `expedite` touch and adds `bauherr:expedite`. The poller verifies the label like a button press.
- An urgent request needs type bug, a reason and the lane on, else `submitIntake` refuses it. A request split into several is never urgent.
- Triage can propose it with `expedite: true`. That puts `bauherr:expedite-proposed` on the Ticket and is never applied by itself.
- Settings > Factory > Workflow "Expedite lane", `workspaces.expediteLane`, default on. Off ignores the label with a Ticket comment. Removing the label returns the Ticket to the normal flow on the next poll.

## What the lane changes

- A Ticket without a stage skips Triage. `startExpedites`, every poll, moves it to `plan`, or straight to `build` when its body has a `## Plan` or `## Steps` section. See `lib/expedite.ts`.
- It enters Plan, Build and Review whatever the WIP limits say, in one extra slot per column.
- The overlap hold never holds it. Later overlapping Tickets wait for it.
- The plan gate is off for it. `advancePlan` accepts the plan and posts it for audit. The template is `plan/hotfix`, `pack/skills/plan/hotfix.md`.
- Human gates after Build are unchanged.
- Pull order: `claim_next`, `list_frontier` and `claim_run` put the Ticket the lane serves, `isExpediting`, first. Lease, blocked and own-build rules still apply. `heartbeat` carries `expedite: {ticket, run}` while such a Run is unclaimed.

## One at a time

One expedite Ticket per Workspace is in flight, from Plan to done. A second stays without a stage, first come first served, with a Ticket comment, and enters when the first is done.

A holder that is parked, with `needsYou` set and no queued, awaiting or running Run, yields its place to a waiting Ticket.

- `tickets.expediteYieldedTo` records it, with one comment `bauherr:expedite-yielded #n`. The holder keeps the flag, counts for no slot and gets no bypass.
- `startExpedites` clears the yield when the holder is unparked and no other Ticket holds the place, or it is closed or unflagged.
- A running holder, or a parked holder with nobody waiting, is unchanged.

## Preemption

`lib/preempt.ts`. The switch is `workspaces.preemptForHotfix`, default on, in Settings > Factory > Workflow "Pause running work for a hotfix".

When a claimable session Run of an expedite Ticket has no free connected session of its role, `preemptSweep` marks one victim. It runs every poll and every `expire-sessions` pass. A free session has no running Run and is within the role's `agents` cap.

- The victim is the running session Run of the same role with the latest `startedAt` whose Ticket is not expedite. The marks are `runs.preemptedBy`, `runs.preemptedFor` and `runs.preemptAt`.
- Check and mark run in one transaction under the advisory lock `(workspace, hashtext('preempt'))`. At most one victim is marked per expedite Run, and an ended or released victim still counts.
- With no session Run to pause, `pickVictim` marks a running autonomous Run of the role the same way. The Runner polls `preemptedRun` after each tool, stops at that boundary, pushes a Build Run's branch and ends `preempted`. `abandonRun` records `abandoned` and queues a fresh successor from the default branch.
- Every MCP answer to the victim's session carries `preempt: {ticket, run, reason: "hotfix #n"}`, one wrapper in `callTool`. The session writes its handoff, pushes, calls `release_run` and `claim_next`, which returns the hotfix first.
- `release_run` while marked ends the pause as `reasonKind: preempted`. The same Run goes back to `awaiting_session`, keeps `preemptedBy` and loses `preemptAt`. The next claim clears `reasonKind`, `preemptAt` and `preemptedFor`.
- A Run still marked 2 minutes after `preemptAt`, `PREEMPT_GRACE_MS`, is ended by the lease sweep, only while the hotfix Run is still `awaiting_session` and its Ticket still expedites. Otherwise the mark clears. A stale-heartbeat expiry of a marked Run ends the same way. `abandonRun` uses `reasonKind: preempted` and creates a successor with `previousRun` and the same `preemptedBy` and `preemptedFor`.
- `preempted` is never escalated and never turns a second abandon into `needs_human`. `escalate` returns false, there is no strong retry, and `previousStopped` ignores it.
- The preempted Ticket keeps its stage and WIP slot. Its resumed Run sorts first in its stage once no expedite Run goes before it, `resumed` in `frontier.ts`.
- Texts: "Paused for hotfix #n" on the status, Board card, progress comment and Run page "Preempted by #n". The hotfix reads "Starting: `<role title>` session pausing #m, up to 2 min" while the victim has not released.

## Gate notices

A gate on an expedite Ticket is notified in the pass that reached it. The release and review watchers call `syncGates` right after their sweep, and the minute sweep handles expedite Tickets first. One conditional UPDATE of `tickets.gateNoticeClaim` makes parallel passes post once. A forge error releases the claim. The comment reads `@owner: Hotfix, <gate> — <link>`.

## Skipping staging

Skipping staging is a human decision per Product: `products.expediteSkipStaging` on the Product page, default off, shown while the workflow has the staging gate.

- With it on, an expedite Ticket whose merge is on staging passes the Accept-on-staging gate by itself, `passStaging`, and opens the production gate at once.
- The touch `auto:staging:expedite-skip` names the setting and who enabled it and when, in `products.expediteSkipStagingBy` and `At`, written by `saveDeploy` when the toggle flips.
- Production approval always stays human. The factory never skips a gate for a Product that did not opt in.

## Lead time

`tickets.expediteAt` is set when the flag first appears. Factory health shows the mean of `releaseAt - expediteAt` over the last 5 merged hotfixes.
