---
globs: ["**/SECURITY-CONTEXT.md", "**/auth/**", "**/security/**"]
applies: every Product
---

# Security context

Every Product keeps a `SECURITY-CONTEXT.md` at `products/<slug>/SECURITY-CONTEXT.md` in the Workspace Knowledge repo, not in the Product repository. It tells agents what to be careful with and is the input of the `security-scan` Run ([workflow-security.yaml](../workflow-security.yaml)).

## Rules
- Read it before editing anything named in it.
- A change touching a protected path needs an explicit Goal statement covering it and a human-reviewed MR; otherwise declare a blocker.
- If the file is missing, propose it from the template as a Knowledge PR and ask the Bauherr to confirm it (`decision-sheet`). A scan Run without it still runs and files one Ticket asking for it.
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
