# Release

## Staging

The task `watch-release` runs every minute. It moves a `review` Ticket whose MR merged to `release` and stores the merge commit.

- A `build` Ticket whose own factory MR merged, and was not its earlier `mergeSha`, moves the same way with `releaseMerged` and its needs-you clears.
- `finish_run` on such a merged MR ends the Build Run `succeeded` and releases at once. `claim_next` cancels a queued Build Run for it. `relink_mr` refuses merged MRs.
- Products with `observe-ci`: the commit's check runs, all or `deployChecks`, are green. Products with `webhook`: the webhook is POSTed once and `stagingUrl` answers 200.
- The factory then posts one `bauherr:staging-summary` comment from a template, no model. Sections: What you get, Found on the way, Decisions taken, Open, Accept. It carries the MR's `## Approval brief`, frozen once per merge commit as `tickets.approvalBrief`.
- Not confirmed after 60 minutes: `releaseState` `timed_out` and the comment "staging not confirmed".
- Before Accept, the `staging-walk` Job, role `ax`, skill `verify-maintain`, walks the Product's verify skill against the staging URL. `pass` lets Accept or the automatic pass continue. `findings` send the Ticket back to Build.

## Closing

Only acceptance closes a Ticket. MRs reference it with `Refs <url>`, never `Closes`, `Fixes` or `Resolves`.

| Case | Result |
|---|---|
| A merge closed the Ticket, no acceptance label, forge close reason `completed`, factory MR merged | `watch-release` reopens it once with `bauherr:reopened` and continues |
| Closed as `not_planned` or `duplicate`, or before any factory MR merged | Respected: `done` with one `bauherr:dropped` note |
| Accepted | Settled to `done` the same way |

A Workspace Bauherr accepts, giving stage `done` or `productionState` `awaiting_approval` while the production gate is on. Or they request changes with a note, which goes to the worklog's Current instructions, stage `build` and a new Build Run.

## Production gate

With `production_gate: human` on `release`, or `products.productionGate`, an accepted Ticket stays open in `release` with `tickets.productionState` `awaiting_approval`. A human approves in the UI gate "Approve production deploy" or with MCP `approve_production`.

- The approval records the touch `approve:production` before the state change, so no deploy lacks an audit row.
- It stores `productionApprovedSha`. `watch-release` fails the deploy with a comment if that no longer equals the Ticket's merge sha. It sets `productionState` `deploying`.
- A label set on the forge by anyone starts nothing.
- The factory deploys nothing. The Product's pipeline reacts to the output label, or to `products.productionWebhookUrl`, POSTed once with `{ticket, sha, environment: "production"}`.
- The label is delivered once per approval. `productionLabelAt` records the first success. It is never re-added when someone removes it, because every add re-triggers label-based pipelines. A failed or timed out deploy removes it.
- Webhook receivers must dedupe by `(ticket, sha)`. A non-2xx answer is retried on the next tick. Every POST, staging and production, carries `X-Bauherr-Delivery: <ticket number>-<sha>`.
- Label-triggered workflows run on the default branch HEAD. With several Tickets in flight they must report their check on the Ticket's merge sha. A check on another commit is never seen and ends `timed_out`.

`watch-release` observes `products.productionChecks`, required and comma-separated, on the merge commit. It counts only runs that started at or after the approval minus 60 s of clock skew.

| Result | State |
|---|---|
| All `success` | `deployed`: stage `done`, Ticket closed `completed` |
| A finished check with another conclusion | `failed` |
| A skipped or neutral check | `failed` with the reason "deploy check skipped" |
| Nothing after 60 minutes | `timed_out` |

- One `bauherr:production` comment holds result, sha, checks, approver and time.
- `failed` and `timed_out` raise the need "Production deploy failed". The Ticket stays open and a retry is a new approval.
- GitLab pipelines follow with #119.
- Bauherr's own Product: `.github/workflows/production.yml` reports the check `production` on the approved sha and builds no image. `productionChecks = production`, set by `pnpm seed`.

## Forge releases

When Tickets are approved for production, `publish-release` runs every minute and after each approval. It publishes one forge Release per Product for the newest approved merge sha by commit date.

- Idempotency: the body carries `bauherr:release:<sha>`. `findRelease` looks up the release that shipped the sha, the first whose tag commit is the sha or a descendant, before creating one.
- The body lists the batch, approved without `releasePublishedAt`, grouped Features and Fixes. A `bug` label or a `fix:` title is a fix. Text comes from the "What you get" part of staging summaries, with Ticket and MR links.
- One cheap-tier model pass rewrites it in plain language. Any error, budget block or lost link publishes the deterministic text. Rewritten notes are cached in `releaseNotes` before publishing.
- Each Ticket gets `releaseUrl` and one comment linking the release.

| `products.releaseMode` | Behaviour |
|---|---|
| `notes-only`, default | Never creates a tag. If the Product's tooling made a release for the sha, the notes are appended under `## What's new`. None after 6 hours posts the notes and "no release found" as Ticket comments |
| `factory` | Tags `v<semver>` from conventional commits since the last release, first `0.1.0`. Creates the Release and opens a `CHANGELOG.md` MR from `bauherr/release-v<semver>`, prepended after `## Unreleased`. A human merges it |

- `products.releasePrerelease`, in factory mode, tags `v<next stable>-rc.<n>`, with n one above the highest existing rc tag read with `listTags`. The release is flagged pre-release and no CHANGELOG MR opens.
- With `products.releaseChecks`, comma-separated, such as `image, npm`, the Tickets get `releaseTag`, `releaseSha` and `releaseChecksState` `waiting`, and no comment yet. The task reads those checks on the tagged sha, runs started at or after the release minus 60 s.
- All `success` is `passed` with the comment "Released in". A finished red check, or nothing after 60 minutes, is `failed`: need "Release failed" with the run link, shown even on a closed Ticket. A re-run that turns green still ends `passed`.
- The npm package is staged with tag `next`. Promoting it stays a human step.
- The task looks only at Products with due Tickets. While `notes-only` waits it looks every 10 minutes. A failure is stored in `releaseError` and `releaseAttempts`, retried after 1 hour, and the 3rd gives up with a comment.

## Poller and health

- Every forge call aborts after 30 s, the gateway admin call after 10 s, and fails the job so the next tick runs.
- `expire-sessions` and `reclaim-jobs` each reclaim the other too. They mark a scheduled job stuck `processing` for 60 minutes as failed. `run-stage` and `reconcile-costs` are exempt.
- `watch-reviews`, `watch-production`, `resume-reviews` and `watch-release` are separate tasks.
- `GET /api/health` is 200 while every scheduled task completed within 5 minutes, else 503 with the stale task slugs.

## Scorecard

The `checks` gate is the Product's scorecard: ordered rules with a guide each, covering build, tests, lint baseline, pack lint, security context and evidence section. A failing blocking rule prevents Review, re-wakes the Build Run once, then `needs_human`.
