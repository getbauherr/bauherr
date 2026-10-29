---
name: coordinate
description: Use only when a stage config enables parallel lanes (research in v0.1) and the work splits into independent outcomes. Defines lanes, owners, messaging and integration.
---

# Coordinate

Parallel lanes are a stage config choice with a declared problem (see `rules/team-policy.md`). Without that config, work alone.

## When to use
- The work splits into outcomes that do not need each other's results to start.
- Wall-clock time matters more than cost, and one agent already proved too slow or too broad.
- v0.1: research stages only.

## When to avoid
- Build work that edits the same files or one shared design.
- Anything that fits one agent's context.
- No named owner per lane; no way to merge results.

## Procedure
1. **Split by outcome**, not by role. Each lane states: outcome, owner, owned paths (or output file), done-test.
2. **Record the plan** in the worklog under Owners. Lanes may not overlap: no two lanes edit the same path. If they must, merge them into one lane.
3. **Brief each lane** with Goal, its outcome, owned paths, the worklog, and who to message. No role-play personas.
4. **Dependencies**: message the owner of the lane concerned, directly, with one concrete question or fact. No broadcasts, no status chatter.
5. **Plan change** (scope, ownership, a new dependency): the lane reports to the coordinator at once; the coordinator updates the worklog and informs affected lanes.
6. **Integrate**: the coordinator merges lane outputs, resolves conflicts, runs the checks from the Goal, and holds the Run's evidence. Lane results are claims until checked.
7. Close lanes when their outcome is met; do not keep idle lanes.

## Guards
- `hooks/write-scope-guard.ts` enforces owned paths per lane.
- The coordinator is itself a lane owner or purely integrating, never a management layer between the Bauherr and the work.
- Effort and model per lane: `effort-policy`.
