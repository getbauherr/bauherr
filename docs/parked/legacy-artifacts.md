# Legacy per-stage artifacts

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

Every stage produced its own document. Fields and sections, with where each was stored:

| Document | Sections or fields | Stored in |
|---|---|---|
| Triage result | `outcome` plan/refine/skip, `reason` (one line), `questions[{title, default, alternatives}]`, `expedite`, `causedBy` | Questions as a forge comment starting `<!-- bauherr:triage -->` (template `triage-questions`); outcome as a stage label; `causedBy` on the ticket |
| Decision sheet | rows `D<n>`: question, alternatives, default, why, `critical`; answers `D1: <text>` or `ok`; "Resolved" block | Rows inside the triage or plan comment; answers in a comment marked `<!-- bauherr:decisions -->`; ticket fields `openCriticalDecisions`, `openOwnerRows`, `decisionsAtApproval` (rows frozen at plan approval: id, title, status answered or default, answer) |
| Plan | `## TL;DR`, `## Goal`, `## Steps`, `## Files`, `## Decisions`, `## Sub-tickets`; the AX scan added `## Agent experience` | Comment `<!-- bauherr:plan -->`, edited in place |
| Plan TL;DR | `Decision`, `Recommendation`, `Why` (1 to 3 bullets), `Risk`, `Options` (optional); must be the first section | Parsed by `parseTldr`, stored in ticket field `planTldr` |
| Investigation | `cause`, `decision` revise / fix-ticket / needs-human, `fix{title, body}`, `question`, `model`; after a Build failed twice (cap `MAX_INVESTIGATIONS` 2) | Appended to a comment `<!-- bauherr:investigation -->`; a fix-ticket became a new `type:bug` ticket; Run field `investigation` |
| Escalation log | one line per escalation step | Comment `<!-- bauherr:escalation -->`; Run field `escalation` |
| MR body | `## Why`, `## What changed`, `## Scope`, `## Tradeoffs`, `## Blast radius` (one of four confidence values), `## Verification` (tagged measured, inferred or guess), then `## Approval brief` and `## Evidence`; about 40 lines | The forge MR description |
| Approval brief | `### What changes for whom` (3 to 7 bullets tagged visible, behaviour or internal), `### Not included`, `### Risk and rollback` | Written in the MR body; parsed and frozen once per merge sha into ticket field `approvalBrief` {sha, changes, notIncluded, risk, proof, noted, checks, links} |
| Evidence section | the nine required parts below | Appended to the MR body by the Runner (`buildEvidence` in `packages/runner/src/evidence.ts`); Run field `evidence` |
| Proof artifacts | `kind` image/recording/preview/transcript/sample/report, `title`, `criterion`, `rule`, `pair` before/after, `sha`, `waived` | Collection `artifacts`; shown as a proof table |
| Review findings | `verdict` clean/changes, findings `{severity, class, file, line, msg, scenario, test}`, `open[{text, reason}]`, `checked[{area, note}]` | Run fields `verdict`, `findings`, `reviewedSha`; MR comment `<!-- bauherr:review -->` |
| Staging summary | What you get, Approval brief, Proof, Found on the way, Decisions taken, Open, Accept | Comment `<!-- bauherr:staging-summary -->`; first two sections in ticket field `stagingTldr` {whatYouGet, found} |
| Worklog | Goal checklist, Current instructions, Owners (item, owner, paths), Unfinished work, Open, Decisions (dated), Affected Tickets | Pinned comment `<!-- bauherr:worklog -->`, mirrored to `.bauherr/worklog.md` |
| Progress comment | headline, `Next:` line, detail, one section per state (received, question, planning, approval, building, reviewing, staging, waiting, released, stuck, closed, split, blocked) | One comment `<!-- bauherr:progress -->` updated in place; hash `progressHash` skips unchanged writes; notices `<!-- bauherr:progress-notice:<key> -->` |
| Decision (card) | `need`, `checkpoint`, `title`, `ask`, `recommendation`, `why`, `options[{label, action, effect}]`, `next`, `evidence` | Ticket field `decision`, rebuilt by `buildDecision` on each gate sweep |

The nine parts of the Evidence section (`pack/rules/evidence.md`): goal status per statement; commands with exit code and time; tests (counts and new tests by name); lint baseline diff; proof for review per artifact rule (default rule "UI change: before/after" for `light-desktop` and `dark-desktop`); plan steps done or deferred; self-review line; accessibility command or "No a11y check"; not verified.

## The requirement behind it

- A person who never reads code must be able to decide: decision first, recommendation, three facts, proof (decision cards, plan TL;DR; no issue number found).
- Every claim of "done" needs a recorded check, not an assertion (evidence rule, sources `osmani-review`, `pstack`).
- A successor Run must pick up work from a record (worklog, `osmani-long-running`).
- The requester sees plain-word progress on the forge issue.

## Where the code is

- Templates `pack/templates/` (9 files, 12 to 63 lines): `decision`, `plan`, `progress`, `request`, `review`, `staging-summary`, `triage-questions`, `worklog`, `release-note`.
- Rules and skills: `pack/rules/evidence.md` (55), `pack/skills/run-contract/` (`SKILL.md` 79, `mr-body.md` 18, `approval-brief.md` 18, `session.md`, `autonomous.md`), `pack/skills/decision-sheet/`, `pack/skills/worklog/`, `pack/skills/plan/investigation.md`, `pack/skills/triage/`, `pack/skills/review/output.md`.
- Library, `apps/server/src/lib/`: `decision.ts` (322), `approval-brief.ts` (79), `tldr.ts` (46), `artifacts.ts` (145), `progress.ts` (230), `summary.ts` (58), `investigation.ts` (141), `escalation.ts`, `templates.ts`, `template-text.ts`, `pre-review.ts`. Markers in `apps/server/src/app/(app)/lib/plan.ts`; `parseDecisions`, `parseAnswers`, `freezeDecisions` there. Triage sheet: `triageSheet` in `actions.ts`.
- Collections in `apps/server/src/collections.ts`: ticket fields `decision`, `planTldr`, `stagingTldr`, `decisionsAtApproval`, `approvalBrief`, `progressHash`, `progressCommentId`, `progressNotified`; collections `artifacts`, `templates` (per-Workspace template override); Run fields above.

## Why it was cut

The same goal, decisions and open items were restated in up to six documents across three storage places. The lean core keeps them once in the ticket record and renders the Brief, Result and Question cards from it.

## What a module on the new core needs

Mapping of each old document to the record or card that replaces it. Record fields: `goal`, `type`, `source`, `criteria[]` (`text`, `verify`, `status`, `proof`), `outOfScope`, `risk` (`door`, `areas`, `rollback`), `decisions[]` (`question`, `options`, `recommended`, `answer`, `by`, `at`), `plan.steps`, `findings[]` (`axis`, `text`, `evidence`, `status`), `handoff`, `result` (`changes` with tags, `walkthrough`, `notVerified`, `cost`).

| Old document | New home |
|---|---|
| Triage outcome and reason | `type` and `source`, set at Intake; the outcome is an event (accepted, needs information, duplicate, not planned, disputed) |
| Triage questions, decision sheet | `decisions`; open ones show on the Brief card or as a Question card; each answer is stored as an owner statement |
| Plan Goal, Steps | `goal` and `criteria`, each with how it is verified; `plan.steps` |
| Plan TL;DR | Brief card, rendered from `goal`, `criteria`, `outOfScope`, `risk`, `decisions`; no separate field |
| Plan Files (path globs) | no place in the record (the old code used it to hold overlapping Builds) |
| Plan Sub-tickets, `## Agent experience` moves | no place; a split is made as separate issues |
| Investigation cause | an event; two failed runs end in a Question card |
| MR body Why, What changed | `goal`; `result.changes` |
| MR body Scope | `outOfScope` |
| MR body Blast radius | `risk`; the four-value confidence ladder has no field |
| MR body Tradeoffs, Verification | `decisions` taken without the owner; `criteria[].proof` and `result.notVerified`; the tags measured, inferred, guess have no place |
| Approval brief | Result card: `result.changes` with the same visible, behaviour, internal tags, `outOfScope`, `risk.rollback` |
| Evidence section | `criteria[].status` and `criteria[].proof`; exit codes come from CI checks in the mirror or from the Runner; `result.notVerified`; self-review has no place; lint and accessibility are checks, not text |
| Proof artifacts | collection `proofs`, linked from `criteria[].proof`, added with `attach_proof` |
| Review findings | `findings`; `open` items go to `result.notVerified`; `checked` areas have no place |
| Staging summary | Result card; "Found on the way" maps to `findings`, "Decisions taken" to `decisions` |
| Worklog | event log plus `handoff`, written at the end of every run; Owners table and Affected Tickets have no place |
| Progress comment | the one status comment, rendered from the record by the forge writer; the 13 state texts can be lifted |
| Decision card | Brief, Result and Question cards; the options with their `effect` lines can be lifted |

- Lift almost unchanged: `parseTldr`, `parseApprovalBrief`, `buildDecision`, `progressOf`, `buildProof`, `buildEvidence`, and the template texts in `pack/templates/`.
- Traps: comment markers were the only link to the forge, so a deleted or edited comment lost state (inferred); the frozen brief is keyed by merge sha, so a second merge re-freezes it; `decisionsAtApproval` exists because later sheet edits must not change what the owner approved.
