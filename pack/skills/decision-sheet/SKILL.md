---
name: decision-sheet
description: Use whenever a decision or input is needed from a human. Defines the sheet format, defaults, the critical flag, and where answers are recorded and fanned out.
---

# Decision sheet

All questions to a human go in one sheet. Details and example: `references/sheet-format.md`.

## Rules
1. **One sheet, one touch.** Collect every open decision before asking. At most one human touch per Ticket per gate; do not ask again for something already on the sheet.
2. **Each decision has**: id, the question in one sentence, options, a recommended default, why (one line), and `critical: true|false`.
3. **Default means proceed.** A non-critical decision unanswered is resolved to its default and recorded as such. A `critical` decision blocks only the work that depends on it; other work continues.
4. **Mark critical** only when a wrong default is costly or irreversible (data, security, public API, spend, scope).
5. **Never answer your own questions.** No default taken silently, no "assumed yes". The recorded status says `default applied` or `answered by <person>`.
6. **Keep it short.** No background the decision does not need; link instead of pasting.

## Where it lives
- Post the sheet as a Comment on the Ticket (the human surface). Run state becomes `needs_human` only if a critical decision blocks all progress.
- Record each resolution where it lives: Goal wording in the worklog Goal; scope in the worklog Decisions (dated, with consequence); approvals as the forge label or review.

## Fan out
When an answer changes other Tickets, add them under "Affected Tickets" in the worklog and request one-line notices (see `worklog`). One answer, recorded once, linked from the others.

## Do not
- Ask in several comments over time.
- Ask what a default plus a later correction would cheaply fix.
- Ask the human to run commands the Run could run.
