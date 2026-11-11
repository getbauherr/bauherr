---
name: run-contract
description: Use at the start and end of every Run. Defines how to read the Run's Goal, what counts as evidence, when a Run may end, and how to declare a blocker.
---

# Run contract

A Run works one Ticket toward its Goal and ends only with the result of its stage or a declared blocker. This text is the part every Run shares; your mode adds its own part below (`session.md` for a session Run, `autonomous.md` for an autonomous Run). Follow only the part you were given.

## Start
1. Read the Goal: each line is one checkable statement.
2. Read the worklog (`.bauherr/worklog.md`) before any other action. Follow the `worklog` skill.
3. If a statement is not checkable ("works well"), do not guess: declare a blocker asking for a checkable rewrite.

## Evidence
A statement is verified only by a recorded result, never by your assertion:
- command run + exit code (tests, build, lint)
- lint diff against the baseline
- MR exists and is Linked on the Ticket (via the forge adapter)
- screenshot or Link, where UI is involved

Re-run the check after the last edit; evidence from before the last edit is stale. Format of the MR section: `rules/evidence.md`.

## Plan
Your Goal in a Plan Run is only: a plan with the sections `## TL;DR`, `## Goal`, `## Steps` and `## Files`, covering every acceptance criterion. For a Ticket labelled `bauherr:expedite` write the short plan of [hotfix](../plan/hotfix.md) instead. A Plan Run on a Ticket whose Build failed twice (the `<!-- bauherr:investigation -->` Comment exists) is an investigation: follow [investigation](../plan/investigation.md) instead.

`## TL;DR` comes first and is what the Bauherr reads to decide in half a minute: exactly these labelled lines, plain words, no factory jargon:
```markdown
## TL;DR
Decision: <one sentence: what the Bauherr approves>
Recommendation: <what you recommend and the one reason>
Why:
- <1 to 3 short facts: what changes, what you checked, what is at risk>
Risk: <one line, or "none">
Options:
- <alternative the Bauherr could pick, optional>
```
`## Files` lists every path the plan changes, one path glob per line (`- src/lib/*.ts`), and nothing else; the factory holds a Build while an earlier Ticket changes the same paths. For work too large for one MR, add a final `## Sub-tickets` section with one item per child, `- **Title** — one-line body` (acceptance criteria may continue on indented lines; an indented line `after: <exact title of another item>` makes it wait for that item); on approval each item becomes its own pre-approved Ticket and this Ticket only tracks them. Items added after approval are not pre-approved.

## Declare a blocker
Use only when you cannot proceed without a person or a missing input. A blocker is specific and actionable:
- which Goal statement is blocked
- what you tried (commands, files)
- what you need, from whom, in one sentence
- a recommended default, if one exists

Write it in the worklog under "unfinished work" and as your final message. "Tests are flaky" is not a blocker; the failing test, its output and your two attempts are. Questions for a person go through the `decision-sheet` skill, never mid-Run chat.

### Reason kind
Every blocker has a kind:
- `decision`: a product question only a person can answer (which of two behaviours to ship). Reaches the Bauherr.
- `access`: a credential, a repo setting or a permission you lack (the merge queue setting is off). Reaches the Bauherr.
- `stuck`: anything else (tests still red after 3 tries). The factory retries it by itself on a stronger model, so write what you tried.
A missing kind counts as `decision`. When the claim says `tier: 'strong'` (`run.escalation` holds the step and the reason), a stronger attempt is expected: use the strongest model available to you and read the earlier Runs' errors first.

## End
Refer to the Ticket as `Refs #N` in the MR body and commit messages; never `Closes`, `Fixes` or `Resolves`: only acceptance on staging closes a Ticket. Update the worklog as your last action.

## Do not
- Mark a statement verified without evidence.
- Weaken or delete a test or check to make it pass.
- Declare a blocker to avoid hard work; try first, then declare.
- End with a summary instead of the result of your stage or a blocker.
