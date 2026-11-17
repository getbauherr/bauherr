# MR body

The MR body is read by the Reviewer and the person who accepts. Sections in this order, under about 40 lines in total; the factory adds `## Evidence` ([evidence](../../rules/evidence.md)), you add the rest:
```markdown
## Why
<the Ticket's problem in one or two lines>
## What changed
- <behaviour, not files>
## Scope
<what is in; what is deliberately out>
## Tradeoffs
<what you chose against, and why>
## Blast radius
Safe because: <the one fact the change is safe because of>. Sure: `read the code`
## Verification
<what you ran or looked at, tagged measured, inferred or guess>
```
`## Blast radius` names exactly one confidence value, from weakest to strongest: `you said so` < `read the code` < `test covers it` < `reproduced in the running app`. `request_review` is refused naming the missing section or value. Then add `## Approval brief` ([approval-brief](approval-brief.md)).
