# Escalation ladder, investigation and liveness sweep

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- A stuck Ticket climbed four rungs: (1) the stage's normal Run, (2) one retry on the `strong` tier with doubled caps (`runs.escalation = {step, reason, previousRuns}`), (3) an investigation, Build only, (4) the owner. Each step was one line in the Ticket comment `bauherr:escalation`.
- `needs_human` carried `reasonKind`: `decision` and `access` went straight to the owner, `stuck` entered the ladder, `preempted` never did. Before an escalated autonomous Run the USD budget `budgetUsd30d` was checked; spent budget ended at the owner.
- The second Build failure moved the Ticket to Plan with "failed twice: investigate". One Plan Run on `strong` (60 turns, $2) read both failures in the `bauherr:investigation` comment and ended with MCP `submit_investigation`: `revise` (new plan through the plan gate), `fix-ticket` (a `type:bug` Ticket, the Ticket `blocked-by` it) or `needs-human`. One fresh Build Run followed with twice the caps. At most `MAX_INVESTIGATIONS` = 2 per Ticket.
- The Runner stopped a Run whose agent ran the same Bash command 3 times in a row with identical exit code and output: `needs_human`, reason `stuck`.
- Liveness invariant: every open, non-parent Ticket in plan, build or review has a live Run, a visible wait, or a need with one primary action. Task `watch-liveness` (every 5 minutes) found dead Tickets with a cause and repaired them once per Ticket, cause and Run (comment `bauherr:liveness:<cause>:<run id>`).
- Causes: `mr-missing`, `checks-red`, `run-failed`, `run-abandoned`, `run-stuck`, `run-cancelled`, `review-escalated`, `review-invalid`, `review-stalled`, `triage-expired`. Findings were stored in `tickets.liveness`; factory health showed them.
- Counters on the Ticket: `reviewRounds`, `conflictReturns` (4th), `trainFailures` (3rd), `mergeFailures` (3rd), `mainMergeNoops` (3rd), `triageAttempts` (3rd), `releaseAttempts` (3rd), `gatePendingAttempts`; plus session lease expiry (a 2nd consecutive abandon is `needs_human`).

## The requirement behind it

- A Ticket must never sit with no Run and no explanation. The owner is asked only after cheaper fixes failed (#354 "failed twice = investigate, no blind re-run", #393).
- A blind re-run of the same Run repeats the same failure.
- Specs: `docs/spec/runs.md` (85 lines): "Liveness", "Escalation ladder", "Investigation".

## Where the code is

- `apps/server/src/lib/escalation.ts` (148: `nextStep`, `escalate`, `escalateReviewCap`, `escalateInvalidReview`, `budgetOut`), `investigation.ts` (141: `startInvestigation`, `submitInvestigation`, `resumeInvestigations`, `escalatedCaps`), `liveness.ts` (180: `CAUSES`, `deadTickets`, `repair`, `sweepLiveness`), `needs-you.ts`, `run-health.ts`.
- MCP in `apps/server/src/lib/mcp-tools.ts`: `submit_investigation` (l. 512), `return_to_build`, `release_fast_lane`. Task `watch-liveness` in `apps/server/src/jobs/index.ts` (l. 381).
- Runner: `packages/runner/src/guards.ts`, `agent.ts`.
- Collections (`apps/server/src/collections.ts`): runs `investigation`, `escalation`, `reasonKind`; the counter fields above; tickets `liveness`, `waitingReason`.
- UI: `apps/server/src/app/(app)/components/FixState.tsx`, Board card "Escalated" and "Investigating".
- Tests in `apps/server/tests/`: `escalation.test.ts`, `investigation.test.ts`, `liveness.test.ts`.

## Why it was cut

The lean core replaces the ladder and about ten counters with one rule: every loop has a cap, and reaching it raises a Question card for the owner.

## What a module on the new core needs

- Core contracts: the cap-ends-in-Question-card rule already covers rung 4. A module would add rungs 2 and 3 as optional steps before the card: a retry decision from record and events, and an investigation Run whose schema-validated result is `revise`, `fix-ticket` or `needs-human`, written to the record's `findings` or `decisions`.
- Lift almost unchanged: `nextStep` (pure), `escalatedCaps`, the once-only comment keys, the `reasonKind` split (owner-bound versus ladder-bound), the dead-ticket causes as a checklist for an "every ticket has a next step" test.
- Design again: the sweep. In the new core runs end instead of waiting, so most causes disappear; a Ticket with no pending event and no card is a bug to test for, not to repair.
- Trap: escalation notes were keyed by the stopped Run and written before the Run was created, so a retry never doubled them.
- Trap: a preempted or abandoned-by-lease Run is not a failure and must not count toward "failed twice".
- Trap: a `fix-ticket` outcome makes its failure count as a first failure of the new build.
- Trap: the budget check covered autonomous Runs only; session Runs were unchecked (inferred gap).
- Trap: repairs ran every 5 minutes and had to be idempotent per cause and Run.
