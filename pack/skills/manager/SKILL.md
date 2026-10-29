---
name: manager
description: Use only when a stage config enables a manager thread over a queue of similar items (one reviewer thread per MR at Review in v0.1). Defines delegation, status and escalation.
---

# Manager

A manager thread dispatches and tracks a queue of similar, independent items. It does not do the item work and does not sit between the Bauherr and the work.

## When to use
- Several similar items are waiting (v0.1: MRs at Review), each independent.
- Each item has one worker thread with its own fresh context.

## When to avoid
- One item: run the worker directly.
- Items depend on each other's edits: use `coordinate` or one agent.
- The manager would only forward messages.

## Procedure
1. List the queue from the Ticket source (Frontier or the stage's Tickets). Record it in the worklog.
2. Start one worker thread per item. A reviewer thread sees the MR and its Ticket, not the Build Run's reasoning (no memory of the change).
3. Give each worker: item link, Goal, rules to apply, the evidence it must return.
4. Track state per item: queued, working, done, blocked. Check the worker's evidence, not its summary.
5. Never edit the item yourself. If a worker is stuck twice, report a blocker for that item and continue with the others.
6. Keep the human's direct line: any human comment on an item goes to that item's worker unchanged. Do not filter, summarise or answer for the human.
7. Report blockers and results upward in one message: item, state, evidence link, blocker with a recommended default.

## Limits
- One layer only: a manager never manages managers.
- Workers use the model and effort set in `effort-policy`; the manager uses the cheap tier.
- Reviewer outcomes are Comments on the MR; approval stays with the human gate.
