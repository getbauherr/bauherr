# Workflow spec (v0.1)

The single human-readable spec of the Bauherr workflow. Rules live in the core pack; this page links to them and does not repeat them. Decisions: #10 (workflow), #37 (Run contract), #36/#39 (team patterns).

## 1. Stages and labels
Triage → Plan → Build → Review → Release → Done. Fixed in v0.1.

- The Stage is a Label in the Ticket source: `bauherr:stage:<name>` (GitLab scoped: `stage::<name>`). Bauherr derives it and never stores it as truth.
- Other labels: `bauherr:go` (start), `bauherr:approved:plan` (plan gate), `bauherr:approved:staging` (staging gate), `bauherr:blocked` (needs a person).

| Stage | Agent work | Ends with |
|---|---|---|
| Triage | none (dedupe hints only) | Bauherr moves to Plan or closes `not_planned` |
| Plan | plan Run | plan Comment + Goal in the worklog (+ Sub-tickets if large) |
| Build | build Run | MR Linked on the Ticket |
| Review | reviewer agent without memory of the change | review Comments on the MR |
| Release | none; Bauherr observes the Product's CI (or a deploy webhook) after the MR merged | staging summary Comment + staging acceptance |
| Done | none | Ticket closed `completed` on merge |

Config per stage: label, gate-before (`none | human | checks`), max runs, and the stage's **steps** (§15). The workflow is config in Git, compiled into a versioned Postgres row on change (§15).

## 2. Gates and approvals
| Gate | Before | Approval lives in |
|---|---|---|
| Plan approval (human) | Build | label `bauherr:approved:plan`, set in the Bauherr UI or in the forge |
| MR approval (human) | merge | native forge review + merge |
| Staging acceptance (human) | Done | label `bauherr:approved:staging`, set in the UI |

Release: the scheduled task `watch-release` (every minute) moves a `review` Ticket whose MR merged to `release` and stores the merge commit. `observe-ci` Products: the commit's check runs (all, or `deployChecks`) are green; `webhook` Products: the webhook is POSTed once and `stagingUrl` answers 200. Then the factory posts one `<!-- bauherr:staging-summary -->` Comment (templated, no model: What you get, Found on the way, Decisions taken, Open, Accept). Not confirmed after 60 minutes: `releaseState` `timed_out` and the Comment "staging not confirmed". A Workspace Bauherr accepts (stage `done`, or held when `products.productionGate`) or requests changes with a note (worklog Current instructions, stage `build`, new Build Run).

Everything else is automated. The `checks` gate is the Product's **scorecard** (ordered rules with a guide each: build, tests, lint baseline, pack lint, security context, evidence section — decision #38): a failing blocking rule prevents Review, re-wakes the Build Run once, then `needs_human`. Bauherr mirrors both approvals into Run state for audit. Per-type autopilot: not in v0.1.

## 3. Triggers
Only on factory-derived events (diffs of poll summaries against the stored Ticket pointer):
- entered-stage (Label change), label added (`bauherr:go`), manual (admin button sets the Label), schedule (creates a Ticket first)
- `check_failed`: CI failure on a Build Run's MR; `mr_comment`: review comment on it. Each re-wakes the Build Run within its remaining budget. A second CI failure after a re-wake → `needs_human`.

A Run starts when a Ticket enters a stage with an agent and has no human assignee. One Run per (Ticket, stage entry).

## 4. Run contract (summary)
A Run reads its Goal, reads the worklog first, ends only with an MR or a declared blocker, updates the worklog last.
- Goal = the Ticket's `## Acceptance criteria`, or a Goal the Plan Run writes and the Bauherr approves.
- Skill: [run-contract](../../pack/skills/run-contract/SKILL.md) · [worklog](../../pack/skills/worklog/SKILL.md)
- Rule: [evidence](../../pack/rules/evidence.md)
- Hook: [stop-goal-check](../../pack/hooks/stop-goal-check.ts)

## 5. Run states and retries
`queued → running → succeeded | failed | cancelled | needs_human | budget_exhausted`.
- One automatic retry with the failure appended; a second failure → `needs_human` (`bauherr:blocked` + Comment).
- `cancelled` when the Ticket is closed, moved back, or a human claims it.
- `budget_exhausted`: the gateway answered 429 because the Workspace budget is used up. Terminal, no retry.
- Concurrency key `ticket:<id>`; `retries: 0` at job level (retry is Bauherr's).

## 6. Human takeover
A human assignee or a manual Label move cancels the active Run. Nothing restarts until `bauherr:go` or unassign. The next Run reconciles the worklog ([worklog](../../pack/skills/worklog/SKILL.md)).

## 7. Human interaction
One decision sheet per Ticket per gate, with recommended defaults and a `critical` flag; at most one human touch. Protocol: [decision-sheet](../../pack/skills/decision-sheet/SKILL.md).

## 8. Team patterns allowed in v0.1
One agent per Run by default. Patterns only via stage config with a declared problem. Policy: [team-policy](../../pack/rules/team-policy.md).

| Stage | Pattern | Skill |
|---|---|---|
| Review | manager thread, one reviewer thread per MR | [manager](../../pack/skills/manager/SKILL.md) |
| Plan (research) | parallel lanes with owners | [coordinate](../../pack/skills/coordinate/SKILL.md) |
| any | pair threads | not in v0.1 |

Enforcement: [write-scope-guard](../../pack/hooks/write-scope-guard.ts).

## 9. Model and effort policy
Tiers, resolved to model names from the Workspace's tiers. How to apply: [effort-policy](../../pack/skills/effort-policy/SKILL.md).

| Stage / step | Tier | Effort |
|---|---|---|
| Plan | standard (strong adviser on request) | medium |
| Build | standard | medium |
| Build: search, formatting, test runs | cheap | low |
| Review | strong, fresh context | medium |
| Manager thread | cheap | low |
| Research lane | standard | medium |

Max effort is never the default. Raising effort is recorded in the worklog.

## 10. Budgets
- Per Run: `maxTurns` and `maxBudgetUsd` set by the Runner; the real cap is the gateway key budget (`maxBudgetUsd` can overshoot).
- The gateway enforces the Workspace budget (USD, rolling 30 days); exhaustion ends the Run `budget_exhausted`.
- Re-wakes draw from the same Run budget.
- At 80% the Run converges or declares a blocker.
- Defaults are config values per stage, not fixed here.

## 11. Egress and security context
- Code and context leave only via the gateway: [egress](../../pack/rules/egress.md), [egress-guard](../../pack/hooks/egress-guard.sh).
- The gateway is part of the instance, and the Workspace's provider credential never reaches an agent. Operator notes: [legal](../legal.md).
- Each Product keeps a `SECURITY-CONTEXT.md` at the root of its main Repository; a copy under `products/<slug>/` in the Knowledge repo takes precedence: [security-context](../../pack/rules/security-context.md).

## 12. What the Bauherr sees
| At | In the admin |
|---|---|
| Plan gate | plan Comment, Goal statements, worklog panel, decision sheet, Approve button (sets `bauherr:approved:plan`) |
| MR gate | MR Link, `## Evidence` next to it, Goal with per-statement status, reviewer Comments, budget and model used |
| Any Run page | Goal status, evidence, why it stopped, worklog, Steps, cost |
| Blocked | `bauherr:blocked` reason and the decision sheet |

## 13. What a Product user sees
Intake session, then the Ticket in the Ticket source with its Stage Label and Comments (plan, review, decision sheets addressed to them). No Runs, worklogs, budgets or configuration.

## 14. Pack artifacts index
Manifest: [pack.yaml](../../pack/pack.yaml). Hooks map to SDK events in [hooks.yaml](../../pack/hooks/hooks.yaml).

## 15. Steps and workflow config
A stage is an ordered DAG of steps (decision #44). Step types: `agent-run` (a Run with a Goal), `external-service` (a connected agent service, e.g. a code-security scanner; callback with poll fallback; findings become Tickets, Comments or scorecard results), `ci-job` (wait for a named check), `human-gate`, `check` (scorecard rule). Step contract: `{id, type, needs, inputs, timeout, budget?, retries}` → `{status, outputs, evidence, started, finished, cost}`. A failed blocking step stops the stage; *repair run* re-runs failed steps only.

Where the workflow lives (decision #45): base `pack/workflow.yaml` in the core pack (read-only in the UI), per-Product overlay `products/<slug>/workflow.yaml` in the Knowledge repo; the factory compiles the merged DAG into a `workflow_versions` row that Runs reference. Validated by `bauherr pack lint`.

What the Bauherr sees per Ticket run: graph (nodes with status, duration, type, resource), timeline (nested sub-steps, dependency arrows), list (filterable), run details (launched by, started, ended, duration, status, cost), repair run. Per Product: the compiled workflow with the overlay diff highlighted.
