---
name: worklog
description: Use to read and update the per-Ticket worklog at the start and end of a Run, after a handoff, and when a decision affects other Tickets.
---

# Worklog

One pinned factory Comment per Ticket, mirrored to `.bauherr/worklog.md` in the worktree (never commit it). It is a working record, not a summary.

## Read first, update last
- Read it before acting. If it is missing, create it from the template.
- Update it as your last action, even when the Run failed.
- A Run that skipped the read must not decide anything the worklog already decided.

## Template
```markdown
## Worklog
**Goal**
- [ ] <checkable statement>

**Current instructions**
<what the Bauherr or the plan currently asks; replace, do not append old ones>

**Owners**
| Item / lane | Owner (Run or person) | Paths |

**Unfinished work**
- <item> - state - next step - blocker, if any

**Decisions**
- YYYY-MM-DD <decision>. Consequence: <what it changes>. By: <person or Run>.

**Affected Tickets**
- #<n> <how it is affected>
```

## Rules
- Decisions are dated and carry their consequence. Never delete one; supersede it with a new dated entry.
- "Current instructions" holds the latest only; history lives in Decisions.
- Facts, paths, commands, results: no narrative. A line a successor cannot act on does not belong.

## Reconcile after a handoff
A human may edit the Comment in the forge at any time. When a Run starts:
1. Diff the Comment against the mirror from the previous Run.
2. Human edits win. Record each as a Decision ("edited by <person>") with its consequence.
3. Drop Unfinished work the edit made obsolete; keep a Decisions line saying so.
4. If an edit contradicts the Goal, declare a blocker (see `run-contract`) instead of picking one.

## Notify affected Tickets
When a Decision changes another Ticket (interface, schema, order, scope):
1. Add it under "Affected Tickets".
2. Request one-line notices through the forge adapter: `Affected by #<this>: <decision>. See worklog.` The factory posts them.
3. Do not edit the other Ticket's worklog.
