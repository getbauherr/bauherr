The Button triggers one action; each page has at most one primary.

## When to use
- Primary (`accent` fill, `on-accent` text): the single decision a page asks for, e.g. "Approve plan".
- Secondary (`surface-100`, `hairline` border, `ink`): every other action, e.g. "Ask for changes".
- Danger (`danger` text, `hairline` border): destructive actions, e.g. "Cancel run".
- Disabled (`surface-200`, `ink-muted`): only with a visible reason nearby.

## Consumer provides
- A verb label in sentence case.
- The action (click handler or form submit).

## Spec
One size: height 36px, padding `0 space-3`, `radius-md`, `body` type at weight 500.
Hover changes `background-color` over `duration-state` with `ease-out`. Focus: 2px `focus` outline, 2px offset.

## Do
- Label with a verb: "Approve plan", "Re-run failed steps".
- Keep buttons `space-2` apart.

## Don't
- Don't use `accent` fill for more than one button per view.
- Don't add shadows, pills or icon-only buttons.
- Don't use `danger` as a fill.
- Don't animate anything but `background-color` and `border-color`.
