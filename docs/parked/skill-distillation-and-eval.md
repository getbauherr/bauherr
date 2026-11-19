# Skill distillation and eval

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- After a review merged a Ticket that went back to Build at least once (`reviewRounds >= 1`), or that a later bug Ticket named with `fixes #N` / `refs #N`, a job `distill-skill` was queued once per Ticket (`queueDistill`).
- One model call (standard tier, 60 KB in, 2000 tokens out) read the review findings per round and the diff. It could read up to 3 existing skills, then call `propose` with one `SKILL.md` (frontmatter plus at most 40 lines) and 2 to 5 eval cases, or call `propose` with `skip:true`.
- The proposal was checked: name `^[a-z0-9][a-z0-9-]{0,60}$`, valid regexes, each case with checks or a rubric, skill not already in the Knowledge repo.
- The eval replayed the cases twice: without the skill (cheap model) and with it, judged by the strong tier. Accepted only if the baseline fails somewhere and the with-skill run passes the suite.
- Passing proposals became a pull request on branch `bauherr/<run-id>` in the Knowledge repo, with an Evidence table. Failing ones were opened, commented "Rejected" and closed. The factory never merged.
- Caps: 5 proposals per Workspace per 24 hours (`DAILY_CAP`), $1 and 20 eval calls per distillation, 1 retry per failed case. A cap hit wrote a `skipped` proposal with the reason.
- An Admin approved (squash merge, only if the PR head still equals `expectSha`) or rejected (comment, close, optional note). Both were idempotent.
- Eval thresholds: 0.8 per case, 0.9 per suite, no regressions against a baseline file. The CLI ran the same runner over `pack/skills/<name>/evals/*.yaml`.

## The requirement behind it

- Review findings that were fixed once should not recur: a lesson from a merged fix should become reusable guidance (#465, #474).
- A skill must prove itself before it is trusted: eval runner as a shared package, usable in CI and in the server (#41, #459).
- A human stays the only one who changes the Knowledge repo.

## Where the code is

- `apps/server/src/lib/skill-distill.ts` (226 lines): `eligible`, `distillSkill`, `queueDistill`.
- `apps/server/tests/skill-distill.test.ts` (267 lines).
- `packages/eval/src/index.ts` (159 lines): `runEval`, `runChecks`, `loadCases`, `evalKey`. Test: `packages/eval/test/eval.test.ts` (127 lines).
- `apps/server/src/collections.ts`: `skill_proposals` (`ticket` unique, `run`, `status` proposed/replayed/accepted/rejected/skipped, `pr`, `skillPath`, `score`, `baselineScore`, `results`, `reason`). Migration `apps/server/src/migrations/20261109_170000_skill_proposals.ts`.
- `apps/server/src/jobs/index.ts`: task `distillSkillTask`. Callers: `apps/server/src/lib/actions.ts` (lines 1654, 1783), `apps/server/src/lib/train.ts` (line 69).
- `apps/server/src/lib/actions.ts`: `approveSkillProposal`, `rejectSkillProposal`, `approveSkillProposalOf`.
- `apps/server/src/lib/mcp-tools.ts`: human-only `approve_skill_proposal`, `reject_skill_proposal`.
- UI: `apps/server/src/app/(app)/(shell)/knowledge/page.tsx`, `apps/server/src/app/(app)/lib/knowledge.ts`.
- CLI: `packages/cli/src/cli.ts` command `eval` (flags `--skill`, `--changed-vs`, `--baseline`, `--max-usd`); `packages/cli/src/lint.ts` (128 lines) for `pack lint`, run in `.github/workflows/ci.yml`.
- Docs: "Distill" in `docs/spec/sessions.md`.
- Pack: no `evals/` folder exists under `pack/` at the tag; CI runs `pack lint` only, not `eval`.

## Why it was cut

The lean core's Learn module turns each correction into a check, a rule line or a stored owner statement. Generated skills are prose and come last. `pack lint` stays.

## What a module on the new core needs

- Trigger: the Learn step after an accept or send-back, reading `findings` and `result` from the record. Writes only a proposal; a human re-enters through a Result or Question card, not an MCP tool.
- Lift almost unchanged: `runEval`, `runChecks`, `evalKey`, `loadCases` (`packages/eval`), and the checks in `check` (`skill-distill.ts`). The cap constants are reusable.
- Redesign: input from the record instead of scanning `runs`; the proposal as a record or event instead of the `skill_proposals` collection; forge writes through the forge writer only; model calls through the one Run contract instead of a direct `fetch` to the gateway.
- Duplicate-run guard: one proposal per Ticket (unique `ticket`, plus the job `concurrencyKey` `distill:<id>`). The old code checks both.
- Traps: the daily cap counts rows, so skipped proposals use up the cap. The baseline must fail or the skill is rejected, so cheap-model eval cases that always pass block everything. Eval cost is estimated before each call (worst case), so a low budget aborts early. `approve` needs the reviewed head sha; without it a moved PR could be merged (inferred from `expectSha`).
- Not found: any pack skill with eval cases, so the skill-eval CI path was never exercised.
