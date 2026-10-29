---
globs: ["SECURITY-CONTEXT.md", "**/auth/**", "**/security/**"]
applies: every Product
---

# Security context

Every Product keeps a `SECURITY-CONTEXT.md` at its Repository root (the main Repository if several). It tells agents what to be careful with. v0.1 ships only this file; a security workflow type is later.

## Rules
- Read it before editing anything named in it.
- A change touching a protected path needs an explicit Goal statement covering it and a human-reviewed MR; otherwise declare a blocker.
- If the file is missing, create it from the template in the Plan Run and ask the Bauherr to confirm it (`decision-sheet`).
- Keep it short and factual: no secrets, no credentials, no incident detail.
- Update it in the same MR when a change moves a trust boundary or adds an identity.

## Template
```markdown
# Security context

## Trust boundaries
- <boundary>: <what is trusted on each side>

## Identities
- <identity>: <how it authenticates, what it may do>

## Protected paths
- `<glob>`: <why; who must review>

## Sensitive data
- <data class>: <where it lives, how it is handled>

## Out of bounds for agents
- <action or system agents must never touch>
```
