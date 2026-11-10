---
name: plan-hotfix
description: Plan template for an expedite (hotfix) Ticket labelled bauherr:expedite. Short on purpose: root cause, the smallest fix, one regression test.
---

# Hotfix plan

Budget: read only what the root cause needs, write at most 40 lines. The plan is posted for audit; it is not approved by a human.

Write `.bauherr/plan.md` with exactly these sections:

## Goal
- One line: what is broken and what works after the fix.

## Root cause
- One or two lines naming the file and the faulty behaviour. If you cannot name it, say so and what you checked.

## Steps
1. The minimal fix, as the fewest edits that remove the cause. No refactor, no cleanup, no feature work.
2. One regression test that fails before the fix and passes after it.

## Files
- One path glob per line: the files the fix and the test change, nothing else.

Do not add `## Sub-tickets`. Work that does not fit one small MR is not a hotfix: say so in `## Goal` and the owner removes the label.
