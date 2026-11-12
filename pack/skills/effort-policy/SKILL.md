---
name: effort-policy
description: Use when choosing a model, effort level or number of agents for a step, stage or lane. Cheap and low for routine steps, strong as adviser, the role's tier for the Run, as few agents as the work needs.
---

# Effort policy

The tier of each role is set in `team.roles` of the factory file (`tier:`) and listed in the spec (`docs/spec/workflow.md`, section Model and effort policy); `bauherr pack lint` keeps the two equal. This skill is how to apply them. Model names change per generation: use tiers, resolve them from the Workspace's gateway config.

## Tiers
| Tier | Use for |
|---|---|
| cheap, low effort | search, file listing, formatting, running tests, summarising logs, mechanical edits |
| standard, medium effort | work that needs judgement: the roles set to standard (engineer, security, UX, test) |
| strong | the reviewer role's Runs, adviser on a hard decision, root-cause of a failure that resisted two attempts, the escalation retry of a stuck Run |

## Rules
1. **Start with one agent.** Add threads only as `rules/team-policy.md` allows.
2. **Never max effort by default.** Raise effort one level only after a failed attempt, and record why in the worklog.
3. **Routine steps go to the cheap tier**, delegated as a bounded task with a defined output; the caller keeps the result, not the exploration.
4. **Strong tier is consulted, not in the loop**: give it the question, the relevant files and what you tried; take the advice, keep working on the cheaper tier.
5. **A Run uses its role's tier**; only an escalated Run uses `strong`. A reviewer starts with fresh context whatever its tier.
6. **Budget first.** If the Run's budget is at 80%, stop exploring and converge on the Goal or declare a blocker.
7. Re-evaluate these choices per model generation; a pattern that helped an older model may only add cost now.

## Do not
- Run a strong model on search or formatting.
- Spawn copies of yourself to "think harder".
- Retry the same step at higher effort without a changed approach.
