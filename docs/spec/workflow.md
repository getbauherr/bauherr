# Workflow spec (v0.1)

The single human-readable spec of the Bauherr workflow. Rules live in the core pack; this page links to them and does not repeat them. Decisions: #10 (workflow), #37 (Run contract), #36/#39 (team patterns).

## 1. Stages and labels
Triage → Plan → Build → Review → Release → Done. Fixed in v0.1.

- The Stage is a Label in the Ticket source: `bauherr:stage:<name>` (the same on GitLab: scoped `stage::` labels are Premium+). Bauherr derives it and never stores it as truth.
- Other labels: `bauherr:go` (start), `bauherr:approved:plan` (plan gate, only with the plan gate on), `bauherr:approved:staging` (staging gate; with the release gate off the factory sets it itself when staging is confirmed), `bauherr:blocked` (needs a person).

| Stage | Agent work | Ends with |
|---|---|---|
| Triage | cheap triage Run per open, unassigned Ticket without a stage label ([triage](../../pack/skills/triage/SKILL.md)); a Ticket carrying one of the stage's `exclude_labels` in `pack/workflow.yaml` (`wayfinder:map\|grilling\|research`) is not triaged; no gate, but a `refine` hold shows the owner an "Answer questions" Gate (assignee + mention, #77) | `plan`: stage label plan; `refine`: label `bauherr:needs-refinement` + a decision-sheet Comment for the owner, the stage label plan once every critical question is answered; `skip`: reason Comment, no stage. Re-triaged only when the Ticket changes; at most 5 new Triage Runs per Workspace per poll, and after 3 failed, invalid or expired attempts one Comment stops it until the Ticket changes. Session Runs end with `submit_triage`; autonomous Runs write `.bauherr/triage.json` (no shell, writes only under `.bauherr/`) and the server applies it through the same validation |
| Plan | plan Run | plan Comment + Goal in the worklog (+ Sub-tickets if large) |
| Build | build Run | MR Linked on the Ticket |
| Review | review Run: reviewer without memory of the change ([review](../../pack/skills/review/SKILL.md)) | review Comment on the MR; merge or back to Build |
| Release (shown as Staging) | none; Bauherr observes the Product's CI (or a deploy webhook) after the MR merged | staging summary Comment + staging acceptance |
| Done | none | Ticket closed `completed` on staging acceptance (never on merge) |

Config per stage: label, gate (`human` or absent; see §2), max runs, and the stage's **steps** (§15). The workflow is config in Git, compiled into a versioned Postgres row on change (§15).

## 2. Gates and approvals
Human gates are workflow config in `pack/workflow.yaml`. Default: exactly two human touch points, **refine** (Triage's questions, always on) and **production** (`production_gate: human` on `release`, on by default; a Product without `productionChecks` shows the visible gate "Configure production checks" (Ticket page, links to Settings > Products, listed in needs-you) until checks exist, then the normal "Approve production" gate; if `production_gate` is removed from the workflow, a staging-confirmed Ticket goes to `done`). **Plan** (`gate: human` on `plan`) and **staging** (`gate: human` on `release`) are optional and off by default: a Ticket triaged `plan` then reaches a merged MR and the production gate without an owner touch. `humanGates()` in `apps/server/src/lib/mode.ts` lists the enabled gates (also for the label-actor guard, #174). Per-Product overlays are §15.

| Gate | Before | Approval lives in |
|---|---|---|
| Plan approval (human, optional: `plan` `gate: human`) | Build | label `bauherr:approved:plan`, set in the Bauherr UI or in the forge |
| MR gate (factory) | merge | clean review + green checks + `## Evidence` + Product `autoMerge` (below); no human |
| Staging acceptance (human, optional: `release` `gate: human`) | Done, or Production approval with a production gate | label `bauherr:approved:staging`, set in the UI |
| Production approval (human, default on via `production_gate: human` on `release` (a Product can also turn it on with `productionGate`); without `productionChecks` the Ticket shows "Configure production checks" first; with the workflow gate off the Ticket goes to done) | deploy | UI Gate or MCP `approve_production` (records the human touch); the label `bauherr:approved:production` is an output signal only, set by the factory after such an approval, never an approval itself |

Gate off: with the plan gate off, `poll-tickets` (`advancePlan`) moves a Ticket in `plan` whose latest Run is a succeeded plan Run to `build` (or `parent`) once a plan Comment exists and no critical decision is open; it adds no `bauherr:approved:plan` label, records no human touch and posts one audit Comment; Sub-tickets are created labelled `bauherr:stage:build` only. With the release gate off, `watch-release` runs the acceptance step itself once staging is confirmed (label `bauherr:approved:staging`, then the production gate (on by default, else `done` and closed)), without a touch; `timed_out` stays a blocker. The needs-you values Approve plan, Answer decisions and Accept on staging appear only while their gate is on; the Board's "needs you" is then refine questions, the production gate and declared blockers (Run needs you, Staging not confirmed, Round cap reached, Run failed).

Gate tools over MCP (`approve`, `accept_staging`, `grant_review_round`, `stop_review`, `request_changes`) are human-only: `/mcp` refuses them for an agent key, see [session mode](../session-mode.md#agent-identity).

Sub-tickets: a plan may end with a `## Sub-tickets` section, one list item per child: `- **Title** — one-line body` (body may continue on indented lines, e.g. acceptance criteria; an indented `after: <sibling title>` line, exact title of another item in the section, makes the child blocked by that sibling: forge `addBlockedBy` plus local `tickets.blockedBy`, so claim_next and the frontier skip it until the sibling is closed; an unknown title is ignored with a logged warning; no implicit chain). On plan approval (UI, MCP `approve`, or the `bauherr:approved:plan` label seen by `poll-tickets`) the factory creates each listed item as a forge sub-issue (`addSubTicket`; GitLab Free, which has none, uses a `Parent: #n` body line) labelled `bauherr:stage:plan` and `bauherr:approved:plan`, so Build starts without a second approval, and records `tickets.inheritedApprovalFrom`. Inheritance rule: only items listed at approval time inherit; the factory never adds `approved:plan` to a child created later, and an approval label a human sets on a child is an ordinary manual approval. Creation is idempotent (children matched by title, also against local child rows whose forge link failed, which are only linked, never created again; the parent leaves stage `plan` only after all exist). The parent moves to stage `parent` (shown as "Split" on the Board, n/m done, no Runs) and closes with a Comment listing the children once all are closed (`poll-tickets`). Nested children and moving children between parents are out of scope.

**Notifying the gate's person.** Every needs-you value (Approve plan, Answer decisions, Accept on staging, Staging not confirmed, Configure production checks, Approve production, Production deploy failed, Run needs you, Run failed) is a human gate. The scheduled task `notify-gates` (every minute) assigns the gate's people on the forge issue (`products.gateOwners`, else the Admin Bauherren with a `githubLogin`) and posts one `<!-- bauherr:gate:<value>:<sha1 of value+run id> -->` Comment that @mentions them and links the Ticket page (`PUBLIC_URL`), so GitHub notifies them. Once per gate value (`tickets.gateNotified`, `gateNotifiedAt`; Approve plan and Answer decisions count as one gate); no reminders. When the gate passes or changes, the factory unassigns exactly the logins it added (`tickets.gateAssignees`) that do not own the next gate; other assignees stay. Failed claims are retried each minute and a gate counts as notified only once every owner is assigned. Without owners nothing is notified; when every owner is rejected for good (unknown or unassignable login) the gate is not marked notified, `tickets.gateUnreachable` shows "no reachable owner" in the overview, and it is retried each minute. A login with a running session Run stays assigned when the gate passes. A session Run's release unassigns only its own login.

Review: a Ticket entering `review` with a factory MR gets a Review Run (mode follows the Workspace; session Runs end with `submit_review`, autonomous Runs write `.bauherr/review.json`). It posts one `<!-- bauherr:review -->` Comment on the MR: verdict, findings (severity, file:line, defect, scenario), Open. The verdict is `changes` iff a high or medium finding exists.
- `changes`: blocking findings are appended to the worklog's Unfinished work and low findings to Open (each once; Current instructions only points to them), the stage goes to `build` and a Build Run starts on the **same MR branch** (no second MR).
- `clean`: the merge gate squash-merges (pinned to the reviewed head SHA) and deletes a same-repo branch when all of this holds. The MR is an open, non-draft factory MR (same repo, head branch `bauherr/<ticket>-...`) whose head is still the SHA the review covered; if the head moved, a new Review Run starts (no round). Every check run and commit status on the head passed; no checks counts as green only once the head commit is 10 minutes old. The MR body has a non-empty `## Evidence` section. Product `autoMerge` is on (default). Checks pending or draft: `reviewState` `waiting_checks`, re-checked each minute by `watch-release`; waiting more than 2 hours, or 3 consecutive failed merges, is `needs_human`. Checks red: back to Build with the check names. An MR the forge reports as conflicting goes back to Build with the merge-main instruction (merge, never rebase or force push); this is neither a round nor a failed merge; the server stores the reviewed SHA (`conflictReturnBase`) and the next review covers only the diff from it; the 4th conflict return needs a human. `autoMerge` off, or no Evidence: a "ready to merge" Comment and `reviewState` `ready_for_human`; the merge stays with a human.
- The review output must include `checked` (correctness, over-engineering, spec-vs-plan, evidence, each with a one-line justification) and a verdict that matches its findings; otherwise the Ticket goes to `ready_for_human` and is never merged. A failure while concluding sets `needs_human` with a Ticket Comment. A review Run that holds its verdict while the Ticket is still in `review` with no `reviewState` (the app stopped before applying it) is concluded again by `watch-release` after 2 minutes, without a second MR comment. Reviewer prompts exclude the MR title and body; Ticket, plan, worklog and diff text are fenced as untrusted data.
- Round cap: each return to Build (changes verdict or red checks) is a round; after 2 rounds the next return goes to `needs_human` (Ticket Comment). `tickets.reviewRounds` counts them and is only ever lowered by an owner grant. At the cap the Ticket page shows the Gate "Round cap reached" (needs-you) with the findings: "Grant one more round" lowers `reviewRounds` by 1, resets `reviewState` and returns to Build on the same MR (a second cap hit shows the gate again; a clean review then merges as usual); "Stop" leaves the MR open and moves the Ticket to `triage` with a Comment, `reviewRounds` kept. Both record a human touch (`review-cap:grant`, `review-cap:stop`), are owner-only (Admin or Workspace Bauherr) and refuse a Ticket not at the cap.
- A merge by the factory is no human touch; the next `watch-release` pass moves the Ticket to `release`.

Release: the scheduled task `watch-release` (every minute) moves a `review` Ticket whose MR merged to `release` and stores the merge commit. `observe-ci` Products: the commit's check runs (all, or `deployChecks`) are green; `webhook` Products: the webhook is POSTed once and `stagingUrl` answers 200. Then the factory posts one `<!-- bauherr:staging-summary -->` Comment (templated, no model: What you get, Found on the way, Decisions taken, Open, Accept). Not confirmed after 60 minutes: `releaseState` `timed_out` and the Comment "staging not confirmed". Only acceptance closes a Ticket: MRs reference it with `Refs <url>` and never `Closes/Fixes/Resolves`. If a merge closed it anyway (body keyword, commit message, manual close) and no acceptance label exists, `watch-release` reopens the Ticket once the factory MR is merged and the forge close reason is `completed`, posts one `<!-- bauherr:reopened -->` Comment and continues. A `not_planned`/`duplicate` close, or a close before any factory MR merged, is respected: the Ticket is set to `done` with one `<!-- bauherr:dropped -->` note; accepted Tickets are settled to `done` the same way. Every closed review/release Ticket is decided in its first pass and no longer matches the query. A Workspace Bauherr accepts (stage `done`, or held in `release` as `productionState` `awaiting_approval` while the production gate is on) or requests changes with a note (worklog Current instructions, stage `build`, new Build Run).

Production gate: with `production_gate: human` on `release` (default; or `products.productionGate`) a Ticket accepted on staging stays open in `release` (`tickets.productionState` `awaiting_approval`) until a human approves the deploy: UI Gate "Approve production deploy" or MCP `approve_production`. The approval records a human touch `approve:production` (before the state change, so no deploy lacks an audit row), stores the merge sha it approves (`productionApprovedSha`; `watch-release` fails the deploy with a Comment if it no longer equals the Ticket's merge sha) and sets `productionState` `deploying`. A label set on the forge by anyone starts nothing. The factory deploys nothing: the Product's own pipeline reacts to the output label or to the optional `products.productionWebhookUrl` (POSTed once with `{ticket, sha, environment: "production"}`; klima-portal's manual `deploy_production` is such a pipeline). The label is delivered once per approval (`productionLabelAt` records the first successful add; it is retried only until then and never re-added when someone removes it, because every add re-triggers label-based pipelines); a failed or timed out deploy removes it. Webhook receivers must dedupe by `(ticket, sha)`: a non-2xx answer is retried on the next tick, and every POST (staging and production) carries the header `X-Bauherr-Delivery: <ticket number>-<sha>`. Label-triggered workflows run on the default branch HEAD, so with several Tickets in flight they must report their check on the Ticket's merge sha (for example by taking the sha from the Ticket page or the webhook body); a check reported on another commit is never seen and ends as `timed_out`. `watch-release` observes `products.productionChecks` (required, comma-separated) on the merge commit, counting only runs that started at or after the approval minus 60 s of clock skew: all `success` is `deployed` (stage `done`, Ticket closed `completed`); a finished check with any other conclusion is `failed`, a skipped or neutral one with the reason "deploy check skipped" in the Comment (nothing was deployed); nothing after 60 minutes is `timed_out`. One `<!-- bauherr:production -->` Comment holds result, sha, checks, approver and time. `failed` and `timed_out` are the needs-you value "Production deploy failed"; the Ticket stays open and a retry is a new explicit approval. GitLab pipelines follow with #119.

Release: when Tickets are approved for production (`productionApprovedSha` set, `deploying` or `deployed`), the scheduled task `publish-release` (every minute; also queued by the approval) publishes one forge Release per Product for the newest (by commit date) approved merge sha. Idempotency: the release body carries `<!-- bauherr:release:<sha> -->`, and the release that shipped the sha (first release whose tag commit is the sha or a descendant, so a `chore(release)` commit after the merge still matches; `findRelease`) is looked up before one is created, so a retry or a second tick never makes a second one. The body lists the batch (approved, no `releasePublishedAt`) grouped Features / Fixes (Ticket label `bug` or a `fix:` title is a fix) from the "What you get" part of the staging summaries, with Ticket and MR links; one cheap-tier model pass through the Workspace gateway rewrites it in plain language, and any error, budget block or lost link publishes the deterministic text instead. `products.releaseMode`: `notes-only` (default) never creates a tag: if the Product's tooling made a release for the sha, the notes are appended under `## What's new`; none after 6 hours posts the notes and "no release found" as Ticket Comments. `factory` tags `v<semver>` (conventional commits since the last release, first `0.1.0`), creates the Release and opens a `CHANGELOG.md` MR from `bauherr/release-v<semver>` (prepended after `## Unreleased`; a human merges, never auto-merged). Each Ticket gets `releaseUrl` and one Comment linking the release. The task only looks at Products with due Tickets: while `notes-only` waits for the release it looks again every 10 minutes; a failure is stored on the Ticket (`releaseError`, `releaseAttempts`), retried after 1 hour, and the 3rd gives up with a Comment. The rewritten notes are cached on the Tickets (`releaseNotes`) before the publish step, so a retry does not run the model again.

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
One decision sheet per Ticket per gate (the newest plan or triage Comment; only answers posted after it count, so a new sheet starts unanswered), with recommended defaults and a `critical` flag; at most one human touch. With the plan gate off, an unanswered critical decision on a posted plan reopens the refine hold (stage label removed, `bauherr:needs-refinement`, one Comment): answering it re-plans and the Ticket then proceeds without approval. Protocol: [decision-sheet](../../pack/skills/decision-sheet/SKILL.md).

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
| Plan gate (when on) | plan Comment, Goal statements, worklog panel, decision sheet, Approve button (sets `bauherr:approved:plan`) |
| MR gate | MR Link, `## Evidence` next to it, Goal with per-statement status, reviewer Comments, budget and model used |
| Any Run page | Goal status, evidence, why it stopped, worklog, Steps, cost |
| Blocked | `bauherr:blocked` reason and the decision sheet |

## 13. What a Product user sees
Intake session, then the Ticket in the Ticket source with its Stage Label and Comments (plan, review, decision sheets addressed to them). No Runs, worklogs, budgets or configuration.

Intake: `POST /intake/api/sessions` (Product), `.../:id/messages` (one interview turn, SSE `turn` event), `.../:id/submit`. The engine asks one question per turn through the gateway (skill [intake](../../pack/skills/intake/SKILL.md), standard tier), at most 6 questions; completeness (problem, context, >= 2 criteria, screenshot for screen requests) is computed by the engine, not the model. Submit creates the Ticket without a stage label, so Triage picks it up, with `type:`/`product:` labels, an `## Open` section for gaps and the interview as a Comment.

Persona `owner`: "Answer interactively" on the Ticket page (shown while the decision sheet has open rows) opens an `intake_sessions` row with persona `owner` and `draft.ticket`. No model call: the engine's `ownerQueue` asks the sheet's unanswered rows one per turn, critical first, the sheet default marked recommended. Each pick goes through `postDecisions` (the same `<!-- bauherr:decisions -->` Comment and worklog Decisions as the sheet form, which stays); the session ends `submitted` when no row is left.

## 14. Pack artifacts index
Manifest: [pack.yaml](../../pack/pack.yaml). Hooks map to SDK events in [hooks.yaml](../../pack/hooks/hooks.yaml).

## 15. Steps and workflow config
A stage is an ordered DAG of steps (decision #44). Step types: `agent-run` (a Run with a Goal), `external-service` (a connected agent service, e.g. a code-security scanner; callback with poll fallback; findings become Tickets, Comments or scorecard results), `ci-job` (wait for a named check), `human-gate`, `check` (scorecard rule). Step contract: `{id, type, needs, inputs, timeout, budget?, retries}` → `{status, outputs, evidence, started, finished, cost}`. A failed blocking step stops the stage; *repair run* re-runs failed steps only.

Gate keys: `gate: human` on `plan` or `release`; any other value is ignored. The compiled version records the enabled gates (`humanGates()`) with the DAG. Where the workflow lives (decision #45): base `pack/workflow.yaml` in the core pack (read-only in the UI), per-Product overlay `products/<slug>/workflow.yaml` in the Knowledge repo; the factory compiles the merged DAG into a `workflow_versions` row that Runs reference. Validated by `bauherr pack lint`.

What the Bauherr sees per Ticket run: graph (nodes with status, duration, type, resource), timeline (nested sub-steps, dependency arrows), list (filterable), run details (launched by, started, ended, duration, status, cost), repair run. Per Product: the compiled workflow with the overlay diff highlighted.
