# Fast lane and preemption

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- A Ticket with the label `bauherr:expedite` (`tickets.expedite`) skipped Triage, went to Plan (or straight to Build if its body had `## Plan` or `## Steps`), and entered Plan, Build and Review in one extra slot per column, ignoring WIP limits.
- Only an Admin could put a Ticket on the lane. An urgent intake request proposed it (`bauherr:expedite-proposed`, "Fast lane for <title>?" in the Inbox); an urgent request needed type bug and a reason. Triage could only propose it.
- The plan gate was off for it (template `plan/hotfix`); human gates after Build stayed. The overlap hold never held it; later overlapping Tickets waited for it.
- One expedite Ticket per Workspace was in flight. A second waited without a stage. A holder parked on a human yielded its place (`expediteYieldedTo`); MCP `release_fast_lane` repaired a stuck hold.
- Preemption (`preemptForHotfix`, default on): when no free session of the role existed, the latest-started running Run of a non-expedite Ticket was marked (`preemptedBy`, `preemptedFor`, `preemptAt`). The session got `preempt` in every MCP answer, wrote its handoff and called `release_run`. After 2 minutes (`PREEMPT_GRACE_MS`) the lease sweep ended it. A Runner Run stopped at the next tool boundary and pushed.
- A preempted Run was never escalated and never counted as a failure. Its successor sorted first once no expedite Run went before it.
- Per Product `expediteSkipStaging` (default off) let a hotfix pass staging acceptance by itself; production approval stayed human. Factory health showed lead time over the last 5 hotfixes (`expediteAt` to `releaseAt`).

## The requirement behind it

- An urgent bug must not wait behind the queue, WIP limits and plan approval (#371).
- When all agents are busy, a hotfix still needed one at once (#583, #584).
- A hotfix must not block the lane while it waits for a human (#563, #609).
- Spec: `docs/spec/fast-lane.md` (63 lines).

## Where the code is

- `apps/server/src/lib/expedite.ts` (128): `startExpedites`, `isExpediting`, `canPutOnFastLane`, `releaseFastLane`, `fastLaneHolder`.
- `apps/server/src/lib/preempt.ts` (69): `preemptSweep`, `pickVictim`, `markPreempt`, `preemptedRun`.
- Touch points: `frontier.ts` (pull order, `resumed`), `wip.ts`, `overlap.ts`, `holds.ts`, `hold-text.ts`, `escalation.ts`, `jobs/index.ts` (`expire-sessions`, lease sweep), `mcp-tools.ts` (`release_fast_lane`, `preempt` wrapper in `callTool`), `packages/runner/src/index.ts`.
- Collections (`apps/server/src/collections.ts`): workspaces `expediteLane`, `preemptForHotfix`; tickets `expedite`, `expediteAt`, `expediteYieldedTo`; products `expediteSkipStaging` (+ `By`, `At`); runs `preemptedBy`, `preemptedFor`, `preemptAt`, `reasonKind` value `preempted`.
- Pack: `pack/skills/plan/hotfix.md` (25).
- Tests in `apps/server/tests/`: `expedite.test.ts`, `expedite-gates.test.ts`, `fast-lane-hold.test.ts`, `preempt.test.ts`.

## Why it was cut

Priority in the new core is the board order set by the owner. A separate lane with preemption is not needed until several tickets compete for the same agents.

## What a module on the new core needs

- Core contracts: a priority flag on the ticket record or an owner decision, an event for "put on lane", and a Question card when a hold is stuck. Preemption needs a way to stop a Run: the Run contract (context pack in, result out) must allow a `preempted` result that is no failure.
- Lift almost unchanged: `canPutOnFastLane`, `pickVictim` (latest `startedAt`, same role, not expedite), the `PREEMPT_GRACE_MS` rule, the `reasonKind: preempted` exemption from escalation.
- Design again: what "one in flight" means when runs end instead of waiting; how a session learns it is marked (old code wrapped every MCP answer).
- Trap: marking and checking free sessions ran in one transaction under an advisory lock; without it two hotfixes pause the same victim.
- Trap: at most one victim per expedite Run; an ended victim still counts.
- Trap: a preempted Run must not turn a second abandon into `needs_human`.
- Trap: notices on gates were posted by parallel passes; one conditional UPDATE (`gateNoticeClaim`) made them post once.
- Trap (inferred): skipping staging is a per-Product opt-in with an audit touch; keep it opt-in.
