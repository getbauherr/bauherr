# Factory file

The factory file declares the team and the workflow of a Workspace. `pack/factory.yaml` is the shipped default. Every Workspace can run its own, see [Applying the factory file](apply.md).

`apps/server/src/lib/workflow.ts` derives every stage list in the code from the workflow: Board columns, pull order, WIP stages, repairable stages. It is pure, with `parseFactory`, `lint`, `compile`, `board()`, `pullRank()`, `gates()` and `graph()`. Code gets the workflow with `workflowFor(workspace)` from `lib/factory.ts`.

## Schema

```yaml
version: 1
team:
  roles: {<id>: {title, tier | (provider and model), agents?, avatar?, skills?, exceptions?, profile?, profile_file?}}
workflow:
  stages:
    - {name, kind, title?, role?, skill?, mode?, gate?: human | {by}, production_gate?: human | {by}, refine?: {by} (triage), by? (human), wip?, exclude_labels?, when?, skip_to?, outcomes: {<outcome>: <stage | escalate | backlog>}, jobs? (agent): [{id, role, skill, needs?, when?, blocking?, outcomes?}]}
  migrate: {<old stage>: <stage>}
  aliases: {<old stage>: <stage>}
```

`migrate` and `aliases` are optional. Apply accumulates `aliases`.

### Stage names

Names match `^[a-z][a-z0-9-]*$`, are unique, and are not `checks`, `scan`, `docs`, `distill`, `escalate` or `backlog`. `title` defaults to the name.

### Roles

| Key | Rule |
|---|---|
| `title` | Required |
| `tier` or `provider` plus `model` | Exactly one form. `tier` is one of the Workspace's tiers. `provider` is the slug of an LLM Connection of the Workspace |
| `agents` | Positive integer, the most session Runs the role works at once |
| `avatar` | Free id the UI maps to a picture, default the role id |
| `skills` | 1 to 6 labels of at most 24 characters, shown on the Team page and returned by `connect` and `loadTeam` |
| `exceptions` | `true` on at most one role, which also receives stuck Tickets |
| `profile`, `profile_file` | The role's text. `profile_file` is a path inside the pack dir, inlined on apply |

- The model of every Run is its stage role's: `tier`, or the pinned `provider` and `model`, written to `runs.model` and `runs.provider`. Escalated Runs use `strong`.
- Roles that no stage names are allowed, for custom stages.
- The default file ships `orchestrator` with exceptions, `engineer`, `reviewer`, `security`, `ux`, `test`, `docs` and `ax`. `docs` is the technical writer for the docs check Run. `ax` is the agent experience engineer on tier `strong`. It moves rules into code, checks and proof with the `harden`, `verify-create` and `verify-maintain` skills. No stage names `docs` or `ax` yet.

## Stage kinds

Built-in behaviour binds to a stage's kind, never its name. A file that renames every stage works unchanged, see `tests/renamed-flow.test.ts`.

- Code tests a Ticket stage with `is(wf, stage, kind)` and a Run with `kindOfRun(wf, run)`. It writes a stage with `nameOf(wf, kind)`.
- No other code lists or compares stage names. Guards: `tests/stage-lists-guard.test.ts`, `tests/stage-names-guard.test.ts` and `tests/default-workflow-guard.test.ts`.

| Kind | Outcomes | Role | What it does |
|---|---|---|---|
| `triage` | `plan`, `refine`, `skip` | Required | Triage Run on untriaged Tickets. `refine` holds for whom `refine: {by}` names, default the Bauherr |
| `plan` | `done`, `decisions`, plus `split` | Required | Plan Run. `gate: human` or `gate: {by}` gives Approve plan |
| `container` | `children_done` | None | Parent of split sub-tickets, no Runs. An epic parent leaves it for `review` after the last slice |
| `build` | `done`, `stuck`, `replan` | Required | Build Run, MR with Evidence |
| `review` | `clean`, `changes`, `stop` | Required | Review Run and merge gate. `changes` returns to build, `clean` merges and enters release |
| `release` | `accepted`, `changes` | None | Staging, `gate`, `production_gate`, deploy watchers |
| `done` | None | None | Closed |
| `agent` | At least one | Required, plus `skill` | A role works the Ticket with the skill and reports an outcome |
| `human` | 1 to 4 keys `^[a-z][a-z0-9_-]*$` | None | The Ticket waits for a person |

`replan` is reported with `finish_run outcome: replan` in a session, or `.bauherr/outcome.json {outcome: replan, comment}` when autonomous.

### Agent stage

A Run of kind `agent` in the stage, session or autonomous by the stage's `mode`.

- It may read the Ticket, plan, worklog and open MR, and post one comment.
- It cannot push, open or merge an MR, create sub-tickets or touch approval labels. The session has no tools for them. The Runner is read-only without push credentials.
- It reports an outcome with `finish_run outcome comment`, or `.bauherr/outcome.json {outcome, comment}`. A missing or invalid outcome fails the Run.
- The comment carries the marker `bauherr:stage:<name>`. WIP applies as for built-in columns.

### Human stage

No Run. The Ticket shows the need "Decision needed", phase `human`. The Ticket page's action bar has one button per outcome key, with the stage `title` as heading. MCP `decide {ticket, outcome, note?}`, human key only, does the same.

Both record the touch `decide:<stage>:<outcome>` with `as` and `addressee`. A Product owner may decide when the stage says `by: product-owner` and the Product is theirs.

## Gate keys

- `gate: human` means `{by: bauherr}`. `gate: {by: bauherr | product-owner}` is allowed on `plan` and `release`. Lint refuses any other value.
- `production_gate` takes the same values, on `release` only. `refine: {by}` is for `triage`, `by` for `human` stages.
- Compiled, only `product-owner` is stored: `gate_by`, `production_gate_by`, `refine_by`, `by`. A file without it hashes as before. See [People](people-checkpoints.md).
- The compiled version records the enabled gates, `humanGates()`.

## Outcomes and routing

`advance(payload, ts, ticket, outcome, {by, run?})` in `lib/advance.ts` takes a Ticket out of its stage. It looks up `outcomes[outcome]` and enters the target by the target's kind.

| Target | Behaviour |
|---|---|
| `escalate` | The escalation ladder of the finished Run |
| `backlog` | The untriaged state |
| `plan`, `build` from upstream | A WIP-ruled move |
| `build` from a later stage | A hand-back on the same MR, the note goes to the worklog, no review round |
| `review` | The WIP-ruled entry plus the Review Run |
| `agent` | A WIP-ruled move plus its Run |
| `human` | A move without a Run |
| `release`, `done` | Entered only by the review and release logic |

- An outcome with no mapping ends the Run `needs_human` with kind decision.
- `advance` routes triage `plan`, plan `done`, build `done` and `replan`, review `stop`, and every `agent` and `human` outcome. Build `done` means request review and the checks watcher.
- Lint fixes these: `review.changes` and `release.changes` to build, `review.clean` to release, `release.accepted` to done. Plan `decisions` and `split`, triage `refine` and `skip`, and `build.stuck` use built-in code.
- An outcome of a later stage that targets the plan stage drops `bauherr:approved:plan`, moves the Ticket and starts a new plan Run. The plan is made again and, with the gate on, approved again.

## Conditional stages

A stage of kind `agent` or `human` may carry `when`. The built-in chain triage, plan, build, review and release is always unconditional. A specialist role then works only the Tickets that need it.

```yaml
- name: security-review
  kind: agent
  role: security
  skill: mr-security-review
  when: {touches: security}
  outcomes: {pass: review, findings: build}
```

| Key | Matches when |
|---|---|
| `touches` | A set name or list of names of the Product's path sets, any |
| `paths` | Any literal glob matches. `*` is within a segment, also `**` and `?` |
| `labels` | The Ticket has any |
| `types` | Any of `bug`, `feature`, `change`, `question`, read from the label `bauherr:type:<kind>`. A Ticket without one matches no `types` |

At least one key is required. Keys are AND-ed, values within a key OR-ed.

### Skipping

A Ticket that would enter a stage whose `when` does not match skips it. No Run is created.

- It moves on as if the stage's pass outcome fired. The pass outcome is the first outcome in file order, `outcomeOrder`, unless the stage sets `skip_to: <stage>`.
- A chain of conditional stages is followed until one matches or an unconditional stage is reached. A cycle is never entered. Lint refuses it, and the engine stops at the first repeat.
- The skip writes a `ticket_events` row with cause `skip:<stage>` and a plain reason in `note`, such as "the change touches no security paths". The Steps list shows "Security review: Skipped".
- A skip row is no visit and no time. `timeline()`, `flow()`, "in this stage since" and the Steps rows leave it out. `skips()` reads it.
- `routeEntry` in `lib/route.ts` decides, called by `advance()` after it resolves the target and before anything is entered. Every move into an `agent` or `human` stage or into review goes through `advance`. WIP, Run and label then apply to the stage finally chosen.
- The poller never moves a Ticket forward on its own. A stage a person moves a Ticket back to by hand is entered as it is. A stage that gains a `when` leaves Tickets already in it where they are.

### Changed paths

After Build: the files of the Ticket's MR. Before Build: the `## Files` section of its latest plan, `ticketPaths`, the source of the overlap hold.

- Unknown paths, with no MR, no plan files or an unreadable forge, make `touches` and `paths` match. The review happens rather than being skipped silently.
- A set the Product has not declared or left empty never matches.
- Path sets are `products.pathSets`, `{name: [globs]}`, edited at Product > Checks & merging > Path sets. Suggested names are `security` and `ui`.
- A stage naming an undeclared set never matches for that Product. The Product page and the editor panel say so, for example "Security review never runs for this Product: no `security` paths declared".
