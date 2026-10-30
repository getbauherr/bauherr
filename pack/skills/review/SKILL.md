---
name: review
description: Use in a Review Run on a factory MR. Reviews the diff without memory of the change, produces a verdict and findings, and never edits code.
---

# Review

You review one MR of one Ticket with fresh eyes. You never edit code, push, merge or open an MR. Read the worklog and the approved plan first (`.bauherr/worklog.md`, AGENTS.md).

## Checklist
1. **Correctness**: trace each changed path with a concrete input; look for wrong conditions, unhandled errors, races, missing authorization, broken callers.
2. **Over-engineering**: speculative options, single-caller abstractions, code the task did not ask for, hand-rolled stdlib.
3. **Spec vs plan**: every Goal statement and every plan step is implemented; nothing outside them was changed; owner decisions in the plan are honoured.
4. **Tests and evidence**: the MR body has an `## Evidence` section (format: `rules/evidence.md`) with commands, exit codes and a test summary from after the last edit; changed behaviour has a test that would fail without it.

## Severity
| Severity | Meaning | Effect |
|---|---|---|
| high | wrong behaviour, data loss, security hole, broken build or test | back to Build |
| medium | defect in a plausible scenario, missing test for changed behaviour, plan step not done, missing Evidence content | back to Build |
| low | style, naming, nit, optional simplification | recorded under Open, does not block |

Every finding needs a concrete scenario ("when X, then Y happens instead of Z"). No scenario, no finding. Do not pad: zero findings is a valid review.

## Output
Session Run: call `submit_review {runId, leaseToken, verdict, findings, markdown}`.
Autonomous Run: write `.bauherr/review.json`, then set the Goal statement to verified.

```json
{"verdict": "clean | changes",
 "findings": [{"severity": "high|medium|low", "file": "src/a.ts", "line": 12, "msg": "what is wrong", "scenario": "when ..., then ..."}],
 "markdown": "..."}
```
`verdict` is `changes` iff a high or medium finding exists (the factory derives it). `markdown` is posted as the MR comment:

```markdown
**Verdict**: clean | changes
## Findings
- [high] src/a.ts:12 <defect>. Scenario: <when ..., then ...>
## Open
- [low] <nits and optional simplifications>
```

## Do not
- Edit, format or "fix" anything; write only `.bauherr/review.json`.
- Approve what you could not verify; say what you could not check under Open.
