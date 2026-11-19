# Epics, slices and the Split stage

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- A plan could end with `## Sub-tickets` (`- **Title** — body`, optional `after: <sibling title>`). Approval created each item as a forge sub-issue. The parent moved to the `container` stage "Split" with n/m done and no Runs, and closed when all children closed.
- A parent without children was split as an epic. Plan approval wrote `tickets.epic` (branch `bauherr/<parent number>-epic`, `slices`, `current`, `mergeFailures`, `pr`). Only slice 0 existed as a sub-ticket with `tickets.slice` (`epic`, `branch`, `index`, `prev`, `main`, `head`, `passed`, `fixes`).
- All slices shared one branch and one PR (opened by slice 1's Run). Each slice was reviewed on its own commit range after `slice.prev`. The slice merge gate never merged; green checks gave `passSlice`, then `advanceEpic` created the next slice.
- After the last slice the parent moved to `review` as "Epic review": the base was merged into the epic branch, then one review, one merge, release and acceptance on the parent.
- A `replan` outcome, or 2 merge failures (`mergeFailures`), closed the unbuilt slice and sent the parent back to Plan. The new `## Sub-tickets` was taken automatically only if built slices were an unchanged ordered prefix, at least one slice was left and `## Goal` equalled `epic.goal`. Else the plan gate waited.
- An epic held one WIP slot (its current slice). A Bauherr or Admin could park, resume or discard an epic (`parkEpic`, `resumeEpic`, `discardEpic`). A parked epic held no slot and was skipped by every sweep. `discardEpic` closed the PR unmerged and deleted the branch.
- The home page had an Epics tab (`EpicsView`) with progress per epic.

## The requirement behind it

- Work too large for one ticket and one agent context had to be cut into steps that land together (#624, #626, #656, #663).
- Slices must build on each other without merging half-done work to main.
- A stopped epic must never merge and never drop silently.
- Specs: `docs/spec/epics.md` (63 lines), `docs/spec/gates.md` section "Sub-tickets".

## Where the code is

- `apps/server/src/lib/epic.ts` (23): types `EpicField`, `SliceField`, `NOT_PARKED`.
- `apps/server/src/lib/actions.ts` (2009): `spawnSubTickets` (l. 493), `replanEpic` (l. 707), `queueEpicMergeMain` (l. 719), `advanceEpic` and `advanceEpics` (l. 733, 762), `parkEpicNow`, `parkEpic`, `resumeEpic`, `discardEpic` (l. 815-867), `closeFinishedParents` (l. 891). `prOf` in `release.ts` resolves the epic PR.
- Also touched: `advance.ts`, `wip.ts` (slot rule), `jobs/index.ts` (`poll-tickets`, `merge-main`).
- Collections (`apps/server/src/collections.ts`): tickets `epic`, `slice`, `parked`, `inheritedApprovalFrom`. Stage `parent` (kind `container`) in `pack/factory.yaml`.
- UI: `apps/server/src/app/(app)/components/Epics.tsx` (62), `EpicControls.tsx` (60), `lib/epics.ts` (41), `(shell)/page.tsx`.
- Tests in `apps/server/tests/`: `epics.test.ts`, `epic-flow.test.ts`, `epic-mcp.test.ts`, `epic-run-ctx.test.ts`.

## Why it was cut

The lean core sizes one ticket to one fresh agent context and has no parent/child machinery. Large work is split into separate issues by hand until a module does it.

## What a module on the new core needs

- Core contracts: the ticket record stays one record per ticket; a module would add parent and child links and a module-owned epic record. Each slice is a normal ticket going through the fixed lifecycle. The Brief card carries the proposed slice list; the engine acts on the chosen option (approve, replan, park, discard).
- Lift almost unchanged: the re-plan prefix rule (built slices unchanged, goal equal), `advanceEpic` as an idempotent step, the slice range logic (`prev`, `head`).
- Design again: how a slice's review covers only its own range; one PR for many slices versus one PR per slice; the epic review as a Result card.
- Trap: `advanceEpic` ran from several places (poll, merge gate), so it had to be idempotent and ran under a per-epic lock (`exclusive("epic:<id>")`).
- Trap: slice N+1 needs `main` and `prev` recorded when created, else its review range is wrong.
- Trap: the forge issue of a passed slice stays open; closing is tied to epic acceptance, and a parent closed `not_planned` must close its open slices.
- Trap: parked tickets must be excluded in every sweep (WIP, claim, liveness, merge-main); the old code listed them one by one (inferred: a miss meant a parked epic restarted).
- Trap: a re-plan that moves or drops a built slice is refused.
