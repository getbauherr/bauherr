The Gate is the details card behind a sign-off: it shows what is approved and the evidence. The action itself lives in the ActionBar.

## When to use
Only at the two human gates: plan approval and merge.

## Consumer provides
Title, ticket number, stage, budget, model, goal statements with verified state, evidence lines with exit codes.

## Spec
Card: `surface-100`, `hairline` border, `radius-md`, padding `space-6`. Title in `heading`, meta line in `small` / `ink-muted`.
Goals: each with a mark, "✓ verified" in `ok` or "Unverified" in `warn`. Evidence: `mono` block on `surface-200`; exit 0 in `ok`.
The card carries `id="details"` and no primary button.

## ActionBar
One bar, first on the Ticket page in every state, same position. Left: one sentence for the need (`body`). Right: "Show details" link, at most one secondary Button, exactly one primary Button labelled with the verb of the step. Nothing asked: the sentence says who is working, no button.
Placement: `position: sticky; top: 0` on desktop; at `max-width: 640px` `position: fixed` to the bottom of the viewport with a top hairline and `env(safe-area-inset-bottom)` padding, and the page gets matching bottom padding. `surface-100`, `hairline` border, `radius-md`, padding `space-3` / `space-4`.

## Do
- Show evidence next to the goals it supports.
- Name the budget and model.

## Don't
- Don't add a second primary button.
- Don't put evidence in `body`; commands go in `mono`.
- Don't rely on color alone for verified state.
