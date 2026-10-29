# Sheet format

```markdown
## Decisions needed (<Ticket>, <stage>)

| # | Question | Options | Default | Why | Critical |
|---|---|---|---|---|---|
| D1 | Keep the public endpoint name? | keep / rename | keep | Renaming breaks clients | yes |
| D2 | Pagination size | 25 / 50 | 25 | Matches the existing lists | no |

Reply per row (`D1: rename`) or `ok` to accept all defaults.
Non-critical rows without a reply apply their default on <date/time or next stage entry>.
Critical rows block: <the work that waits>.
```

## After answers
```markdown
**Resolved**
- D1: answered by <person>, 2026-01-01. rename. Consequence: updates #12, #14.
- D2: default applied. 25.
```
