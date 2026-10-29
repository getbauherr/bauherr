The StatusChip shows the state of a ticket, run or step as a word in a status color.

## When to use
On every ticket, run and step. One chip per item.

## Consumer provides
One status: queued, running, succeeded, failed, cancelled, needs human.

## Spec
`label` type (uppercase), `radius-sm`, 1px border and text in the status color on `surface-100`, padding `space-1 space-2`.
- queued: `ink-muted` text, `hairline` border
- running: `accent`, with a 1.5px arc spinner, one rotation per 1.6s; the only looping motion
- succeeded: `ok`, "✓" before the word
- failed: `danger`, "×" before the word
- cancelled: `ink-muted`
- needs human: `warn`
Color changes transition over `duration-state` with `ease-out`. Under `prefers-reduced-motion` the spinner stops.

## Do
- Always show the word; color never carries meaning alone.
- Use `ok` for verified/approved too.

## Don't
- Don't add fills, pills or other loops.
- Don't use `accent` for anything but running.
