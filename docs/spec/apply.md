# Applying the factory file

## Lint

`lint()` runs in `compile()` and `applyFactory`. It refuses a file that breaks any of these.

| Area | Rule |
|---|---|
| Header | `version` is 1. Stage names are valid |
| Chain | One `triage` first, one `done` last, at most one each of plan, container, build, review and release. A container exists if and only if `plan` has a `split` outcome |
| Build to release | Build, review and release are all present or all absent. Review is reachable from `build.outcomes.done` through `agent` and `human` stages only. Only the review stage targets release |
| Outcomes | Keys follow [Stage kinds](factory-file.md#stage-kinds) |
| Targets | Every target is a stage, `escalate` or `backlog`. Every stage is reachable from triage and reaches done |
| Roles | `role` is required on triage, plan, build, review and agent, plus `skill` on agent. It is forbidden on container, release, done and human. It names a key of `team.roles` |
| Role fields | See [Roles](factory-file.md#roles) |
| Gates | `gate` only on plan and release. `production_gate` only on release |
| Limits | `wip` is a positive integer on plan, build, review, release, agent and human. `mode` is `session` or `autonomous` |
| Migration | `migrate` and `aliases` map non-current names to current stages |
| Conditions | `when` only on agent and human stages, with a known key and non-empty values. `skip_to` only with `when`, naming a stage that is not triage, container, release, done or the stage itself. The skip target counts as an edge, and conditional stages never skip in a cycle |

## Versions

Each Workspace runs its own workflow. `workspaces.workflowVersion` points at the active `workflow_versions` row. No pointer means the pack default.

| Column | Content |
|---|---|
| `version` | Counter per Workspace |
| `source` | The YAML with every `profile_file` inlined as `profile` |
| `compiled` | The `Workflow` |
| `hash` | sha256 of the canonical compiled JSON |
| `appliedBy`, `appliedVia`, `note` | Who, how (`ui`, `api`, `cli`, `boot` or `seed`), why |

- `workflowFor(workspace)` is synchronous, from a process-wide map. `loadWorkflows(payload)` refreshes it at most every 5 s. The app, worker and poller each keep a copy, so a change reaches them within 5 s.
- `workflowFor` throws when a process never loaded it. `onInit` loads at boot. Job handlers, the MCP route, `payloadClient()` and the API routes refresh.
- `DEFAULT()`, the pack file, is allowed only in the files listed in `tests/default-workflow-guard.test.ts`.

## applyFactory

`applyFactory(payload, workspaceId, yaml, {by, via, note?, baseVersion?, dryRun?})` does these steps:

1. Parse. Inline `profile_file`, relative to the pack dir and never outside it.
2. Lint.
3. Check the context. Every stage `skill` is `pack/skills/<name>/SKILL.md`. A role's `provider` is a Connection slug of the Workspace. Its `tier` is one of the Workspace's tiers.
4. Compile and compare the hash with the active version. Equal gives `changed: false` and no row.
5. Otherwise one transaction under a per-Workspace advisory lock inserts version n+1, applies `workflow.migrate`, accumulates `aliases`, clears `workspaces.wipLimits` and moves the pointer. A Workspace override saved later wins.

- A `baseVersion`, from `If-Match`, that is no longer active is refused with "the workflow changed since you loaded it".
- `dryRun` returns the findings and what would migrate.

## Migrate and aliases

- `workflow.migrate: {<old stage>: <new stage>}`. A stage that disappears while it holds Tickets in any state, or active Runs, needs an entry. Otherwise the apply is refused with a finding.
- It rewrites `tickets.stage`, `waiting_for`, `factory_stage`, the stage part of `history_key`, and `runs.stage` of the Workspace.
- Same kind: a rename, and active Runs continue. Different kind: the stage's live Runs are cancelled and the normal start logic starts the new stage's Run.
- `aliases` accumulate in the compiled workflow, so `stage(wf, oldName)` and forge labels written before a rename still resolve. The poller replaces an alias label with the canonical one, at most 20 Tickets per tick, without "stage rejected".

## Entry points

| Entry | Notes |
|---|---|
| Workflow editor `/workflow/edit` | Admin |
| `GET` and `PUT /api/workspaces/<slug>/factory` | Body is YAML. `?dryRun=1`, `If-Match: <version>`. Session or the Admin's personal API key, an agent key gets 403. 422 on findings, 409 when stale |
| `bauherr apply -f factory.yaml --workspace <slug> [--dry-run] [--url <instance>]` | Personal key in `BAUHERR_API_KEY`. The CLI inlines `profile_file`s relative to the YAML. Exit 1 on findings |
| `bauherr export --workspace <slug>` | Same key. Returns the active `source`, or the pack file with profiles inlined |
| `BAUHERR_FACTORY_FILE=/path/factory.yaml` | Applied at boot, idempotent by hash. Optional `BAUHERR_FACTORY_WORKSPACE=<slug>`, default every Workspace. An invalid file is logged and the active version stays |

A UI, API or CLI apply writes a `human_touches` row `apply:factory`. Boot and seed applies write none. `appliedVia` says so, and the editor shows "from the boot file".

## Workflow editor

The draft is the factory file as one text.

- Design edits are pure text operations in `lib/workflow-edit.ts`. The browser-safe `lib/workflow-rules.ts`, re-exported by `lib/workflow.ts`, lints each result.
- Nothing is live until Apply. Review changes lists `describeChanges(before, after)` and the server dry run. The dry run returns `held: [{stage, tickets, runs}]` for removed steps that hold work, so the editor can write `workflow.migrate`.
- Apply passes `baseVersion`. A stale base is refused and the draft kept.
- History lists `workflow_versions`. Restore loads a version's `source`, or the shipped file, with the note "Restore of version N" and goes through the same review.
- The base file is the active file with `workspaces.wipLimits` folded into the steps' `wip`.

## Presets

`pack/presets/{solo,standard,careful}.yaml`, read by `lib/presets.ts` from the pack dir, else the core pack. The setup wizard applies one as a UI apply with the note "Setup: `<preset>` team". Every preset must lint clean, which a test checks.

| Preset | Content |
|---|---|
| `solo` | One engineer role works every stage. No plan gate, production gate on. No Jobs |
| `standard` | `pack/factory.yaml`: the review pipeline of find Jobs, `verify` and `review-rank`, with the `security` Job `when: {touches: security}`, and the `staging-walk` Job of `release` |
| `careful` | Standard plus `gate: human` on `release`. Its `ux` Job, `touches: ui`, and `test` Job, `types: [bug]`, match standard |

A Workspace with its own factory file is unaffected by the shipped default.
