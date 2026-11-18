# Epics

Every split of a parent without children is an epic. A parent that already has children and no `tickets.epic` keeps the [eager sub-ticket path](gates.md#sub-tickets).

## Shape

- Plan approval writes `tickets.epic` with the branch `bauherr/<parent number>-epic`, the slices in list order, `current`, `mergeFailures` and `pr`.
- Only slice 0 is created, as a sub-ticket with `tickets.slice` holding `epic`, `branch`, `index`, `prev`, `main`, `head`, `passed` and `fixes`.
- Approval is inherited. Entry into Build follows the usual WIP path. `after:` is ignored, list order is the chain.
- One epic branch and one PR. Slice 1's Run opens the PR, titled like the parent, and sets `epic.pr`. Later slices push to it.
- A slice's review covers its own commit range, after `slice.prev`.

## Slice merge gate

`mergeGate` never merges a slice. After the head-moved check it needs only the checks.

| Checks | Result |
|---|---|
| Red | Slice returns to Build |
| Pending | `waiting_checks` |
| Green | `passSlice`: `slice.head` is the reviewed head, `passed` is set, stage `done`, the forge issue stays open, then `advanceEpic(parent)` |

A blocking slice review returns that slice to Build and the epic waits.

## Advance

`advanceEpic` is idempotent. `poll-tickets` also runs it next to `closeFinishedParents`.

- It creates slice N+1 with `slice.prev` set to the head of N, `slice.main` set to the base head now, and `epic.current` set to N+1.
- After the last slice the parent moves to `review`, shown as "Epic review".
- `reviewState` `waiting_checks` and a `merge-main` job merge the base into the epic branch. A conflict returns the parent to Build, the usual conflict return.
- Then review, the merge gate with the one merge of the epic PR, release and acceptance run on the parent as for any Ticket.
- A parent that reaches `review` through `pullWaiting` gets the same merge-main step, `queueEpicMergeMain`.
- `closeFinishedParents` skips epic parents. When the epic parent is accepted, the poll closes its open slices as completed.
- The poll also closes the open slices of any parent closed as `not_planned`.

## Re-plan

A `replan` outcome on a slice, or the second merge failure, closes that unbuilt slice as `not_planned` on the forge and locally. `replanEpic` then sends the parent back to `plan`. The approval label drops, a new plan Run starts, and a comment on the parent lists the built slices.

The parent's new `## Sub-tickets` is taken automatically when all of this holds:

- The built, passed slices are an unchanged ordered prefix.
- At least one slice is left.
- Its `## Goal` equals `epic.goal`.

Otherwise the plan gate waits, and approval takes it. A plan that changes, moves or drops a built slice is refused with one comment and a new plan Run.

A taken re-plan rewrites `epic.slices`, built entries keep their tickets. It sets `current` to the first unbuilt slice, continues with `advanceEpic` and logs before and after under Decisions in the parent's worklog.

## Merge failures

A Build Run of a slice with `slice.prev` that ends not succeeded with `artifacts.mergeConflict` adds 1 to `epic.mergeFailures`. At 2 the parent re-plans. A passed slice resets the count.

## Park, resume, discard

Only a Bauherr or Admin parks. A stopped epic is parked, never merged and never silently dropped.

- `parkEpic` sets `tickets.parked` on the parent and its open slices and cancels their live Runs. It writes the history event `epic:park` and a worklog line. Branch and PR stay.
- A parked Ticket is left out of the WIP count, `pullWaiting`, the frontier, `claim_*`, the liveness watchdog, `advanceEpic`, `startMissingRuns`, plan advance, review conclusion and `merge-main`. It shows no `needsYou`.
- A `stop` outcome on an epic parent or slice, the owner's Stop at the review round cap, parks the epic instead of sending the Ticket to triage. For other Tickets `stop` is unchanged.
- `resumeEpic` clears `parked` and continues where it stopped. The usual slice and epic-review steps merge the base.
- `discardEpic`, offered on a parked epic, cancels the Runs, closes the epic PR unmerged, deletes the branch with `Forge.deleteBranch`, and closes the parent and open slices as `not_planned`.
