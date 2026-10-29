The Gate is the card where the Bauherr signs off: it shows what is approved, the evidence, and one primary action.

## When to use
Only at the two human gates: plan approval and merge.

## Consumer provides
Title, ticket number, stage, budget, model, goal statements with verified state, evidence lines with exit codes.

## Spec
Card: `surface-100`, `hairline` border, `radius-md`, padding `space-6`. Title in `heading`, meta line in `small` / `ink-muted`.
Goals: each with a mark, "✓ verified" in `ok` or "Unverified" in `warn`. Evidence: `mono` block on `surface-200`; exit 0 in `ok`.
Actions: one primary Button ("Approve plan") and one secondary ("Ask for changes"), `space-2` apart.

## Do
- Show evidence next to the goals it supports.
- Name the budget and model.

## Don't
- Don't add a second primary button.
- Don't put evidence in `body`; commands go in `mono`.
- Don't rely on color alone for verified state.
