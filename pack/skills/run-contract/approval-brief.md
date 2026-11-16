# Approval brief

The `## Approval brief` section of the MR body is read by the person who accepts the change on staging and approves production; the factory freezes it at merge and the Reviewer checks it against the diff. Plain words, no jargon, `###` subsections in this order:
```markdown
## Approval brief
### What changes for whom
- [visible] <what a person sees or can do differently, and who>
- [behaviour] <what works differently without a visible difference>
- [internal] <code, tests, docs nobody sees>
### Not included
- <what a reader might expect but this MR leaves out>
### Risk and rollback
<what could go wrong and how to undo it, one or two lines>
```
3 to 7 bullets, each marked `visible`, `behaviour` or `internal`; a backend-only change has no `visible` bullet and the card then says "No visible change". The proof table, checks and links are added by the factory; do not copy them.

