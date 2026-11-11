# Session Run

You work in your own checkout with your own credentials; the factory keeps the record. `claim_next`, `claim_run` and `heartbeat` describe how the lease works.

## Lease
- `claim_run` returns a `leaseToken` (shown once); pass it on every call on the Run. Keep it out of the worklog, comments and commits. Subagents get the run id and the token from you; they never claim.
- Connected as a role (`connect`, then `next_work`): pass your `sessionId` on every call; `next_work` is the claim. Read `roleReminder` and the role profile from `connect` and stay in that role.
- Pass a stable `session` name to `claim_next`, `claim_run` and `list_frontier`; a session that works only some stages also passes `stages`.
- Claim with `claim_next` only. Write the `skipped` reasons of the claim result into the worklog Decisions, one sentence. Pick from `list_frontier` only Tickets with `claimable: true`; never touch the branch or worktree of a Ticket with `leasedBy`.
- Expedite: when the `heartbeat` answer carries `expedite: {ticket, run}`, write the handoff into the worklog, push the branch, `release_run`, then `claim_next`. Never release an expedite Run for another one.
- Lock file: at claim, write `.bauherr/lock` in the worktree as `<runId> <first 8 chars of sha256(token)>`. If a lock with another run id or prefix exists, stop: another session owns the worktree.
- A call that fails with `lease lost` or `leased by another session` means you no longer hold the Run: stop at once, no push, no `finish_run`, tell the human.
- To stop on purpose: write the handoff into the worklog, push the branch, then `release_run`.

## Before `request_review` (Build)
1. If the MR-only diff (`git diff origin/<base>...HEAD --numstat`) has 30 or more changed lines, run a self-review in a subagent on the cheapest model tier (`review` skill, Self-review mode) and fix its high and medium findings once. Under 30 lines, skip this.
2. `attach_evidence` the plan-step table (`rules/evidence.md`) and a line `Self-review: <n> findings, <m> fixed` (or `skipped, <30 lines`).
3. Call `run_checks` and fix its `failures`, re-attach the Evidence and call it again.
4. Then `request_review`. Its answer is the truth: fix and push on `refused`, wait on `waiting`. A Product may require commands (`ran: <command>` rules): run them on the pushed commit and write each with its exit code and the commit SHA.

## Exit rule
| Run | May end only with |
|---|---|
| Plan | `submit_plan` with the plan markdown (leading `## TL;DR`; it names missing labels), or a blocker |
| Build | your pushed branch and an MR Linked on the Ticket (`finish_run` with `prUrl`), or a blocker, or a replan |
| Review | `submit_review`, or a blocker |

**Replan**: when the plan cannot be built as written (it contradicts the code, a step is impossible), change nothing and say so: `finish_run {status: 'succeeded', outcome: 'replan', comment}`. The Ticket goes back to Plan with your comment.

## Conflicts with main
Merge the base into your branch yourself (`git merge`); never rebase, never force push.
