# Releases, release notes and deploy watching

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- Release stage after merge: `watch-release` (every minute) moved a merged Ticket to `release` and stored the merge SHA. For `deployMode` `observe-ci` it waited for the commit's checks (all, or `deployChecks`); for `webhook` it POSTed once and waited for `stagingUrl` to answer 200. 60 minutes without confirmation was `timed_out`. The factory then posted a `bauherr:staging-summary` comment from a template (no model), with the frozen `## Approval brief`.
- Acceptance closed the Ticket, never the merge (`Refs`, never `Closes`). An optional production gate (`productionGate`, `approve_production`) stored `productionApprovedSha` and set the label or POSTed `productionWebhookUrl` once. `watch-production` read `productionChecks` on the merge SHA (60 minutes, `deployed`, `failed` or `timed_out`). The factory deployed nothing itself.
- `releaseMode`: `notes-only` (default; adds notes to the Product's own release), `factory` (tags `v<semver>` from conventional commits, creates the Release, opens a `CHANGELOG.md` PR), or `manual` (a person ships from the Releases page; a reminder after `releaseReminderDays`, default 7).
- Releases page `/releases` (Admin): tick done Tickets, cut `vX.Y.Z-rc.N`, test it, promote to `vX.Y.Z`. Promote tagged the rc SHA, published the final release with the notes of every rc, set `releasedIn` on the Tickets, opened the CHANGELOG PR and updated `lastReleaseTag`. A retry completed what was missing and made no second tag, release, comment or PR.
- Release notes: one line per Ticket, at most 15 words, linked; grouped by feature area from `feature-map.yaml` (area = feature whose `source` paths the PR changed, most hits win, else `Other`); "Changed behaviour" first (`!` type or label `breaking`); `Internal: N changes` last. `/release-notes` showed them by version and area. `regen-release-notes` rewrote past versions.
- `publish-release` (every minute) published one forge Release per Product for the newest approved SHA; a cheap-tier model pass rewrote the text, with a deterministic fallback; idempotent via `bauherr:release:<sha>`. `releaseChecks` (for example `image, npm`) were read on the tagged SHA before "Released in".
- Required checks were re-run once on failure (`checkRetries`, `check_flakes`). CI workflows: `cut-rc.yml`, `promote.yml`, `release.yml`, `staging.yml`, `production.yml` in `.github/workflows/`.

## The requirement behind it

- A Ticket is done when the owner accepts the result on a running deploy, not when it merges (#670, #671).
- Owners need release notes in plain words per version and area (#707), and a tested path from release candidate to final (#659, #670).
- Release and deploy failures must be visible and retryable without double publishing (#688, #690, #695).
- Docs: `docs/spec/release.md` (81 lines), `docs/releasing.md` (78).

## Where the code is

- `apps/server/src/lib/release.ts` (609: `watchRelease`, `publishStagingSummary`, `beginProduction`, `watchProduction`, `publishRelease`, `watchReleaseChecks`, `publishReleases`, `prOf`), `ship-release.ts` (230: `releaseDraft`, `shipRelease`, `promoteRelease`, `proposeVersion`, `releaseReminders`), `release-items.ts` (55), `release-notes.ts` (90: `renderNotes`, `nextVersion`, `rewrite`), `changelog.ts` (35), `approval-brief.ts` (79), `staging.ts` (20), `feature-map.ts` (41), `check-retry.ts` (54).
- Tasks in `apps/server/src/jobs/index.ts`: `watch-release` (l. 378), `watch-production` (l. 373), `publish-release` (l. 404).
- UI: `(shell)/releases/` (`page.tsx` 68, `actions.ts` 60), `(shell)/release-notes/page.tsx` (32), `components/ReleasePanel.tsx` (161), `ApprovalBrief.tsx`.
- Collections (`apps/server/src/collections.ts`): products `deployMode`, `deployWebhookUrl`, `deployChecks`, `releaseMode`, `lastReleaseTag`, `releaseReminderDays`, `releasePrerelease`, `releaseChecks`, `productionGate`, `productionChecks`; tickets `releaseState`, `productionState`, `releaseUrl`, `releasedIn`, `releaseNotes`, `releaseTag`, `releaseSha`, `releaseChecksState`, `releaseAttempts`, `releaseError`.
- MCP: `accept_staging`, `approve_production`, `post_staging_summary`.
- Tests in `apps/server/tests/`: `release-watch.test.ts`, `release-publish.test.ts`, `release-notes.test.ts`, `release-workflow.test.ts`, `release-jobs.test.ts`, `ship-release.test.ts`, `production-gate.test.ts`.

## Why it was cut

The lean core's Ship stage merges, watches the deploy and asks the owner to accept. Versioned release notes and publishing return as a module. The owner wants this back as a later module.

## What a module on the new core needs

- Core contracts: Ship is part of the fixed lifecycle, so the module splits in two. Deploy watching stays near Ship (events from the mirror: checks on the merge SHA). Versioning, notes and publishing hook in after Done: trigger is "accepted", reads the ticket records, writes through the forge writer (tag, Release, CHANGELOG PR). The Result card is the accept step.
- Lift almost unchanged: `nextVersion`, `proposeVersion`, `releaseLine`, `renderNotes` and `collectItem` (pure), `isFix`, `words`, the area grouping, the idempotency keys (`bauherr:release:<sha>`, branch lookup of the CHANGELOG PR).
- Design again: the rc, promote and retry state machine as events; which tickets belong to a release (`releasedIn`) without polling; the model rewrite as a Run with a deterministic fallback.
- Trap: the GitHub contract cannot list drafts, so `createRelease` published an existing draft instead of making a second release.
- Trap: GitLab has no pre-release flag; a tag `X.Y.Z-<suffix>` is the convention.
- Trap: a label re-added on a forge re-triggers label-based pipelines; the production label was delivered once per approval (`productionLabelAt`). Webhook receivers must dedupe by `(ticket, sha)` (`X-Bauherr-Delivery`).
- Trap: checks of a label-triggered workflow must report on the Ticket's merge SHA, else the wait ends `timed_out`; only runs started after approval minus 60 s of skew count.
- Trap: a tag pushed with `GITHUB_TOKEN` starts no workflow; `gh workflow run --ref <tag>` was needed.
- Trap: a merge may close the issue; the old code reopened it once (`bauherr:reopened`).
