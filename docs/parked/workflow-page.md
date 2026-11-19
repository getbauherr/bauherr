# Workflow home page

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- `/` showed the factory file as a stage graph (`WorkflowGraph`, variants `full` and `path`, layout by `layoutFlow`). Dashed edges went back to an earlier stage; dashed pills waited for a person. Tabs Workflow, Graph (tickets ordered by blockers) and Epics.
- Each stage card showed the count against its WIP limit, a bar split by phase (In progress, Waiting for you, Waiting for CI, Queued), who works on it (Runner or session label), the median time in stage over 30 days, and one executor line (`executorOf`).
- Checkpoint pills sat on the stage where a human is asked (for example plan approval, accept on staging); each showed how many Tickets wait. `checkpointOf` mapped a Ticket's `needsYou` to a pill.
- The Ticket list was grouped by stage, "Needs you" first, done collapsed. Columns: number, Ticket, Product, Status, Who, In stage for. Rows could be dragged to rank (`rankTicketAction`, `rankFirstAction`; `tickets.rank`, a base-62 fractional index).
- One status per Ticket (`ticketStatus`): Done, Split, In progress, Queued, Waiting for you, Waiting for CI, Blocked, Failed; first match wins; the list, graph, chat and Ticket page used it.
- `/workflow/<stage>` showed the Jobs of a stage (cards: Agent or Human, who works it, a "when" condition) with the Tickets in each. `?stage=` filtered the list, and for a checkpoint `?stage=<stage>:<checkpoint>`.
- The "holding up work" strip (`holdsOf`, cached 5 s per Workspace) listed shared holds: fast lane, WIP full (default Plan 4, Build 2, Review 3, Release 5), parked Tickets, overlap, no agent connected, stage cannot run.
- `AutoRefresh` re-rendered the page on change events from `/api/changes`.

## The requirement behind it

- See where every Ticket is and what holds the flow up, replacing the Board (#489).
- Make "who waits for whom" visible: you, CI, an agent, a blocker (#616 holds; #577 parked Tickets free a WIP slot).
- Let the owner order work by hand (rank).
- Show the configurable factory file as it is (#492), with epics (`docs/spec/epics.md`).

## Where the code is

- `apps/server/src/app/(app)/(shell)/page.tsx` (112), `(shell)/workflow/[stage]/page.tsx`, `(shell)/workflow/edit/` (the editor).
- `apps/server/src/app/(app)/components/workflow/`: `WorkflowGraph.tsx` 190, `layout.ts` 113, `SortableRows.tsx` 143, `TicketList.tsx` 89, `TicketSteps.tsx` 131, `StageJobs.tsx` 71, `RowDetail.tsx`, `legend.ts`; also `components/HoldsStrip.tsx` (29), `AutoRefresh.tsx`, `TicketGraph.tsx`, `Epics.tsx` (62), `OverviewControls.tsx`, `workflow-editor/`.
- `apps/server/src/app/(app)/lib/`: `workflow-view.ts` 86 (`checkpointOf`, `stageMedians`, `nodeStats`, `stageAgents`), `status.ts` 118, `job-view.ts`, `overview.ts`, `holds-strip.ts` 20, `epics.ts` 41, `graph.ts`.
- `apps/server/src/lib/`: `holds.ts` 94, `wip.ts` 130, `wip-limits.ts` 24, `workflow.ts`, `executors.ts`, `stage-jobs.ts`.
- Field `tickets.rank` in `apps/server/src/collections.ts`; `workspaces.wipLimits` (legacy).
- Tests in `apps/server/tests/`: `status.test.ts`, `overview.test.ts`, `holds.test.ts`, `holds-strip.test.ts`, `wip.test.ts`, `graph.test.ts`, `workflow.test.ts`, `epics.test.ts`.
- Docs: `docs/ui.md` (Pages, Overview), `docs/spec/workflow.md`, `docs/spec/scheduling.md`, `docs/spec/epics.md`.

## Why it was cut

It is replaced by the Factory view, a board with one column per fixed stage.

## What a module on the new core needs

- Core contracts: the fixed lifecycle (Intake, Brief, Build, Verify, Ship, Done), the Ticket record and event log for status and time in stage, the Run leases for who is working, and Cards for what waits for the owner. The page reads only the mirror and the record store.
- The Factory view keeps: `ticketStatus()` (`status.ts`), ranking via `SortableRows.tsx` (and `rank`), `AutoRefresh.tsx`, the stage filter in the URL, median time in stage (`stageMedians`), and who is working (`stageAgents` and presence).
- What goes: `layout.ts` and `WorkflowGraph.tsx` (a graph is only needed for a configurable workflow), Jobs (`StageJobs.tsx`, `job-view.ts`), WIP limits (`wip.ts`, `wip-limits.ts`, the `wip` hold), and the Epics tab.
- To design again: `ticketStatus` takes the old row with `needsYou`, `liveness` and run facts; it must take record, events and Run state. Holds that survive (fast lane, no agent) need new inputs.
- Traps: `ticketStatus` has one status for every page, so a second status elsewhere drifts; a drag must write a rank with a fractional index and not renumber all rows (inferred); the holds query is cached 5 s so a polling page does not load the database; a parked Ticket must not count against a limit (#577).
