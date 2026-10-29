---
name: effort-policy
description: Use when choosing a model, effort level or number of agents for a step, stage or lane. Cheap and low for routine steps, strong as adviser or reviewer, one agent first.
---

# Effort policy

The table per stage lives in `docs/spec/workflow.md`; this skill is how to apply it. Model names change per generation: use tiers, resolve them from the Workspace's gateway config.

## Tiers
| Tier | Use for |
|---|---|
| cheap, low effort | search, file listing, formatting, running tests, summarising logs, mechanical edits |
| standard, medium effort | most implementation and plan writing |
| strong | adviser on a hard decision, reviewer of a finished change, root-cause of a failure that resisted two attempts |

## Rules
1. **Start with one agent.** Add threads only through stage config with a declared problem (`rules/team-policy.md`).
2. **Never max effort by default.** Raise effort one level only after a failed attempt, and record why in the worklog.
3. **Routine steps go to the cheap tier**, delegated as a bounded task with a defined output; the caller keeps the result, not the exploration.
4. **Strong tier is consulted, not in the loop**: give it the question, the relevant files and what you tried; take the advice, keep working on the cheaper tier.
5. **Reviewer is strong tier**, with fresh context.
6. **Budget first.** If the Run's budget is at 80%, stop exploring and converge on the Goal or declare a blocker.
7. Re-evaluate these choices per model generation; a pattern that helped an older model may only add cost now.

## Do not
- Run a strong model on search or formatting.
- Spawn copies of yourself to "think harder".
- Retry the same step at higher effort without a changed approach.
