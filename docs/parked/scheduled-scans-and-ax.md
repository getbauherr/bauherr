# Scheduled scans and the AX role

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- Security scan: per Product `securityScan {enabled, cron, maxBudgetUsd, maxTurns, lastScanAt}`. Default cron `0 0 4 * * 1` (Mondays 04:00). The hourly job `security-scan-tick` started at most 5 due scans (`SCANS_PER_TICK`), oldest first, and skipped a Workspace whose budget was spent. A scan could also be started by hand.
- A scan is a read-only Run (`pack/workflow-security.yaml`, skill `security-scan`) on one long-lived anchor Ticket per Product (label `bauherr:security-scan`). It wrote `findings.json`: one finding per root cause, severity critical/high/medium/low.
- `fileFindings` filed each new finding as its own Ticket (labels `bauherr:security`, `security:<sev>`; high and critical went straight to Triage). Dedupe key: a 12-hex hash of Product slug, root cause and sorted files, stored as a body marker. Max 10 new Tickets per scan, the rest listed in a comment on the anchor. A repeat was commented; a raised severity swapped the label. Evidence and fix text were scrubbed of token-like strings.
- Docs check: started by hand only (no tick). A read-only Run (`docs` stage, skill `docs-check`) compared docs globs (default `README.md`, `docs/**/*.md`) with Tickets merged since `lastCheckAt` (or last release, or 30 days). Findings were `stale` and `missing`, validated against the merged list. At most one open docs Ticket per Product (label `bauherr:docs`), updated in place; 30 items max. Review of a docs Ticket failed if its MR touched files outside the docs paths.
- "Generate verification" (button in Settings): `startVerifyCreate` filed one Ticket per Product (label `bauherr:verify-create`, at most one open) for the AX role to write `verify-<slug>` into the Knowledge repo, seed `feature-map.yaml` with 3 to 5 features and run it once.
- AX role (`pack/roles/ax.md`, strong tier), skill `harden` in four modes: plan scan (max 3 moves, levels L1 to L4, about 30% of the estimate), review check, correct (a mistake counts from its second occurrence), comment check. `verify-maintain` re-drives touched features and classifies failures as doc drift, harness gap or product gap.
- Staging walk: release stage job `staging-walk` (role `ax`, skill `verify-maintain`). `pass` lets Accept continue; `findings` send the Ticket back to Build.
- Blast radius: the MR body must hold `## Blast radius` with exactly one of four confidence values: `you said so`, `read the code`, `test covers it`, `reproduced in the running app`. Pre-review failed otherwise.

## The requirement behind it

- Find security problems and stale docs without a human asking, and turn them into ordinary Tickets (#42, #463, #464, #560, #561).
- Every agent mistake should become a check, not a prose rule (trust pyramid, #703).
- A new Product needs a working way to see a change run (#728).
- The reviewer should know how sure the author is about the blast radius of a change.

## Where the code is

- `apps/server/src/lib/security-scan.ts` (140 lines), `apps/server/src/lib/docs-check.ts` (156), `apps/server/src/lib/verify-create.ts` (36), `apps/server/src/lib/pre-review.ts` (49, `blastRadiusFailures`).
- `apps/server/src/jobs/index.ts`: `securityScanSweep`, `securityScanTick`.
- `apps/server/src/collections.ts`: Product groups `securityScan` (line 642) and `docsCheck` (line 654).
- Settings actions in `apps/server/src/app/(app)/(shell)/settings/actions.ts`.
- Pack: `pack/workflow-security.yaml`, `pack/roles/ax.md` (27), `pack/skills/harden` (53), `pack/skills/verify-create` (34), `pack/skills/verify-maintain` (22), `pack/skills/security-scan` (31), `pack/skills/docs-check` (20). `pack/skills/verify-findings` belongs to the review stage (verifier role), not to AX.
- Staging walk and ax jobs: `pack/factory.yaml`, `pack/presets/standard.yaml`, `pack/presets/careful.yaml`; text in `docs/spec/release.md`.
- Tests in `apps/server/tests/`: `security-scan.test.ts`, `docs-check.test.ts`, `docs-check-actions.test.ts`, `blast-radius.test.ts`, `verify-resolve.test.ts`.

## Why it was cut

The lean core has no scheduled runs that create work on their own. One automation is added at a time once the basic loop is clean. A repository readiness module is planned later and can take over the verification recipe.

## What a module on the new core needs

- Trigger: a schedule that creates an Intake item (source = scan) in the record store. The module reads the record's `type` and `source` and writes nothing else; the forge writer files the Tickets.
- Lift almost unchanged: `parseFindings`, `findingKey`, `scrub`, `parseDocsFindings`, `checkAgainstMerged`, `outsideDocsPaths`, `blastRadiusFailures`, `docsTicketBody`. The skills in `pack/skills` are plain prose.
- Redesign: the anchor Ticket (use the mirror and a run key instead); the `pg_advisory_xact_lock` start (the core needs its own duplicate-run guard); budgets (use the core's loop caps and Question card); the staging walk as a Verify step, not a job.
- Human re-entry: a Question card when the finding cap or budget stops a scan.
- Traps: the dedupe marker lives in the Ticket body, so a human edit can cause a duplicate (inferred). A failed start wrote `lastScanAt` as a back-off to stop an hourly retry loop. The docs window is open-ended if no check ever finished. The scan agent has no shell and no network by design; a scan with an incomplete `SECURITY-CONTEXT.md` reports one low finding.
- Not found: any scheduled docs check; the cron field is only on `securityScan`.
