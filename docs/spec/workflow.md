# Workflow spec (v0.1)

The single human-readable spec of the Bauherr workflow. Rules live in the core pack; this page links to them and does not repeat them. Decisions: #10 (workflow), #37 (Run contract), #36/#39 (team patterns).

## 1. Stages and labels
Triage → Plan → Build → Review → Release → Done. Fixed in v0.1.

- The Stage is a Label in the Ticket source: `bauherr:stage:<name>` (the same on GitLab: scoped `stage::` labels are Premium+). Bauherr derives it and never stores it as truth.
- Other labels: `bauherr:go` (start), `bauherr:approved:plan` (plan gate), `bauherr:approved:staging` (staging gate), `bauherr:blocked` (needs a person).

| Stage | Agent work | Ends with |
|---|---|---|
| Triage | cheap triage Run per open, unassigned Ticket without a stage label ([triage](../../pack/skills/triage/SKILL.md)); a Ticket carrying one of the stage's `exclude_labels` in `pack/workflow.yaml` (`wayfinder:map\|grilling\|research`) is not triaged; no gate, but a `refine` hold shows the owner an "Answer questions" Gate (assignee + mention, #77) | `plan`: stage label plan; `refine`: label `bauherr:needs-refinement` + a decision-sheet Comment for the owner, the stage label plan once every critical question is answered; `skip`: reason Comment, no stage. Re-triaged only when the Ticket changes; at most 5 new Triage Runs per Workspace per poll, and after 3 failed, invalid or expired attempts one Comment stops it until the Ticket changes. Session Runs end with `submit_triage`; autonomous Runs write `.bauherr/triage.json` (no shell, writes only under `.bauherr/`) and the server applies it through the same validation |
| Plan | plan Run | plan Comment + Goal in the worklog (+ Sub-tickets if large) |
| Build | build Run | MR Linked on the Ticket |
| Review | review Run: reviewer without memory of the change ([review](../../pack/skills/review/SKILL.md)) | review Comment on the MR; merge or back to Build |
| Release (shown as Staging) | none; Bauherr observes the Product's CI (or a deploy webhook) after the MR merged | staging summary Comment + staging acceptance |
| Done | none | Ticket closed `completed` on staging acceptance (never on merge) |

Config per stage: label, gate-before (`none | human | checks`), max runs, and the stage's **steps** (§15). The workflow is config in Git, compiled into a versioned Postgres row on change (§15).

## 2. Gates and approvals
| Gate | Before | Approval lives in |
|---|---|---|
| Plan approval (human) | Build | label `bauherr:approved:plan`, set in the Bauherr UI or in the forge |
| MR gate (factory) | merge | clean review + green checks + `## Evidence` + Product `autoMerge` (below); no human |
| Staging acceptance (human) | Done | label `bauherr:approved:staging`, set in the UI |

Sub-tickets: a plan may end with a `## Sub-tickets` section, one list item per child: `- **Title** — one-line body` (body may continue on indented lines, e.g. acceptance criteria; an indented `after: <sibling title>` line, exact title of another item in the section, makes the child blocked by that sibling: forge `addBlockedBy` plus local `tickets.blockedBy`, so claim_next and the frontier skip it until the sibling is closed; an unknown title is ignored with a logged warning; no implicit chain). On plan approval (UI, MCP `approve`, or the `bauherr:approved:plan` label seen by `poll-tickets`) the factory creates each listed item as a forge sub-issue (`addSubTicket`; GitLab Free, which has none, uses a `Parent: #n` body line) labelled `bauherr:stage:plan` and `bauherr:approved:plan`, so Build starts without a second approval, and records `tickets.inheritedApprovalFrom`. Inheritance rule: only items listed at approval time inherit; the factory never adds `approved:plan` to a child created later, and an approval label a human sets on a child is an ordinary manual approval. Creation is idempotent (children matched by title, also against local child rows whose forge link failed, which are only linked, never created again; the parent leaves stage `plan` only after all exist). The parent moves to stage `parent` (shown as "Split" on the Board, n/m done, no Runs) and closes with a Comment listing the children once all are closed (`poll-tickets`). Nested children and moving children between parents are out of scope.

**Notifying the gate's person.** Every needs-you value (Approve plan, Answer decisions, Accept on staging, Staging not confirmed, Run needs you, Run failed) is a human gate. The scheduled task `notify-gates` (every minute) assigns the gate's people on the forge issue (`products.gateOwners`, else the Admin Bauherren with a `githubLogin`) and posts one `<!-- bauherr:gate:<value>:<sha1 of value+run id> -->` Comment that @mentions them and links the Ticket page (`PUBLIC_URL`), so GitHub notifies them. Once per gate value (`tickets.gateNotified`, `gateNotifiedAt`; Approve plan and Answer decisions count as one gate); no reminders. When the gate passes or changes, the factory unassigns exactly the logins it added (`tickets.gateAssignees`) that do not own the next gate; other assignees stay. Failed claims are retried each minute and a gate counts as notified only once every owner is assigned. Without owners nothing is notified. A session Run's release unassigns only its own login.

Review: a Ticket entering `review` with a factory MR gets a Review Run (mode follows the Workspace; session Runs end with `submit_review`, autonomous Runs write `.bauherr/review.json`). It posts one `<!-- bauherr:review -->` Comment on the MR: verdict, findings (severity, file:line, defect, scenario), Open. The verdict is `changes` iff a high or medium finding exists.
- `changes`: blocking findings are appended to the worklog's Unfinished work and low findings to Open (each once; Current instructions only points to them), the stage goes to `build` and a Build Run starts on the **same MR branch** (no second MR).
- `clean`: the merge gate squash-merges (pinned to the reviewed head SHA) and deletes a same-repo branch when all of this holds. The MR is an open, non-draft factory MR (same repo, head branch `bauherr/<ticket>-...`) whose head is still the SHA the review covered; if the head moved, a new Review Run starts (no round). Every check run and commit status on the head passed; no checks counts as green only once the head commit is 10 minutes old. The MR body has a non-empty `## Evidence` section. Product `autoMerge` is on (default). Checks pending or draft: `reviewState` `waiting_checks`, re-checked each minute by `watch-release`; waiting more than 2 hours, or 3 consecutive failed merges, is `needs_human`. Checks red: back to Build with the check names. An MR the forge reports as conflicting goes back to Build with the merge-main instruction (merge, never rebase or force push); this is neither a round nor a failed merge; the server stores the reviewed SHA (`conflictReturnBase`) and the next review covers only the diff from it; the 4th conflict return needs a human. `autoMerge` off, or no Evidence: a "ready to merge" Comment and `reviewState` `ready_for_human`; the merge stays with a human.
- The review output must include `checked` (correctness, over-engineering, spec-vs-plan, evidence, each with a one-line justification) and a verdict that matches its findings; otherwise the Ticket goes to `ready_for_human` and is never merged. A failure while concluding sets `needs_human` with a Ticket Comment. A review Run that holds its verdict while the Ticket is still in `review` with no `reviewState` (the app stopped before applying it) is concluded again by `watch-release` after 2 minutes, without a second MR comment. Reviewer prompts exclude the MR title and body; Ticket, plan, worklog and diff text are fenced as untrusted data.
- Round cap: each return to Build (changes verdict or red checks) is a round; after 2 rounds the next return goes to `needs_human` (Ticket Comment). `tickets.reviewRounds` counts them and is only ever lowered by an owner grant. At the cap the Ticket page shows the Gate "Round cap reached" (needs-you) with the findings: "Grant one more round" lowers `reviewRounds` by 1, resets `reviewState` and returns to Build on the same MR (a second cap hit shows the gate again; a clean review then merges as usual); "Stop" leaves the MR open and moves the Ticket to `triage` with a Comment, `reviewRounds` kept. Both record a human touch (`review-cap:grant`, `review-cap:stop`), are owner-only (Admin or Workspace Bauherr) and refuse a Ticket not at the cap.
- A merge by the factory is no human touch; the next `watch-release` pass moves the Ticket to `release`.

Release: the scheduled task `watch-release` (every minute) moves a `review` Ticket whose MR merged to `release` and stores the merge commit. `observe-ci` Products: the commit's check runs (all, or `deployChecks`) are green; `webhook` Products: the webhook is POSTed once and `stagingUrl` answers 200. Then the factory posts one `<!-- bauherr:staging-summary -->` Comment (templated, no model: What you get, Found on the way, Decisions taken, Open, Accept). Not confirmed after 60 minutes: `releaseState` `timed_out` and the Comment "staging not confirmed". Only acceptance closes a Ticket: MRs reference it with `Refs <url>` and never `Closes/Fixes/Resolves`. If a merge closed it anyway (body keyword, commit message, manual close) and no acceptance label exists, `watch-release` reopens the Ticket once the factory MR is merged, posts one `<!-- bauherr:reopened -->` Comment and continues; a Ticket closed by a human before any factory MR merged stays closed. A Workspace Bauherr accepts (stage `done`, or held when `products.productionGate`) or requests changes with a note (worklog Current instructions, stage `build`, new Build Run).

Everything else is automated. The `checks` gate is the Product's **scorecard** (ordered rules with a guide each: build, tests, lint baseline, pack lint, security context, evidence section — decision #38): a failing blocking rule prevents Review, re-wakes the Build Run once, then `needs_human`. Bauherr mirrors both approvals into Run state for audit. Per-type autopilot: not in v0.1.

## 3. Triggers
Only on factory-derived events (diffs of poll summaries against the stored Ticket pointer):
- entered-stage (Label change), label added (`bauherr:go`), manual (admin button sets the Label), schedule (creates a Ticket first)
- `check_failed`: CI failure on a Build Run's MR; `mr_comment`: review comment on it. Each re-wakes the Build Run within its remaining budget. A second CI failure after a re-wake → `needs_human`. In `review` these are handled by the merge gate and the round cap above.
- Review: entering `review` with an open factory MR (poller, `request_review`, or a Build Run finishing with an MR) starts the Review Run; returning from review starts a Build Run on the same branch.

A Run starts when a Ticket enters a stage with an agent and has no human assignee (logins the factory added for a gate do not count; a Ticket without any Run of that stage is also started once the assignee is gone). One Run per (Ticket, stage entry).

## 4. Run contract (summary)
A Run reads its Goal, reads the worklog first, ends only with an MR or a declared blocker, updates the worklog last.
- Goal = the Ticket's `## Acceptance criteria`, or a Goal the Plan Run writes and the Bauherr approves.
- Skill: [run-contract](../../pack/skills/run-contract/SKILL.md) · [worklog](../../pack/skills/worklog/SKILL.md)
- Rule: [evidence](../../pack/rules/evidence.md)
- Hook: [stop-goal-check](../../pack/hooks/stop-goal-check.ts)

## 5. Run states and retries
`queued → running → succeeded | failed | cancelled | needs_human | budget_exhausted | abandoned`.
- Ticket lease: a session Run is leased to one coordinator by a `leaseToken` (only its hash is stored) returned by `claim_run` and required on every owning call, so a second session under the same user is refused. The lease applies to claimed Runs and lasts 30 minutes from the last heartbeat; unclaimed session Runs do not expire (only unclaimed Triage Runs do). On expiry the Run ends `abandoned` and a new `awaiting_session` Run (same Ticket and stage, `previousRun` set) is claimable; a second consecutive `abandoned` Run ends `needs_human`. A Workspace Bauherr can "Release lock" on the Run page (same as expiry, never `needs_human`; recorded as a human touch). A late owner gets `lease lost`. `abandoned` is terminal and not rerunnable: its successor Run exists. See [run-contract](../../pack/skills/run-contract/SKILL.md).
- One automatic retry with the failure appended; a second failure → `needs_human` (`bauherr:blocked` + Comment).
- `cancelled` when the Ticket is closed, moved back, or a human claims it.
- `budget_exhausted`: the gateway answered 429 because the Workspace budget is used up. Terminal, no retry.
- Concurrency key `ticket:<id>`; `retries: 0` at job level (retry is Bauherr's).

## 6. Human takeover
A human assignee or a manual Label move cancels the active Run. Nothing restarts until `bauherr:go` or unassign. The next Run reconciles the worklog ([worklog](../../pack/skills/worklog/SKILL.md)).

## 7. Human interaction
One decision sheet per Ticket per gate (the newest plan or triage Comment; only answers posted after it count, so a new sheet starts unanswered), with recommended defaults and a `critical` flag; at most one human touch. Protocol: [decision-sheet](../../pack/skills/decision-sheet/SKILL.md).

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

Intake: `POST /intake/api/sessions` (Product), `.../:id/messages` (one interview turn, SSE `turn` event), `.../:id/submit`. The engine asks one question per turn through the gateway (skill [intake](../../pack/skills/intake/SKILL.md), standard tier), at most 6 questions; completeness (problem, context, >= 2 criteria, screenshot for screen requests) is computed by the engine, not the model. Submit creates the Ticket without a stage label, so Triage picks it up, with `type:`/`product:` labels, an `## Open` section for gaps and the interview as a Comment.

## 14. Pack artifacts index
Manifest: [pack.yaml](../../pack/pack.yaml). Hooks map to SDK events in [hooks.yaml](../../pack/hooks/hooks.yaml).

## 15. Steps and workflow config
A stage is an ordered DAG of steps (decision #44). Step types: `agent-run` (a Run with a Goal), `external-service` (a connected agent service, e.g. a code-security scanner; callback with poll fallback; findings become Tickets, Comments or scorecard results), `ci-job` (wait for a named check), `human-gate`, `check` (scorecard rule). Step contract: `{id, type, needs, inputs, timeout, budget?, retries}` → `{status, outputs, evidence, started, finished, cost}`. A failed blocking step stops the stage; *repair run* re-runs failed steps only.

Where the workflow lives (decision #45): base `pack/workflow.yaml` in the core pack (read-only in the UI), per-Product overlay `products/<slug>/workflow.yaml` in the Knowledge repo; the factory compiles the merged DAG into a `workflow_versions` row that Runs reference. Validated by `bauherr pack lint`.

What the Bauherr sees per Ticket run: graph (nodes with status, duration, type, resource), timeline (nested sub-steps, dependency arrows), list (filterable), run details (launched by, started, ended, duration, status, cost), repair run. Per Product: the compiled workflow with the overlay diff highlighted.
