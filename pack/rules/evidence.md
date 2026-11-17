---
globs: ["**"]
applies: Build Runs; MR description
sources: [osmani-review, osmani-long-running, pstack]
---

# Evidence

Every MR carries a `## Evidence` section. The Runner appends it from recorded Steps; the agent may add. It is shown next to the MR gate.

## Must contain
1. **Goal status**: each Goal statement with `verified` or `blocked`, and the evidence reference.
2. **Commands**: each check run, exact command, exit code, time.
3. **Tests**: summary (passed / failed / skipped) and the new or changed tests by name.
4. **Lint baseline diff**: new findings vs baseline (expected none); the list if any.
5. **Proof for review**: for each artifact rule of the Product that matches a changed path, an artifact attached on the pushed head, or a line `No artifact: <rule>: <reason>`. Without a rule nothing is required; with one, `request_review` is refused until met. A UI change (a changed path in the Product's `ui` path set) has the default rule `UI change: before/after`: for each of `light-desktop` and `dark-desktop`, two `kind=image` artifacts with `rule` `UI change: before/after`, `pair` `before` and `after`, and a `title` that starts with the variant name, case-insensitive, then the end, whitespace or punctuation (`light-desktop: Settings` matches, `light-desktop-old` does not), attached on the pushed head. A Product without a `ui` path set has no such rule.
6. **Plan steps**: one row per numbered step under the plan's `## Steps`, `done` or `deferred` with the evidence or the reason.
7. **Self-review**: one line `Self-review: <n> findings, <m> fixed`, or `skipped, <30 lines` (a diff of 30 or more changed lines gets one; see `run-contract`).
8. **Accessibility**: when a changed path is a user interface and the Product has an accessibility check (WCAG 2.2 AA), the command and its exit code, or `No a11y check: <reason>`.
9. **Not verified**: what was not checked and why. Empty means everything was.

## Format
```markdown
## Evidence
| Goal statement | Status | Evidence |
|---|---|---|
| All tests pass | verified | `make test` exit 0, 212 passed |

| Plan step | done/deferred | Evidence or reason |
|---|---|---|
| 1 | done | `src/a.ts`, `tests/a.test.ts` |
| 2 | deferred | needs the key from #12 |

**Self-review**: 2 findings, 2 fixed

**Lint baseline**: unchanged (0 new)
**Not verified**: none
```

## Rules
- Evidence is from after the last edit.
- Tag each behaviour claim `measured` (a command showed it), `inferred` or `guess`; untagged counts as `guess`.
- A failing or skipped check is listed, never omitted.
- No prose replaces a row; a row without a reference is `unverified`.
- Hand-copied output is not evidence; the Runner records checks.
- Fake-green guard: a diff that deletes tests, adds `.skip`/`.only`/`xit`/`test.todo`, lowers a coverage or lint threshold or raises `retries` is refused by pre-review naming the file; only a plan line `Allowed: remove tests <path>` permits removing tests.
- Diff budget: above 400 changed lines (without lockfiles, generated files, tests) pre-review warns `Large diff (N lines)`; split or say why.
- Spin guard: the Runner stops a Run that ran the same Bash command 3 times in a row with an identical exit code and output as `needs_human` `stuck`; change approach after one repeat.
- A Product may require commands: a `ran: <command>` rule needs that command in the Evidence with exit code 0 and the pushed head SHA (first 7 characters), run after the last edit.
- A Product may require proof per path rule (a kind, the path globs, the command that makes it into `.bauherr/artifacts/`); a waiver line is shown to the person who accepts as "No proof for <rule>: <reason>".
- A Product may require, per path rule, tests for changed source, a migration for a changed schema and a row per plan step: `request_review` is refused with the failing lines otherwise.

`request_review` also needs the MR body's `## Blast radius` ([mr-body](../skills/run-contract/mr-body.md)).

See `run-contract` for the exit rule.
