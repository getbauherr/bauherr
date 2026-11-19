# Editable workflow (factory file)

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- Each Workspace ran its own workflow, written as a `factory.yaml` (`team.roles`, `workflow.stages`, optional `migrate` and `aliases`). `pack/factory.yaml` was the default. The file was applied through the editor, `PUT /api/workspaces/<slug>/factory`, `bauherr apply`, or `BAUHERR_FACTORY_FILE` at boot.
- Apply parsed, linted, compiled and hashed the file. An unchanged hash made no version. Otherwise a row in `workflow_versions` was added under an advisory lock and `workspaces.workflowVersion` moved. A stale `baseVersion` was refused.
- Stage kinds: `triage`, `plan`, `container`, `build`, `review`, `release`, `done`, plus custom `agent` and `human` stages. Behaviour bound to the kind, never the name, so a file that renamed every stage worked. A stage that vanished while holding Tickets needed a `migrate` entry.
- A stage could hold Jobs (`id`, `role`, `skill`, `needs`, `when`, `blocking`, `outcomes`), run in parallel by role. When all Jobs were done the stage applied its first outcome. A `human` Job waited in the Inbox.
- `when` on an `agent` or `human` stage or Job: `touches` (Product path sets), `paths`, `labels`, `types`. Keys AND, values OR. No match skipped the stage and wrote a `skip:<stage>` event; unknown changed paths matched. `skip_to` chose the target.
- WIP limits per stage (`wip`; defaults Plan 4, Build 2, Review 3, Release 5): a Ticket entered a column only with room, else it waited (`waitingFor`); `pullWaiting` ran right to left. A parked Ticket (waiting on a human) held no slot.
- Presets `solo`, `standard`, `careful` (`pack/presets/`) were applied by the setup wizard. The editor at `/workflow/edit` had a flow view, step panel, `when` editor, team tray, YAML tab, review-changes dialog (dry run, `held` Tickets) and version history with restore.

## The requirement behind it

- Teams differ in who reviews, who approves and which specialists run; the stage lists must not be hard-coded (#480, #485, #492).
- Specialist steps should run only when a change needs them (#513).
- Work in progress must be bounded (pull system, see `docs/spec/scheduling.md`).
- Specs: `docs/spec/workflow.md`, `factory-file.md` (145), `apply.md` (89), `history.md` (Jobs; its "in progress" note is stale, Jobs run).

## Where the code is

- `apps/server/src/lib/`: `workflow.ts` (121, with `parseFactory`, `compile`, `board`, `pullRank`, `gates`), `workflow-rules.ts` (265, lint), `workflow-edit.ts` (255), `workflow-describe.ts` (99), `workflow-labels.ts` (48), `workflow-when.ts` (47), `factory.ts` (236, `applyFactory`, `workflowFor`, `loadWorkflows`), `presets.ts`, `stage-jobs.ts` (173), `route.ts` (32, `routeEntry`), `advance.ts` (72), `agent-stage.ts` (32), `wip.ts` (130), `wip-limits.ts` (24), `path-sets.ts` (37), `stage-text.ts`.
- Pack: `pack/factory.yaml` (33), `pack/presets/{solo,standard,careful}.yaml`, `pack/workflow-security.yaml`.
- Collections (`apps/server/src/collections.ts`): `workflow_versions`, workspaces `workflowVersion`, `wipLimits`; products `pathSets`; `ticket_events` (`workflowVersion`, `cause`), runs `job`, `kind`.
- UI: `apps/server/src/app/(app)/components/workflow-editor/` (11 files, 1554 lines with `WorkflowEditor.tsx` 378), route `(shell)/workflow/edit` and `(shell)/workflow/[stage]`, `lib/workflow-editor.ts`, `lib/workflow-view.ts`.
- Tests in `apps/server/tests/`: `workflow.test.ts`, `workflow-edit.test.ts`, `workflow-when.test.ts`, `conditional-stages.test.ts`, `custom-apply.test.ts`, `renamed-flow.test.ts`, `stage-jobs.test.ts`, `wip.test.ts`, `stage-lists-guard.test.ts`, `stage-names-guard.test.ts`, `default-workflow-guard.test.ts`.

## Why it was cut

The lean core has one fixed lifecycle with a few switches per Product. The lifecycle has to prove itself before it becomes configurable. The owner wants this back as a later module.

## What a module on the new core needs

- Core contracts: the lifecycle engine is a pure function from record and events to the next step. A module would compile a validated file into a data structure that this function reads, and store versions with the compiled hash. Human stages map to the three card kinds with options as outcomes.
- Lift almost unchanged: `parseFactory`, `lint`, `compile` (pure, browser-safe), `evalWhen`, `globsIntersect`-style path matching, `describeChanges`, the text-edit operations of `workflow-edit.ts`, the preset files.
- Design again: how a custom stage fits a fixed Intake-to-Done lifecycle; Jobs as module triggers; WIP as a scheduling rule over events; stage migration of live tickets.
- Trap: code must test a stage by kind (`is(wf, stage, kind)`, `nameOf`); guard tests fail on stage names in code.
- Trap: `workflowFor` is synchronous from a process-wide map refreshed every 5 s; each process (app, worker, poller) needs `loadWorkflows`, and it throws if unloaded.
- Trap: a stage with Tickets or Runs cannot just disappear (`migrate`); a different kind cancels live Runs.
- Trap: a `when` that names an undeclared path set never matches, so a specialist step silently never runs; the UI had to say so.
- Trap: WIP count races; entry used a per-Workspace and stage advisory lock.
- Trap (inferred): the model-tier table is duplicated in the file, presets and docs; `bauherr pack lint` checked it.
