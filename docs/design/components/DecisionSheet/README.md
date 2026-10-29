The DecisionSheet is a table of decisions the Bauherr answers once; unanswered rows take their default.

## When to use
Whenever a plan raises questions. It comes first on the page, evidence beside it.

## Consumer provides
Rows: number, decision text, recommended default, `critical` flag, and the answer if given.

## Spec
Max width 640px on `surface-100` with a `hairline` border and `radius-md`. Header row on `surface-200` in `label` type and `ink-muted`.
Columns: #, Decision, Default (defaults in `mono`). Row hover: `accent-soft` over `duration-state`, text stays `ink`.
Critical: "★ critical" in `label` type, `warn`, under the decision. Answered row: radio-like choice, selected ring in `accent`.
Footer: "Unanswered rows take their default." in `small`, `ink-muted`.

## Do
- Write decisions as plain questions.
- Mark critical rows; they must be answered before approval.

## Don't
- Don't use shadows or zebra stripes.
- Don't use `warn` for anything but the critical mark.
- Don't exceed 640px.
