---
globs: ["**"]
applies: Build Runs; the MR description
---

# Evidence

Every MR carries a `## Evidence` section. The Runner appends it from recorded Steps; the agent may add. It is shown next to the MR gate.

## Must contain
1. **Goal status**: each Goal statement with `verified` or `blocked`, and the evidence reference.
2. **Commands**: each check run, exact command, exit code, time.
3. **Tests**: summary (passed / failed / skipped) and the new or changed tests by name.
4. **Lint baseline diff**: new findings vs baseline (expected: none). Count only, plus the list if non-zero.
5. **UI changes**: screenshots or a Link to a preview; before/after where relevant.
6. **Not verified**: what was not checked and why. Empty means everything was.

## Format
```markdown
## Evidence
| Goal statement | Status | Evidence |
|---|---|---|
| All tests pass | verified | `make test` exit 0, 212 passed |

**Lint baseline**: unchanged (0 new)
**Not verified**: none
```

## Rules
- Evidence is from after the last edit.
- A failing or skipped check is listed, never omitted.
- No prose summary replaces a row; a row without a reference is `unverified`.
- Checks are recorded by the Runner; copying output by hand is not evidence.

See `run-contract` for the exit rule.
