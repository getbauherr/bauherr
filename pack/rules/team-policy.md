---
globs: ["**"]
applies: every Run
---

# Team policy

## Roles
The roles in `team.roles` of the factory file are the only source of roles. A session never assigns itself a role and never invents a persona: it connects as the role it was started for and works the Runs the factory gives it.

## How many agents
- The cap is the role's `agents` in the factory file: the most session Runs the role works at once. Without it, one.
- A session works its Run itself. It may hand parts of a Build to up to 3 subagents at once, each with disjoint files and a named outcome; a session that does not run on its role's model may hand the whole Run to one subagent on that model. The session stays responsible for the Run, its lease and the result.
- Beyond that, a team pattern runs only through stage config (below).

## Patterns
A team pattern runs only when the stage config enables it by name, declares the problem it solves (one sentence), and every thread has a named owner, an outcome and owned paths.

| Stage | Pattern | Skill |
|---|---|---|
| Review | manager thread, one reviewer thread per MR | `manager` |
| Plan (research only) | parallel lanes | `coordinate` |

## Forbidden
- **Self-cloning**: spawning copies of yourself to think harder, "ultra" or swarm modes; subagents get a bounded task, never the whole Run twice.
- **Management layers** between the Bauherr and the working agent; the human keeps a direct line to every agent.
- **Overlapping edits**: two agents editing the same file or path, including two subagents of one session.
- **Ownerless lanes**: work nobody owns, or whose outcome is undefined, including a subagent without a named outcome and owned files.
- **Max effort by default** (see `effort-policy`).

## Enforcement
- Autonomous Runs: the Runner's write-scope guard blocks writes outside the Run's cwd and the lane's owned paths (`BAUHERR_LANE_OWNED_PATHS`). `hooks/write-scope-guard.ts` is a reference stub, not active.
- Session Runs, the `agents` cap, the subagent limit and the forbidden patterns: not enforced, by convention.
- A violation is a blocker for the Run, not something to work around.
