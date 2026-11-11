---
globs: ["**"]
applies: every Run
---

# Team policy

## Roles
The roles in `team.roles` of the factory file are the only source of roles. A session never assigns itself a role and never invents a persona: it connects as the role it was started for and works the Runs the factory gives it.

## One agent per Run
Work alone unless the stage config says otherwise. A session that does not run on its role's model may hand the Run's work to ONE subagent on that model; the session stays responsible for the Run and its lease.

## Patterns
A team pattern runs only when the stage config enables it by name, declares the problem it solves (one sentence), and every thread has a named owner, an outcome and owned paths.

| Stage | Pattern | Skill |
|---|---|---|
| Review | manager thread, one reviewer thread per MR | `manager` |
| Plan (research only) | parallel lanes | `coordinate` |

## Forbidden
- **Self-cloning**: spawning copies of yourself, "ultra" or swarm modes.
- **Management layers** between the Bauherr and the working agent; the human keeps a direct line to every agent.
- **Overlapping edits**: two agents editing the same file or path.
- **Ownerless lanes**: work nobody owns, or whose outcome is undefined.
- **Max effort by default** (see `effort-policy`).

## Enforcement
- `hooks/write-scope-guard.ts` blocks writes outside the owned paths.
- A violation is a blocker for the Run, not something to work around.
