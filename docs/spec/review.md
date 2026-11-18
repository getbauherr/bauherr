# Review

## Pre-review

A Build whose MR-only diff has 30 or more changed lines ends with a self-review and one fix pass.

- The self-review uses the Workspace `cheap` tier and the review rubric, at most 20% of the Run budget, no separate Run. Fix pass: high and medium findings.
- Low findings and the line `Self-review: <n> findings, <m> fixed` go into the Evidence.
- The autonomous Runner does this before it pushes. A session Run does it as a duty of [run-contract](https://github.com/getbauherr/bauherr/blob/main/pack/skills/run-contract/SKILL.md).

## Review checks

The Product's `reviewChecks` run on changed file paths only, never on a language. Settings > Products takes one rule per line, empty means off.

| Rule | Passes when |
|---|---|
| `src/** => tests/**` | Changed source has a changed test file, and test files named in the Evidence exist |
| `schema: <globs> => <globs>` | A changed schema file has a changed migration file |
| `ran: <command>` | The Evidence shows the command with exit code 0 and names the pushed head SHA |
| `evidence` | The `## Evidence` plan-step table has a `done` or `deferred` row per plan step |

- A failing check blocks `request_review`, and `finish_run` with an MR. The failing lines are returned and the Ticket stays in Build. `run_checks` returns the same list.
- The Runner gets one fix pass, then the Run ends `failed` without pushing.
- `ran:` checks the record. CI stays the source of truth.

Two guards run without Product configuration, in the Runner and in `request_review` and `run_checks` over the MR diff:

- The fake-green guard blocks a diff that deletes a test file or cases, adds `.skip`, `.only`, `xit` or `test.todo`, lowers a coverage or lint threshold, or raises `retries`. Only a plan line `Allowed: remove tests <path>` permits removing tests.
- The diff budget warns above 400 changed lines, without lockfiles, generated files and tests. It does not block. Warnings appear in `run_checks` and the Evidence.

The Runner stops a Run whose agent ran the same Bash command 3 times in a row with identical exit code and output. It ends `needs_human` with reason kind `stuck`, which enters the escalation ladder.

Proof attached to a Ticket is described in [Review artifacts](proof.md).

## Review stage

A Ticket entering `review` with a factory MR gets a Review Run. Session Runs end with `submit_review`, autonomous Runs write `.bauherr/review.json`.

The default pack runs three Job kinds:

- Five find Jobs in parallel: `correctness`, `security` when the change touches the Product's `security` paths, `ux` when it touches `ui`, `test` for bugs, and `ax`. They report candidates and no verdict. Skill: [review](https://github.com/getbauherr/bauherr/blob/main/pack/skills/review/SKILL.md).
- `verify`, role `verifier`, skill [verify-findings](https://github.com/getbauherr/bauherr/blob/main/pack/skills/verify-findings/SKILL.md). It keeps only findings with `file:line` and a scenario. Correctness classes need a failing test. The rest goes to `open`.
- The stage's own Job, role `reviewer`, skill [review-rank](https://github.com/getbauherr/bauherr/blob/main/pack/skills/review-rank/SKILL.md). It dedupes, ranks and submits the verdict.

A conditional Job whose `when` does not match is skipped. That includes a Product that declares no such path set. Only the `types` Job needs no path set.

The Run posts one `<!-- bauherr:review -->` comment on the MR: verdict, findings with severity, file:line, defect and scenario, Open, the failing tests, and "Noted, not sent back". The verdict is `changes` if and only if a finding that counts exists.

Review prompts exclude the MR title and body. Ticket, plan, worklog and diff text are fenced as untrusted data.

## Findings

`normalizeReview` in `lib/actions.ts` serves `submit_review` and the Runner's output. A finding without `class` is refused, naming the classes.

| Class | Severity | Counts |
|---|---|---|
| `correctness`, `wrong-results`, `data-loss`, `security`, `rule`, `plan` | `high` or `medium` | Yes, 🔴 Important |
| `low` | `low` | No, 🟡 Nit, at most 5 per review via `MAX_NITS`, the post ends with "N more nits not posted" |
| `pre-existing` | Any | No, 🟣 Pre-existing |

- Pre-existing findings are listed under `## Pre-existing` in the MR comment and stored in `tickets.preExisting` as deduplicated `{file, line, msg, scenario}`. The AX role can move them to the feature map's `debt[]`.
- A counting finding without a scenario is refused. In autonomous mode it moves to `open` with reason `no-evidence`. A claim based only on naming goes there too.
- `correctness`, `wrong-results` and `data-loss` count only with `test: {command, failure, patch?}`, the failing test on the MR head. The reviewer cannot push, so Build's first step on return adds the test, sees it fail and fixes. A test that already passes voids the finding. An autonomous reviewer has no shell and derives the failure by tracing. `security` counts with a scenario alone.
- `open: [{text, reason}]` with reasons `no-failing-test`, `constructed-input`, `out-of-round-scope`, `no-evidence` never changes the outcome. It is stored in `artifacts.review.open` and shown in the MR comment, the worklog and the Ticket page.
- Round is `reviewRounds` plus 1. From round 2 only `security`, `correctness`, `wrong-results` and `data-loss` count. `rule` and `plan` findings go to Open. The reviewer gets the diff since the previous `changes` review, `reviewedSha` to head.
- A session's `submit_review` is refused for a correctness-type finding without `test` and for an out-of-round finding. The autonomous path moves such a finding to `open` and derives the verdict from the rest.
- `rule` and `plan` send the Ticket back in round 1 only.
- Each Important finding is also an inline thread on the MR. A later round resolves the thread when it re-checks the finding's class and no longer reports the finding. Identity is label plus message. The class comes from the findings stored on earlier review Runs. A thread whose class the round does not re-check stays open.
- The output must include `checked`: correctness, over-engineering, spec-vs-plan and evidence, each with a justification. Otherwise the Ticket goes to `ready_for_human` and is never merged.
- A failure while concluding sets `needs_human` with a comment. A verdict held while the Ticket is still in `review` with no `reviewState` is concluded again by `watch-release` after 2 minutes, without a second comment.
- `changes` appends blocking findings to the worklog's Unfinished work and low findings to Open, moves the stage to `build` and starts a Build Run on the same MR branch.

### REVIEW.md

The Product's `REVIEW.md` is read from the root of the base branch, never the MR head, so an MR cannot change its own review rules. The Runner reads `origin/<base>:REVIEW.md`, first 20 KB, into a fenced untrusted section of the review Run's AGENTS.md. Sessions run `git show origin/<base>:REVIEW.md`. It may change severity calibration, add "always check" items and exclude paths or classes. It never approves.

## Round cap

Each return to Build, by a counted finding or red checks, is a round.

- After 2 rounds the first cap hit is granted by the factory with touch `review-cap:auto-grant`, actor `factory` and one comment. `reviewRounds` drops by 1 and the Ticket returns to Build on the same MR.
- A later hit, or any after an owner grant, goes to `needs_human`.
- At the cap the Ticket page shows the gate "Round cap reached". "Grant one more round" lowers `reviewRounds` by 1, resets `reviewState` and returns to Build. "Stop" leaves the MR open, moves the Ticket to `triage` with a comment and keeps `reviewRounds`.
- Both record a human touch, `review-cap:grant` or `review-cap:stop`. Only an Admin or Workspace Bauherr may use them, and only at the cap.
