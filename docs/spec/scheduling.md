# Scheduling

## Triggers

Only factory-derived events start work, from diffs of poll summaries against the stored Ticket pointer.

- A stage entry, the label `bauherr:go`, a manual admin button that sets the label, or a schedule that creates a Ticket first.
- `check_failed`, a CI failure on a Build Run's MR, and `mr_comment`, a review comment on it. Each re-wakes the Build Run within its remaining budget. A second CI failure after a re-wake is `needs_human`. In `review` the merge gate and round cap handle them.
- Entering `review` with an open factory MR starts the Review Run. Returning from review starts a Build Run on the same branch.

A Run starts when a Ticket enters a stage with an agent and has no human assignee. Logins the factory added for a gate do not count. A Ticket with no Run of that stage is also started once the assignee is gone.

- One Run per Ticket and stage entry, unless the column is full or an earlier Ticket overlaps.
- Every start path respects `blockedBy`, using `hasOpenBlocker`.

## Build hold

`lib/overlap.ts`. A Build Run does not start while a Ticket of the same Product that sorts earlier in `executionOrder` has intersecting paths. Earlier means in Build or Review and open. A Ticket in Review always precedes a Build.

- Only a Ticket with work in flight holds: a live Run, `queued`, `awaiting_session` or `running`, or an open PR. A Ticket whose latest Run is `needs_human`, `failed` or `cancelled` holds nothing.
- A `type:bug` Ticket is not held by a feature that has not started.
- A Ticket's paths are its linked PR's files from `listPullRequestFiles`, else the `## Files` of its latest plan comment, else none.
- Two paths intersect when equal, when a glob matches the other path, or when two globs share a literal prefix up to the first wildcard.
- The later Ticket stays in Plan with `waitingFor = build` and `waitingReason = "overlaps #N"`, shown as "Waiting: overlaps #N", and no Run.
- `enterStage('build')` checks on entry. `pullWaiting` rechecks on every poll and releases the Ticket once the other merged or no longer intersects. `startMissingRuns` covers a Build Ticket that never had a Run.
- Returns to Build are never held. A held Ticket occupies no Build slot.
- `products.overlapIgnore`, a glob list in Settings > Factory > Workflow, Admin only, names paths that never hold. `suggestOverlapIgnore` proposes files changed in at least 25% of the last 100 merged PRs. A person adds them.
- Out of scope: line-level or semantic conflicts, Plan holds, other Products.

## WIP limits

The `wip` of a step, set in the workflow editor. Defaults: Plan 4, Build 2, Review 3, Release 5. Empty means no limit. `workspaces.wipLimits` is a legacy override that the editor folds into the file and the first apply clears.

This is a pull system. `enterStage` in `lib/wip.ts` lets a Ticket enter Plan, Build or Review only while the column has room, under a per-Workspace and stage advisory lock.

- Otherwise the Ticket stays ready in the column to its left, with `tickets.waitingFor` set and no Run. A waiting Ticket is not counted in the column it wants. A Plan Ticket waiting for any column does not fill Plan.
- Work already in a column always finishes. Merges, the release watcher, staging acceptance, production and returns to an earlier stage are never held. A return may exceed a limit. A full Release holds new Review entries.
- Sub-tickets count and parents do not. Sub-tickets created into a full column wait.
- An epic holds one slot, its current slice. A passed slice frees the slot. The epic review counts as the parent in Review.
- `pullWaiting` runs every poll from right to left, Review, Build, Plan, best owner rank first. A freed slot or raised limit applies on the next poll.
- A Ticket queued this way asks the owner nothing. `needsYou` is null for a Triage Ticket with `waitingFor` set, and the gate sweep clears a stale "Answer questions" card.

### Parking

A parked Ticket keeps its card and stage but holds no slot, like an epic park. The gate sweep writes `tickets.parkedNeed` next to `needsYou` when the need is `Run needs you`, `Needs you`, `Cancelled`, `Run failed` or `Decision needed`, in a limited column, with no queued, awaiting or running Run. See `PARKING_NEEDS` in `lib/needs-you.ts`. Approval gates never park.

When the need clears, `rejoin` in `lib/wip.ts` clears `parkedNeed`. `startRunIfNeeded` calls it first.

- With room, the Ticket continues.
- With the column full, `waitingFor` is set to its own column with the reason "`<Column>` is full", and one comment is posted. `pullWaiting` starts it when a slot frees. It never displaces another Ticket.

## Claim order

`claim_next` and the frontier work right to left: Release, Review, Build, Plan, Triage, then the owner's rank. Byte order everywhere, same as the Board. An owner reorders by rank on the Board, not by assigning.

- `claim_run` accepts only the Run `claim_next` would return and refuses a Run outside the frontier. Its check is Workspace-wide. `claim_next {product}` is product-scoped.
- `claim_next` skips a Run whose claim errors and reports it in `skipped`. `claim_run` ignores such a Run for 5 minutes. Parents are never claimable.
- A session may pass a stable `session` label, at most 64 characters, to `claim_next`, `claim_run` and `list_frontier`. It is stored in `runs.sessionLabel`. A Review Run whose Ticket's latest Build Run has the same non-empty label is skipped as "your own build". Sessions without a label are never skipped.
- A session that works only some stages passes `stages`, for example `["build"]`. The pull order applies within them only. `claim_run` refuses a Run outside them. An unknown stage is an error. Empty or missing means all.
- `poll-tickets` syncs `tickets.blockedBy` from the forge for every Ticket it saw change. Sources are native dependencies and `Blocked by: #N` body lines, which include plan `after:` edges. The forge is the truth. A blocker without a local Ticket in the Product is ignored until polled. A forge read error keeps the stored set.
- Autonomous Runs execute in parallel, at most `BAUHERR_MAX_RUNS` per worker process, default 4. WIP limits bound Tickets, not Runs.
