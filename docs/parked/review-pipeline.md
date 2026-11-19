# Review pipeline (find, verify, conclude)

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- The review stage ran Jobs: up to five parallel find Jobs (`correctness`, `security` when the change touches the `security` path set, `ux` for `ui`, `test` for bugs, `ax`), then a `verify` Job (role `verifier`), then the concluding Job (role `reviewer`, skill `review-rank`). Find Jobs reported candidates and no verdict.
- Nine roles: orchestrator, engineer, reviewer, security, ux, test, docs, ax, verifier (`pack/roles/`, `pack/factory.yaml`).
- Findings had a `class`. Counting classes (Important): `correctness`, `wrong-results`, `data-loss`, `security`, `rule`, `plan`. `low` was a Nit, at most 5 (`MAX_NITS`). `pre-existing` was listed apart and stored in `tickets.preExisting`. A finding without `class`, or a counting one without a scenario, was refused. The first three counted only with a failing test `{command, failure, patch?}`; findings without proof went to `open` with a reason (`no-failing-test`, `constructed-input`, `out-of-round-scope`, `no-evidence`) and never changed the outcome.
- The verdict was `changes` if and only if a counting finding existed. `checked` (correctness, over-engineering, spec-vs-plan, evidence, each with a justification) was required, else `ready_for_human`. Each Important finding was also an inline thread on the MR; a later round resolved a thread only when it re-checked that class and no longer found it.
- Rounds: each return to Build was a round. From round 2 only `security`, `correctness`, `wrong-results`, `data-loss` counted. After 2 rounds the first cap was granted by the factory; then `needs_human` with "Round cap reached" and MCP `grant_review_round` or `stop_review` (Admin or Workspace Bauherr).
- `REVIEW.md` came from the base branch only (first 20 KB, fenced as untrusted). It could calibrate severity, add "always check" items and exclude paths; it never approved.
- Risk zones: the reserved path set `red` added a human Job `owner-review` (Careful preset), "Mark reviewed" in the Inbox; the review concluded only after it.
- Before review: a self-review at 30 or more changed lines (cheap tier, at most 20% of the budget), review checks (`reviewChecks`), a fake-green guard, a diff budget warning above 400 lines.

## The requirement behind it

- One reviewer misses security, UX and test gaps; specialists find more, but unverified findings send tickets back for nothing (#712, #713, #727).
- A finding must be proven: a failing test or a reproduction scenario. Round limits stop endless ping-pong (#729 thread resolve).
- Specs: `docs/spec/review.md` (90 lines), `docs/spec/proof.md`.

## Where the code is

- `apps/server/src/lib/actions.ts` (2009): `normalizeReview` (l. 1263), `MAX_NITS` (l. 1208), `resolveFixedThreads` (l. 1658), `concludeReview` (l. 1675), `watchReviews` (l. 1739), `grantReviewRound` (l. 1441), `stopReview` (l. 1462). Also `stage-jobs.ts` (173: `startReadyJobs`, `candidatesOf`, `finishJob`), `pre-review.ts` (49), `path-sets.ts`, `workflow-when.ts`.
- MCP tools in `apps/server/src/lib/mcp-tools.ts`: `request_review` (l. 536), `submit_review` (l. 627), `grant_review_round`, `stop_review`, `run_checks`.
- Pack: `pack/roles/*.md` (9 files), `pack/skills/review` (59 + `output.md` 26), `review-rank` (27), `verify-findings` (36), `mr-security-review` (26), `ux-review` (30), `test-review` (27), `harden` (53), `REVIEW.md` (18, repo root).
- Runner: `packages/runner/src/pre-review.ts`, `materialise.ts` (REVIEW.md fence), `guards.ts`, `clone.ts` (reads `origin/<base>:REVIEW.md`).
- Forge: `resolveReviewThread`, `reviewPullRequest` in `packages/adapters/src/contracts.ts`.
- Collections (`apps/server/src/collections.ts`): tickets `reviewRounds`, `reviewState`, `preExisting`; products `reviewChecks`, `pathSets`; runs `job`.
- Tests in `apps/server/tests/`: `review.test.ts`, `review-jobs.test.ts`, `pre-review.test.ts`, `security-findings.test.ts`, `job-view.test.ts`.

## Why it was cut

The lean core has three roles (builder, reviewer, verifier). A finding needs a failing test or a reproduction, and security and UX become path-triggered checklists. The finer pipeline can return as a module once the simple gate is measured.

## What a module on the new core needs

- Core contracts: findings are a field of the ticket record (`findings`), written only by the record store from a schema-validated Run result. Reviews run as Runs; a counted finding returns the ticket to Build as an event; the round cap ends in a Question card.
- Lift almost unchanged: the finding schema and `normalizeReview` rules (class table, scenario required, proof for the three classes), `MAX_NITS`, the round rule (later rounds count fewer classes), the skills and role texts in `pack/`.
- Design again: path-triggered Jobs as module triggers (`touches` sets); fan-out and join of find Jobs; thread auto-resolve through the forge writer.
- Trap: the reviewer cannot push, so a correctness finding's test is added by the next Build run first and must fail before the fix; a test that passes voids the finding.
- Trap: `REVIEW.md` is read from the base branch, never the MR head, so an MR cannot change its own rules. PR title and body are kept out of review prompts.
- Trap: thread identity was label plus message; resolving a thread whose class the round did not re-check was a bug (#729).
- Trap: a review is tied to a head SHA; a moved head restarts it, unless the patch-id is unchanged.
- Trap (inferred): a conditional Job for an undeclared path set is skipped, so a Product without path sets gets no security review.
