# Review output

Session Run: call `submit_review {runId, leaseToken, verdict, findings, open, checked, markdown}`.
Autonomous Run: write `.bauherr/review.json`, then set the Goal statement to verified; no shell: read `.bauherr/diff.patch`.

`checked` is required: one note per area (`correctness`, `over-engineering`, `spec-vs-plan`, `evidence`); a missing area or contradicting `verdict` goes to a human.

```json
{"verdict": "clean | changes",
 "findings": [{"severity": "high|medium|low", "class": "<class from the table>", "file": "src/a.ts", "line": 12, "msg": "what is wrong", "scenario": "when ..., then ...", "test": {"command": "...", "failure": "...", "patch": "..."}}],
 "open": [{"text": "...", "reason": "no-failing-test|constructed-input|out-of-round-scope|no-evidence"}],
 "checked": [{"area": "correctness", "note": "traced X with Y; fine"}, ...one per area],
 "markdown": "..."}
```
`verdict` is `changes` iff a finding with a class other than `low` and `pre-existing` exists (the factory derives it). `low` goes with severity low, `pre-existing` with any severity, every other class with high or medium; no `class` is refused. Limits (server-enforced): 50 findings, 50 `open`, `file` a repository path, `line` >= 0. `markdown` is posted as the MR comment (the factory adds the failing tests and `open`):

```markdown
**Verdict**: clean | changes
## Findings
- [high] src/a.ts:12 <defect>. Scenario: <when ..., then ...>
## Open
- 🟡 [low] <nits and what you could not check>
## Pre-existing
- 🟣 src/b.ts:4 <bug this MR did not introduce>
```

