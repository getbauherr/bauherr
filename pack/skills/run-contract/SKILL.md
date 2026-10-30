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
- Pick only Tickets with `claimable: true` in `list_frontier`. Never touch the branch or worktree of a Ticket with `leasedBy`.
- Heartbeat at least every 10 minutes; the lease expires 30 minutes after the last heartbeat and the Run is `abandoned` (a fresh Run takes over from the pushed branch and the worklog).
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

## Exit rule
| Run | May end only with |
|---|---|
| Plan | `.bauherr/plan.md` (the Runner posts the plan Comment and the worklog), or a blocker |
| Build | MR Linked on the Ticket, or a blocker |
| Review | `submit_review` (session) or `.bauherr/review.json` (autonomous), or a blocker |

The Stop hook (`hooks/stop-goal-check.ts`) refuses to end the turn while a statement is unverified and undeclared. It re-prompts once with the unmet list; a second miss ends the Run `needs_human`.

## What the Runner does for you in Plan
Your Goal in a Plan Run is only: write `.bauherr/plan.md` with the sections `## Goal` and `## Steps`, covering every acceptance criterion. You have no tool to post Comments. After you exit, the Runner posts the file as the plan Comment (first line `<!-- bauherr:plan -->`), writes the Ticket's Goal statements into the worklog Comment (`<!-- bauherr:worklog -->`) and ends the Run `succeeded`. Build Runs: the Runner commits, pushes, opens the MR with the `## Evidence` section, Links it on the Ticket and sets the stage to review.

## Declare a blocker
Use only when you cannot proceed without a person or a missing input. A blocker is specific and actionable:
- which Goal statement is blocked
- what you tried (commands, files)
- what you need, from whom, in one sentence
- a recommended default, if one exists

Write it in the worklog under "unfinished work" and as your final message. "Tests are flaky" is not a blocker; the failing test, its output and your two attempts are.
Questions for the human go through the `decision-sheet` skill, never mid-Run chat.

## End
Update the worklog as your last action. Do not push or open the MR yourself: the Runner does after you exit.

## Do not
- Mark a statement verified without evidence.
- Weaken or delete a test or check to make it pass.
- Declare a blocker to avoid hard work; try first, then declare.
- End with a summary instead of an MR or a blocker.
