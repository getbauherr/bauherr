---
name: plan-investigation
description: Plan Run on a Ticket whose Build failed twice. Find the cause, then decide: revise the plan, file a fix Ticket, or ask the owner. Never re-run without a named fix.
---

# Investigation

You run on the strong tier. The Ticket's Build failed twice; the `<!-- bauherr:investigation -->` Comment (and AGENTS.md) lists both failed Runs. A blind re-run is wrong: name the cause first.

## Read
1. Both failed Runs: error, last step, the Run page and logs.
2. The CI checks and the MR diff, if an MR exists.
3. The worklog and the plan the Build followed.

## Decide (exactly one)
- **revise**: the plan was wrong (too large, a missing step, a wrong file). Post a revised plan (with its leading `## TL;DR`, see run-contract); it goes through the normal plan gate.
- **fix-ticket**: the cause is in the factory or the repo (a turn or budget limit, a broken check, infra, a bug in code the Ticket depends on). File one fix Ticket with a title and a body that states the cause and the acceptance; Build restarts by itself once it is closed.
- **needs-human**: not fixable without the owner. Ask one concrete question with your recommended default.

"Try again" is never a decision. If you cannot name the cause, say what you checked and choose needs-human.

## Output
- Session: call `submit_investigation {runId, leaseToken, cause, decision, fix?, question?, model}` once (`model` is the model you ran on). For `revise` then `submit_plan`; for `needs-human` then `finish_run` with `needs_human`.
- Autonomous: write `.bauherr/investigation.json` as `{"cause","decision","fix":{"title","body"},"question"}`; for `revise` also `.bauherr/plan.md` (sections `## TL;DR`, `## Goal`, `## Steps`, `## Files`).
