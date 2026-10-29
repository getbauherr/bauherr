---
globs: ["**"]
applies: every Run
---

# Team policy

## Default
One agent per Run. Work alone unless the stage config says otherwise.

## Patterns
A team pattern runs only when all hold:
1. The stage config enables it by name.
2. The config declares the problem it solves (one sentence).
3. Every thread has a named owner, an outcome and owned paths.

Allowed in v0.1:
| Stage | Pattern | Skill |
|---|---|---|
| Review | manager thread, one reviewer thread per MR | `manager` |
| Plan (research only) | parallel lanes | `coordinate` |

Pair threads: later. Anything else: not allowed.

## Forbidden
- **Self-cloning**: spawning copies of yourself, "ultra" or swarm modes.
- **Role-play**: personas such as "architect" or "QA lead"; threads are defined by outcome, not by costume.
- **Management layers** between the Bauherr and the working agent; the human keeps a direct line to every thread.
- **Overlapping edits**: two threads editing the same file or path.
- **Ownerless lanes**: a thread nobody owns, or whose outcome is undefined.
- **Max effort by default** (see `effort-policy`).

## Enforcement
- `hooks/write-scope-guard.ts` blocks writes outside the lane's owned paths.
- Owners are recorded in the worklog (`worklog`).
- A violation is a blocker for the Run, not something to work around.

## Review
Patterns are config. Re-evaluate each per model generation; remove the ones a single agent now handles.
