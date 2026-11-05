---
name: run-contract
description: Use at the start and end of every Run. Defines how to read the Run's Goal, what counts as evidence, when a Run may end, and how to declare a blocker.
---

# Run contract

A Run works one Ticket toward its Goal and ends only with an MR or a declared blocker.

## Start
1. Read the Goal: the first lines of your system context. Each line is one checkable statement.
2. Read the worklog (`.bauherr/worklog.md`) before any other action. Follow the `worklog` skill.
3. If a statement is not checkable ("works well"), do not guess: declare a blocker asking for a checkable rewrite.

## Lease
One session coordinates a Ticket at a time. `claim_run` returns a `leaseToken` (shown once); every call on the Run (`heartbeat`, `report_step`, `attach_evidence`, `request_review`, `run_checks`, `submit_review`, `finish_run`, `release_run`, and `update_worklog` while the Run is running) must pass it. Keep it out of the worklog, comments and commits.
- Pass a stable `session` name (the same on every call, max 64 chars) to `claim_next`, `claim_run` and `list_frontier`: it keeps you from being handed the Review of your own build (skipped as "your own build").
- Claim with `claim_next` only: it returns the Run in pull order (expedite Tickets first, then right to left, then the owner's rank). `claim_run` refuses any other Run ("take Run N (#T, column) first"). Write the `skipped` reasons of the claim result (Tickets ahead of yours: leased, blocked) into the worklog Decisions, one sentence. `list_frontier` shows the same order; pick only Tickets with `claimable: true` from it. Never touch the branch or worktree of a Ticket with `leasedBy`.
- Every call with your leaseToken renews the lease and returns `leaseExpiresAt`; during long subagent work call `heartbeat` at most every 10 minutes, or push the branch. The lease expires 30 minutes after the last sign of life and the Run is `abandoned` (a fresh Run takes over from the pushed branch and the worklog).
- Expedite: an expedite (hotfix) Run beats your current non-expedite Run. When the `heartbeat` answer carries `expedite: {ticket, run}`, write the handoff into the worklog, push the branch, `release_run`, then `claim_next` (it returns the expedite Run). Never release an expedite Run for another one.
- Subagents get the run id and the token from you and heartbeat on your behalf; they never claim.
- Lock file: at claim, write `.bauherr/lock` in the worktree as `<runId> <first 8 chars of sha256(token)>`. If a lock with another run id or prefix exists, stop: another session owns the worktree.
- A call that fails with `lease lost` or `leased by another session` means you are no longer the owner: stop at once, no push, no `finish_run`, tell the human.
- To stop on purpose: write the handoff into the worklog, push the branch, then `release_run`.

## Evidence
A statement is verified only by a recorded result, never by your assertion:
- command run + exit code (tests, build, lint)
- lint diff against the baseline
- MR exists and is Linked on the Ticket (via the forge adapter)
- screenshot or Link, where UI is involved

Re-run the check after the last edit; evidence from before the last edit is stale. Format of the MR section: `rules/evidence.md`.

## Before `request_review` (session Build Runs)
1. If the MR-only diff (`git diff origin/<base>...HEAD --numstat`) has 30 or more changed lines, run a self-review in a subagent on the cheapest model tier (`review` skill, Self-review mode) and fix its high and medium findings once. Under 30 lines, skip this.
2. `attach_evidence` the plan-step table (`rules/evidence.md`) and a line `Self-review: <n> findings, <m> fixed` (or `skipped, <30 lines`).
3. Call `run_checks`. It returns the Product's pre-review `failures`; fix them, re-attach the Evidence and call it again. `request_review` (and `finish_run` with an MR) refuses with the same list.
4. Then `request_review`.

## Exit rule
| Run | May end only with |
|---|---|
| Plan | `.bauherr/plan.md` (the Runner posts the plan Comment and the worklog), or a blocker |
| Build | MR Linked on the Ticket, or a blocker |
| Review | `submit_review` (session) or `.bauherr/review.json` (autonomous), or a blocker |

The Stop hook (`hooks/stop-goal-check.ts`) refuses to end the turn while a statement is unverified and undeclared. It re-prompts once with the unmet list; a second miss ends the Run `needs_human`.

## What the Runner does for you in Plan
For a Ticket labelled `bauherr:expedite` write the short plan of [hotfix](../plan/hotfix.md) instead. Your Goal in a Plan Run is only: write `.bauherr/plan.md` with the sections `## Goal`, `## Steps` and `## Files`, covering every acceptance criterion. `## Files` lists every path the plan changes, one path glob per line (`- apps/server/src/lib/*.ts`), and nothing else; the factory holds a Build while an earlier Ticket changes the same paths. For work too large for one MR, add a final `## Sub-tickets` section with one item per child, `- **Title** — one-line body` (acceptance criteria may continue on indented lines; an indented line `after: <exact title of another item>` makes it wait for that item, otherwise items are independent); on approval each item becomes its own pre-approved Ticket and this Ticket only tracks them. Items added to the Ticket after approval are not pre-approved. A Plan Run on a Ticket whose Build failed twice (the `<!-- bauherr:investigation -->` Comment exists) is an investigation: follow [investigation](../plan/investigation.md) instead. You have no tool to post Comments. After you exit, the Runner posts the file as the plan Comment (first line `<!-- bauherr:plan -->`), writes the Ticket's Goal statements into the worklog Comment (`<!-- bauherr:worklog -->`) and ends the Run `succeeded`. Build Runs: the Runner commits, pushes, opens the MR with the `## Evidence` section, Links it on the Ticket and sets the stage to review.

## Declare a blocker
Use only when you cannot proceed without a person or a missing input. A blocker is specific and actionable:
- which Goal statement is blocked
- what you tried (commands, files)
- what you need, from whom, in one sentence
- a recommended default, if one exists

Write it in the worklog under "unfinished work" and as your final message. "Tests are flaky" is not a blocker; the failing test, its output and your two attempts are.
Questions for the human go through the `decision-sheet` skill, never mid-Run chat.

## End
Refer to the Ticket as `Refs #N` in the MR body and commit messages; never `Closes`, `Fixes` or `Resolves`: only acceptance on staging closes a Ticket.

Update the worklog as your last action. Do not push or open the MR yourself: the Runner does after you exit.

## Conflicts with main
The factory merges the base into the MR itself and starts a Build Run only on real conflicts, so a Build Run for a conflicting MR means conflict markers. In an autonomous Run the Runner has already started the merge before your turn. If the tree is mid-merge, resolve only the conflict markers keeping both sides, `git add`, `git commit`, and change nothing else; do not fetch or push. In a session Run merge the base yourself (`git merge`); never rebase, never force push.

## Do not
- Mark a statement verified without evidence.
- Weaken or delete a test or check to make it pass.
- Declare a blocker to avoid hard work; try first, then declare.
- End with a summary instead of an MR or a blocker.
