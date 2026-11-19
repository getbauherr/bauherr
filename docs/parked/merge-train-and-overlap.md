# Merge modes, merge train and overlap holds

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- Product field `mergeMode` was `direct`, `queue` or `train`. Default `direct`: squash-merge pinned to the reviewed head SHA, only with green checks, a non-empty `## Evidence` section and `autoMerge` on.
- `queue` enqueued the reviewed head in the forge queue (GitHub merge queue, GitLab merge train). A PR the forge stopped reporting as queued after 2 minutes was dropped: back to Build, `trainFailures` plus 1, the 3rd needs a human. Queued over 2 hours needs a human.
- `train` was a factory-run train for forges without a queue: queued PRs (at most the Review WIP limit, default 3) merged into the branch `bauherr/train`, CI ran on the tip, green PRs were squash-merged in order with `expectSha`. Red: binary search over prefixes, state in `trainState` (`probe`, `results`, `tip`), the first failing PR back to Build.
- The factory merged the base into a PR that conflicted or was behind (`merge-main` job, bot author, no agent run). `reviewedPatchId` (`git patch-id --stable`) let the old verdict stay valid when the diff was unchanged. Only a real conflict started a Build Run: `conflictReturns`, the 4th needs a human. 3 no-op merges (`mainMergeNoops`) need a human.
- A preflight checked that CI fits queue or train (`merge_group` trigger, `push` trigger, GitLab `merge_request_event` rules). It chose the mode at onboarding and on "Re-detect". Problems were stored in `mergePreflight`; saving `queue` or `train` with problems was refused.
- Overlap hold: a Build Run did not start while an earlier Ticket in Build or Review had intersecting paths. Paths came from the PR files, else the plan's `## Files`. The later Ticket waited in Plan, "Waiting: overlaps #N". `products.overlapIgnore` and `suggestOverlapIgnore` (files in 25% of the last 100 merged PRs) excluded hot files.

## The requirement behind it

- Several tickets built in parallel touch the same files, so merges conflict and each merge makes the others stale (#277, #293).
- Forges without a merge queue still needed tested-together merges (#452).
- A flaky required check should not fail a merge: `check-retry` re-ran a failed check once.
- Docs: `docs/spec/merge.md` (88 lines), `docs/spec/scheduling.md` section "Build hold".

## Where the code is

- `apps/server/src/lib/train.ts` (162), `merge-main.ts` (44), `merge-mode.ts` (30), `merge-preflight.ts` (116), `overlap.ts` (97), `check-retry.ts` (54).
- Gate and review hand-off in `apps/server/src/lib/actions.ts` (2009): `checksGate` (l. 324), `mergeGate` (l. 1600), `watchReviews` (l. 1739).
- Task `merge-main` in `apps/server/src/jobs/index.ts` (l. 847); `watch-reviews` calls `runTrains`.
- Collections (`apps/server/src/collections.ts`): products `mergeMode`, `trainState`, `autoMerge`, `checkRetries`, `overlapIgnore`, `deployChecks`; tickets `queuedAt`, `trainFailures`, `conflictReturns`, `mainMergeSha`, `mainMergeNoops`, `reviewState`; `check_flakes`.
- Runner: `reviewedPatchId` in `packages/runner/src/index.ts` (l. 128).
- UI: `apps/server/src/app/(app)/lib/merge-strip.ts`, `holds-strip.ts`, `components/HoldsStrip.tsx`.
- Tests in `apps/server/tests/`: `train.test.ts`, `merge-queue.test.ts`, `merge-preflight.test.ts`, `overlap.test.ts`, `merged-sha.test.ts`, `merged-build.test.ts`.

## Why it was cut

The first lean core merges directly and respects branch protection. Queueing and train logic return when ticket volume makes merge conflicts the bottleneck.

## What a module on the new core needs

- Core contracts: the forge writer is the only part that merges, enqueues or pushes. A merge decision reads the mirror (PR head, checks) and the ticket record; train and overlap state belong in module-owned storage, not in the record.
- Lift almost unchanged: `bisectFirstFailure` and `globsIntersect` (pure), `ticketPaths` (needs the mirror instead of forge calls), `detectMergeMode` and the preflight checks, the `check-retry` once-only guard (unique row per ticket, sha, check).
- Design again: the trigger and re-entry. Every loop needs a cap that ends in a Question card (the old caps: 3 train failures, 4 conflict returns, 3 no-op merges, 2 hour waits). Replace polling watchers with events.
- Trap: the merge must pin the reviewed SHA; a moved head voids the verdict. Old code had `expectSha` and compare-and-set on `trainState`.
- Trap: queued PRs must never be pushed to (`dequeueBeforeChange`).
- Trap: merging main must not change the reviewed diff; the patch-id comparison was the guard.
- Trap: a Ticket that has work in flight holds paths, a failed or cancelled one does not (fix #355). Returns to Build are never held.
- Trap: the forge may keep reporting "behind" after a merge; hence the no-op counter per head.
- Not found: a measured conflict rate that justified the train.
