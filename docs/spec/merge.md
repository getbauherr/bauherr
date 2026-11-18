# Merge and checks

## Review only green heads

`request_review`, and `finish_run` with an MR, first ask `checksGate` in `lib/actions.ts`. It is the same function as the merge gate. It reads the required checks of the MR head with the check retry applied. No checks count as green once the head commit is 10 minutes old.

| Checks | Result |
|---|---|
| Green | Into Review |
| Pending | The Ticket stays in Build with `waitingFor: checks`, no Run and no Review WIP slot. `watch-reviews` moves it to Review when green. After 2 hours the latest Build Run goes `needs_human` |
| Red | `request_review` answers `{refused, checks}` and `finish_run` is refused. The session keeps its Run and fixes the head. A Ticket that was waiting goes back to Build with the failing names, no review round |

Every other way into Review ends in `startReviewIfReady`, which asks the same gate when no review runs. A pending head parks the Ticket in Build waiting for checks. A red head returns it to Build with the names, `parkForChecks`. A running review is not interrupted.

## Merge gate

`mergeMode` is a Product setting: `direct`, `queue` or `train`. Existing Products stay `direct`.

In `direct` mode the gate squash-merges, pinned to the reviewed head SHA, and deletes a same-repo branch when all of this holds:

- The MR is an open, non-draft factory MR with head branch `bauherr/<ticket>-...` in the same repo.
- Its head is still the SHA the review covered. If the head moved, a new Review Run starts with no round.
- Every check run and commit status on the head passed.
- The MR body has a non-empty `## Evidence` section.
- Product `autoMerge` is on, the default.

Otherwise:

| Situation | Result |
|---|---|
| Checks pending or draft | `reviewState` `waiting_checks`, rechecked each minute by `watch-release`. Over 2 hours, or 3 consecutive failed merges, is `needs_human` |
| Checks red | Failed checks re-run once, see below. A check that fails again returns the Ticket to Build with the names |
| `autoMerge` off, or no Evidence | Comment "ready to merge" and `reviewState` `ready_for_human`. A human merges |

A merge by the factory is no human touch. The next `watch-release` pass moves the Ticket to `release`.

## Main merge

An MR the forge reports as conflicting, or behind its base while auto-merge is on, is merged with the base by the factory server in every Run mode. No Build Run, no Review Run, no human.

- The server queues the `merge-main` job, one pending per Ticket. A newer job supersedes an older one.
- The job fetches the base, runs `git merge --no-edit origin/<base>` and pushes when clean. The factory bot `Bauherr` authors the commit, never a session.
- At review time the Runner stores `reviewedPatchId`, the `git patch-id --stable` of the MR-only diff, on the Review Run. A session review has none, so the job takes the patch-id of the head before its merge.
- After the merge the patch-id is computed again. When unchanged and the head is the SHA the job pushed, the verdict is re-bound to that head. A different patch-id, or a push by anyone else, starts a new Review Run.
- A merge that finds nothing to merge on a head still reported as conflicting or behind is counted per head in `mainMergeSha` and `mainMergeNoops`. The 3rd, or a git failure, is `needs_human`. A merge that pushes resets the count.
- Only a real conflict creates a Build Run. It counts in `conflictReturns`, not as a round or failed merge. The server stores `conflictReturnBase`. The 4th conflict return needs a human.
- The agent resolves only the conflict markers and commits. The delta Review Run gets the interdiff as `.bauherr/diff.patch`.
- Everything works on git objects only, so it is language-agnostic.

## Merge queue

In `queue` mode the gate enqueues the reviewed head SHA in the forge's native queue, GitHub `merge-async` with `merge_action: merge_queue` or a GitLab merge train. `reviewState` is `queued`, shown as "In the merge queue", with `queuedAt` set.

- When the PR merges, `watch-reviews` sets `merged` and `watch-release` moves the Ticket to `release` with the PR's merge SHA.
- The Runner does not merge the base into a PR that is behind in `queue` mode. A conflict is still merged.
- An open PR the forge stops reporting as queued after 2 minutes was dropped. The Ticket returns to Build with no round, a link to the queue run and `trainFailures` plus 1. The 3rd needs a human.
- A head that moved while queued is dequeued and reviewed again. Queued for over 2 hours needs a human.
- `dequeueBeforeChange` removes a queued PR before a return to Build and before a Build Run starts on it. A queued PR is never pushed to.
- A refused enqueue counts as a failed merge.
- Onboarding and "Re-detect" in Settings > Product > Merging choose `queue` when the forge has a native queue and the preflight passes, else `train`. Problems are stored in `mergePreflight` and shown.
- GitHub preflight: every workflow producing a required check has a `merge_group` trigger, and no deploy or publish job runs on `merge_group`. GitLab: `merge_request_event` rules in `.gitlab-ci.yml`, merged-results pipelines and trains on.
- Saving `queue` or `train` by hand reruns the preflight and is refused while it has problems.

## Merge train

Mode `train` is for forges without a queue. `runTrains` in `lib/train.ts` runs after `watchQueued` in `watch-reviews`. The gate only marks the reviewed head `queued`.

- One train per Product runs at a time. The `queued` Tickets in `executionOrder`, at most the Review WIP limit, 3 by default, merge one by one into the branch `bauherr/train`, reset to the default branch first.
- A PR that conflicts returns to Build as a conflict return.
- CI runs on the tip, judged by the Product's `deployChecks`. Preflight requires the `push` trigger, on GitLab a pipeline on the branch.
- Green: the PRs are squash-merged onto main in train order, each pinned to its tested head with `expectSha`. A moved head, a Ticket that left `queued` or a moved main rebuilds the train.
- Red: the branch is reset to prefix lengths by binary search, at most log2 k extra runs, state in `trainState` with `probe`, `results` and `tip`. PRs before the first failure merge. The failing PR returns to Build with the check's link, no round, `trainFailures` plus 1, the 3rd needs a human. The rest re-train on the new main.
- Main is never rewritten. Each PR is squash-merged onto a main that did not move since the train was built.
- Checks pending after 2 hours release the train, and every member needs a human.
- `trainState` writes are compare-and-set.

## Check retries

A required check is re-run once when it fails. This covers an MR head and any merge or release SHA a watcher waits for. The re-run comes before a round counts, a return to Build or a failed release.

- `Forge.rerunFailed` re-runs the failed jobs of the workflow run, GitHub `rerun-failed-jobs`, or the GitLab pipeline. Commit statuses and bridges cannot be re-run.
- The retry is one Ticket comment with check, run link and "retried once", plus one `check_flakes` row per Ticket, sha and check. The row is the once-only guard.
- While the workflow run still has jobs in progress, or the re-run is not listed yet, the Ticket stays `waiting_checks`. The 2 hour limit applies. Production and release waits keep their 60 minute limit.
- Only `failure`, `timed_out` and `cancelled` are re-run, never skipped or neutral checks.
- On a later pass the row settles: passed is `flake`, failed again is `failed` and behaves as without retries.
- `products.checkRetries` is 0 or 1, default 1. Larger values are refused.
- Factory health lists flakes of the last 30 days.
- Tests that pass only on Playwright's own retry never fail a check. Each `e2e-fake` shard lists them in its step summary, from `.github/scripts/e2e-flakes.sh`, and publishes a neutral check run `e2e-flaky (shard N)` with JSON `[{shard,file,title}]`. Every gate pass records one `check_flakes` row per test, `checkName` `e2e: <file> › <title>`, outcome `flake`. GitLab records none.
