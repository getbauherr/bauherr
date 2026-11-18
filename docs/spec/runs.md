# Runs

## States

`queued → running → succeeded | failed | cancelled | needs_human | budget_exhausted | abandoned`

| State | Meaning |
|---|---|
| `cancelled` | The Ticket was closed, moved back, or a human claimed it |
| `budget_exhausted` | The gateway answered 429, the Workspace budget is used up. Terminal, no retry |
| `abandoned` | The lease expired, or a hotfix took the session. Terminal, not rerunnable, its successor exists |
| `abandoned` with `reasonKind: preempted` | A hotfix took the session, see [Fast lane](fast-lane.md). No failure, no escalation |

- One automatic retry on the `strong` tier. A second failure goes to investigation, then the owner.
- Concurrency key `ticket:<id>`. `retries: 0` at job level, the retry belongs to Bauherr.

## Lease

A session Run is leased to one coordinator. `claim_run` returns a `leaseToken`, stored only as a hash and required on every owning call. A second session under the same user is refused.

- The lease lasts 30 minutes from the last sign of life. Any call with a valid token renews it, and every lease-checked response carries `leaseExpiresAt`.
- A push to the Run's branch `bauherr/<ticket>-<run>`, else the head of the Run's MR, also renews. `expire-sessions` compares the head SHA with `runs.last_seen_sha` for a Build Run whose last sign of life is 20 minutes old.
- An expired lease is never revived by a push. A forge error skips the check. A wrong token or lost lease never renews.
- Unclaimed session Runs do not expire. This includes Triage Runs.
- On expiry the Run ends `abandoned` with the error `session lease expired (last sign of life <iso>, last call <tool>)`. A new `awaiting_session` Run with `previousRun` set is claimable. A second consecutive `abandoned` Run ends `needs_human`.
- A Workspace Bauherr can use "Release lock" on the Run page. It acts like expiry, never `needs_human`, and records a human touch. A late owner gets `lease lost`.

## Liveness

Invariant: every open, non-parent Ticket in plan, build or review has a live Run, a visible wait, or a needs-you with a reason and one primary action. A live Run is `queued`, `awaiting_session` or `running`. A visible wait is `waitingFor`, `blockedBy` or a human gate.

`deadTickets` in `lib/liveness.ts` lists Tickets with neither, each with a cause. The task `watch-liveness` repairs them every 5 minutes.

| Cause | Meaning | Repair |
|---|---|---|
| `mr-missing` | Review, the linked MR is closed or none is linked | An open factory MR on `bauherr/<number>-*` is linked to the newest Build Run and review resumes. None: back to Build with a note to open a new MR |
| `checks-red` | Review escalated, MR open, a finished check failed | Back to Build on the same MR, failing checks as Current instructions, no round |
| `run-failed`, `run-abandoned`, `run-stuck` | The latest Run failed, was abandoned, or ended `needs_human` with `reasonKind` `stuck` | The escalation ladder. Anything else stays a need, `Run failed` |
| `run-cancelled` | The latest Run was cancelled | None. Need `Cancelled` with Re-run and Back to backlog |
| `review-escalated` | Review `needs_human`, MR open, checks not red | At the round cap, one more fix round with Build and Review on `strong`, then the owner. Below the cap none, need `Needs you` |
| `review-invalid` | Review `ready_for_human` because the output was invalid | One successor review on `strong`. A second invalid output stays with the owner |
| `review-stalled` | Review `ready_for_human`, no `problem`, over 30 minutes, no human touch since | None. Factory health shows "Waiting for a human merge for over 30 min" |
| `triage-expired` | Untriaged, its only Triage Run ended `abandoned` | `triagedAt` and `triageAttempts` reset, so the next poll offers Triage again |

- Each repair posts one comment `bauherr:liveness:<cause>:<run id>`, so it happens once per Ticket, cause and Run.
- The sweep stores `tickets.liveness` as `{cause, need, at}` for each Ticket still dead, and clears it for the rest. Factory health reads it without a forge call. A finding older than 15 minutes shows "could not be checked".
- MCP `return_to_build` lets an agent do the `mr-missing` and `checks-red` repairs. It is refused for other Tickets. Gates stay human-only.
- Review restart, task `resume-reviews` every minute: a Ticket at `ready_for_human`, or at `needs_human` below the cap, whose MR head differs from the last `reviewedSha` is reviewed again, unless `rebindReview` moves the verdict. One comment `New head <sha7>; review restarted (was <state>).`

## Escalation ladder

`lib/escalation.ts`. A stuck Ticket climbs four rungs and reaches the owner at the last.

1. The stage's normal Run.
2. One retry on `strong` with doubled caps. `runs.escalation = { step: 2, reason, previousRuns }` is written with the Run. The same applies to the successor of an abandoned session Run and to the extra fix round at the review cap.
3. An investigation, Build only.
4. The owner. The failed Run gets `reasonKind` `decision`, or `access` when the budget is out, and only then shows `Run failed` with Re-run. Until then the card says Escalated.

`needs_human` carries a `reasonKind`: `finish_run`, or `kind` per blocked Goal statement in `goal.json`. `decision` and `access` reach the owner. `stuck` enters the ladder. A missing one is `decision`. Session claim payloads carry `run.tier: 'strong'` and `run.escalation`.

Before an escalated autonomous Run the USD budget `budgetUsd30d` is checked against gateway spend. When spent, the ladder ends at the owner with "budget". Token budgets and session Runs are not checked.

Every step is one line in the Ticket's `bauherr:escalation` comment: step, stopped Run with cost and reason, tier, model and caps. It is keyed by the stopped Run and written before the Run, so a retry never doubles it.

## Investigation

`lib/investigation.ts`. A second Build failure moves the Ticket to Plan with `waitingReason` "failed twice: investigate". It leaves the Build slot, and Plan WIP does not hold it. One Plan Run starts with `runs.investigation = { failedRuns, stage }`.

- That Run, and the one fresh Build Run after it, are escalated. Tier is `strong`. The investigation Plan Run gets 60 turns and $2. The Build Run gets twice the normal turns and budget.
- The Run reads both failures in the `bauherr:investigation` comment, shown on the Ticket page. The Board card says Investigating.
- It ends with MCP `submit_investigation`, or `.bauherr/investigation.json` when autonomous:
  - `revise`: plan approval is withdrawn and a revised plan goes through the plan gate.
  - `fix-ticket`: a `type:bug` Ticket is filed and the Ticket is `blocked-by` it. `pullWaiting` starts a fresh Build Run once the fix closes. Its failure counts as a first failure.
  - `needs-human`: the Run ends `needs_human` with the question.
- The comment names tier, model and cost of each escalated Run.
- A Ticket gets `MAX_INVESTIGATIONS`, 2. After that the second failure stays with the owner.

## MR resolution

`prOf` resolves a Ticket's MR.

- For an epic: the parent's `epic.pr`. A slice resolves its parent's. A factory MR has head `epic.branch`, `slice.branch` or `bauherr/<number>-*`.
- Otherwise: the newest Build Run's `artifacts.prUrl`. If that MR was closed unmerged, or a review or release Ticket has none, the newest open factory MR with head `bauherr/<number>-*` stands in, with no DB edit.
- A hand-made replacement is linked with MCP `relink_mr {runId, leaseToken, prUrl}` on Build Runs.
- Stacked MRs: `mergePullRequest` with `deleteBranch` first retargets every open MR based on the merged head branch onto the merged MR's base. If that fails, the branch is kept and the failure reported as `branchDeleteError`.
