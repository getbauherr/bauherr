# Workflow spec

The contract of the Bauherr workflow: what the factory enforces. Rules for agents live in the core pack. Pages:

| Page | Covers |
|---|---|
| This page | Stages, labels, roles and tiers, budgets, egress |
| [Gates](gates.md) | Approvals, gate labels, send back, plans, sub-tickets |
| [Epics](epics.md) | Slices on one branch, re-plan, park |
| [Review](review.md) | Pre-review, findings, round cap |
| [Review artifacts](proof.md) | Proof attached to a Ticket |
| [Merge and checks](merge.md) | Merge gate, queue, train, check retries |
| [Release](release.md) | Staging, production gate, forge releases |
| [Scheduling](scheduling.md) | Triggers, build hold, WIP limits, claim order |
| [Fast lane](fast-lane.md) | Expedite and preemption |
| [Runs](runs.md) | Run states, leases, liveness, escalation |
| [Agent sessions](sessions.md) | Sessions, presence, executors, docs check, distill |
| [Intake and progress](intake.md) | Templates, intake, progress comments |
| [Factory file](factory-file.md) | Schema, stage kinds, conditions |
| [Applying the file](apply.md) | Lint, versions, entry points, presets |
| [Jobs and history](history.md) | Jobs, ticket events, flow metrics |
| [People](people.md) | Roles, assignments, checkpoints, forge channel |

## Stages and labels

Triage, Plan, Build, Review, Release, Done. `pack/factory.yaml` declares them. Names are free, behaviour binds to the stage kind.

- The stage is the label `bauherr:stage:<name>` in the Ticket source. GitLab uses the same label.
- Bauherr derives the stage and never stores the label as truth.
- A move adds the new label before it removes the old one. With two labels the later stage wins.
- A lost label is restored by `poll-tickets` from the stored stage.
- `runs.stage` and `tickets.waiting_for` are text checked against the workflow, not enums. `runs.kind` stores the stage kind of a Run.

| Label | Meaning |
|---|---|
| `bauherr:go` | Start |
| `bauherr:approved:plan` | Plan gate passed; set only while the gate is on |
| `bauherr:approved:staging` | Staging gate passed; the factory sets it when the gate is off and staging is confirmed |
| `bauherr:blocked` | A person is needed |

| Stage | Agent work | Ends with |
|---|---|---|
| Triage | A cheap Run per open, unassigned Ticket without a stage label | `plan`, `refine` or `skip` |
| Plan | A plan Run | Plan comment with Goal, Steps and Files; sub-tickets if large |
| Build | A build Run | A linked MR |
| Review | Find, verify and conclude Jobs | Review comment on the MR; merge, or back to Build |
| Release | Staging walk, then CI observation after the merge | Staging summary and acceptance |
| Done | None | Ticket closed `completed` on acceptance, never on merge |

Triage rules:

- Tickets with an `exclude_labels` label of the stage are not triaged. The default excludes `wayfinder:map`, `wayfinder:grilling` and `wayfinder:research`.
- `refine` adds `bauherr:needs-refinement` and a decision sheet. The stage label becomes plan once every critical question is answered.
- `skip` posts a reason comment and sets no stage.
- A Ticket is re-triaged only when it changes. At most 5 new Triage Runs start per Workspace per poll.
- After 3 failed, invalid or expired attempts, one comment stops triage until the Ticket changes.
- Session Runs end with `submit_triage`. Autonomous Runs write `.bauherr/triage.json` and the server applies it with the same validation.

The Review and Release stages run Jobs, see [Review](review.md) and [Release](release.md). The workflow is config in Git, compiled into a versioned Postgres row on change, see [Factory file](factory-file.md).

## Human takeover

A human assignee or a manual label move cancels the active Run. Nothing restarts until `bauherr:go` or unassign. The next Run reconciles the [worklog](https://github.com/getbauherr/bauherr/blob/main/pack/skills/worklog/SKILL.md).

## Run contract

A Run reads its Goal and the worklog first, ends only with an MR or a declared blocker, and updates the worklog last.

- The Goal is the Ticket's `## Acceptance criteria`, or a Goal the Plan Run writes and the Bauherr approves.
- Skills: [run-contract](https://github.com/getbauherr/bauherr/blob/main/pack/skills/run-contract/SKILL.md) and [worklog](https://github.com/getbauherr/bauherr/blob/main/pack/skills/worklog/SKILL.md). Rule: [evidence](https://github.com/getbauherr/bauherr/blob/main/pack/rules/evidence.md).
- `run-contract` has a shared `SKILL.md` plus `session.md` and `autonomous.md`. `load_skill` serves `SKILL.md` and `session.md`. The Runner appends `autonomous.md`. Neither mode sees the other's part.
- Autonomous Runs are enforced by the Runner's Stop hook, `checkGoal` in `packages/runner/src/agent.ts`. Session Runs follow convention. `request_review` runs only the Product's `reviewChecks`.
- `pack/hooks/stop-goal-check.ts` is a reference stub, not active.

## Roles and tiers

Roles come from `team.roles` of the factory file and are the only source of roles. A session never assigns itself a role. Policy: [team-policy](https://github.com/getbauherr/bauherr/blob/main/pack/rules/team-policy.md).

Team patterns: one agent per Run, and a session may hand work to one subagent on the role's model.

| Stage | Pattern | Skill |
|---|---|---|
| Review | Manager thread, one reviewer thread per MR | [manager](https://github.com/getbauherr/bauherr/blob/main/pack/skills/manager/SKILL.md) |
| Plan research | Parallel lanes with owners | [coordinate](https://github.com/getbauherr/bauherr/blob/main/pack/skills/coordinate/SKILL.md) |
| Any | Pair threads | Not supported |

The Runner's write-scope guard, `packages/runner/src/guards.ts`, enforces patterns for autonomous Runs. `pack/hooks/write-scope-guard.ts` is a stub, not active.

## Model and effort policy

Tiers resolve to model names from the Workspace's tiers. The fourth tier `auto` exists only with a `router` Connection, see [router](../router.md). How to apply: [effort-policy](https://github.com/getbauherr/bauherr/blob/main/pack/skills/effort-policy/SKILL.md).

This table is what runs. `bauherr pack lint` fails when the factory file or a preset differs from it, so change both together. Escalated Runs use `strong` whatever the table says.

| Role | Tier |
|---|---|
| orchestrator | cheap |
| engineer | standard |
| reviewer | strong |
| security | standard |
| ux | standard |
| test | standard |
| docs | standard |
| ax | strong |
| verifier | strong |

- Inside a Run, the role delegates search, formatting and test runs to `cheap` at low effort. A strong adviser answers on request.
- Manager and research threads follow the role of the stage that starts them.
- Max effort is never the default. Raising effort is recorded in the worklog.

## Who executes a stage

`executorOf` gives each stage one line, such as "Engineer · 1 working · 2 idle", and at most one action. The rules are in [Agent sessions](sessions.md#who-executes-a-stage).

## Budgets

- Per Run: the Runner sets `maxTurns` and `maxBudgetUsd`. The real cap is the gateway key budget, and `maxBudgetUsd` can overshoot.
- The gateway enforces the Workspace budget, USD over a rolling 30 days. Exhaustion ends the Run `budget_exhausted`.
- Re-wakes draw from the same Run budget.
- At 80% the Run converges or declares a blocker.
- Defaults are stage config.

## Egress and security context

- Code and context leave only through the gateway, rule [egress](https://github.com/getbauherr/bauherr/blob/main/pack/rules/egress.md). The Runner's egress guard and the gateway enforce it for autonomous Runs. Session Runs follow convention. `pack/hooks/egress-guard.sh` is a stub, not active.
- The gateway belongs to the instance. The Workspace's provider credential never reaches an agent. Operator notes: [legal](../legal.md).
- Each Product keeps `SECURITY-CONTEXT.md` at `products/<slug>/` in the Knowledge repo. The `scan` stage of `pack/workflow-security.yaml` reads it, rule [security-context](https://github.com/getbauherr/bauherr/blob/main/pack/rules/security-context.md).

## What people see

| Who | Sees |
|---|---|
| Bauherr | Plan comment, Goal status, worklog, decision sheet and Approve button at the plan gate; MR link, `## Evidence`, reviewer comments, cost and model at the MR gate; why a Run stopped; the `bauherr:blocked` reason |
| Product user | The Ticket with its stage label and comments addressed to them. No Runs, worklogs, budgets or configuration |


## Pack artifacts

Manifest: [pack.yaml](https://github.com/getbauherr/bauherr/blob/main/pack/pack.yaml). Hooks map to SDK events in [hooks.yaml](https://github.com/getbauherr/bauherr/blob/main/pack/hooks/hooks.yaml). The factory file is described in [Factory file](factory-file.md).
