# Bauherr design system

Source of truth for the product's look: tokens, brand book, mark, component guidelines and previews. The browsable version (same files) lives in the owner's design-system artifact; agents build from this folder. Previews expect the compiled token variables (`--<token>`) and the type-style classes; see `tokens.json`.

Bauherr is the person who commissions a building and signs off on the work. The product is the factory that does the work; the interface exists so that person can decide quickly and trust what they see. Everything below serves that: few elements, one accent, square geometry, slow motion.

## Principles

1. **Decide, don't browse.** Every screen has one job and one primary action. A page that asks for a decision shows the decision sheet first and the evidence beside it; nothing else competes.
2. **One accent.** `accent` is the only brand hue. Status colors (`ok`, `warn`, `danger`) mean state and always come with a word or glyph. If something is blue, it can be clicked or it is selected.
3. **Hairlines, not shadows.** Surfaces are separated by `hairline` on `surface-000` / `surface-100`. Shadows exist only on a drawer in motion.
4. **Nearly square.** `radius-sm` by default, `radius-md` on buttons and cards, `radius-lg` only on drawers and the cover. Nothing is a pill.
5. **Slow and unobtrusive.** Motion confirms a state change (`duration-state`) or places a panel (`duration-panel`), always `ease-out`, never more than 8px of travel, never a bounce or loop. Under `prefers-reduced-motion` every duration is 0.
6. **Plain words.** Say what happens: "Approve plan", then "Plan approved". Name things as the Bauherr sees them (ticket, stage, run, gate), never as the system is built (job, label, webhook). Sentence case everywhere except `label`.

## The name and the mark

Write **Bauherr** with a capital B, in `display` or `title`, never in uppercase. The mark is the **cornerstone**: a square outline in `ink` with a solid square in `accent` at its bottom-left corner — the one stone the Bauherr lays. Use `assets/Logos/bauherr-mark.svg` at 16, 20, 24 or 32px (it is drawn on a 32 grid); the wordmark `assets/Logos/bauherr-wordmark.svg` only on the cover, the login page and documents. Keep clear space of one mark width around it. Never recolor the outline, never put the mark on `accent`, never rotate it.

## Type

One family, Archivo, from Google Fonts (`family=Archivo:wght@400;500;600`), with IBM Plex Mono (`family=IBM+Plex+Mono:wght@400`) for data. Set page titles in `title` (one per page), sections in `heading`, running text in `body` at ≤ 68 characters per line, metadata in `small` with `ink-muted`, uppercase labels in `label`. Identifiers, label names, commands, costs and anything a person might copy go in `mono` with tabular numerals. Headings get `text-wrap: balance`. No italics, no light weights.

## Color

Light theme first; dark theme is a full second palette, not an inversion. Text is `ink` on `surface-000`, `surface-100` and `surface-200`; secondary text is `ink-muted`. The accent is text-safe on every surface in both themes; on an accent fill use `on-accent`. Selected rows and active tabs use `accent-soft` with `ink` text. Status colors: `ok` for succeeded, approved and verified; `warn` for needs_human, blocked and budget near its limit; `danger` for failed, cancelled and destructive actions. Each status also shows its word or a glyph, so the colors never carry meaning alone.

## Layout and spacing

A 4px grid: `space-1` to `space-12`. Desktop pages pad `space-8`, phones `space-4`. Related controls sit `space-2` apart, sections `space-6`, major blocks `space-12`. Content measures: forms and decision sheets 640px wide, reading 68 characters, run views full width. Tables align numbers right in `mono`. Use flex and grid with `gap`; no per-element margins.

## Patterns the product is built from

- **Decision sheet**: a table of rows, each with a number, the decision, the recommended default and a `critical` mark. The Bauherr answers once; unanswered non-critical rows take their default. Render it with the `DecisionSheet` component.
- **Gate**: the two human gates (plan approval, merge) are the only places the product asks for a signature. A `Gate` shows what is being approved, the evidence, the budget and model used, and one primary button.
- **Status**: every ticket, run and step carries a `StatusChip` (queued, running, succeeded, failed, cancelled, needs human) using the status colors with its word.
- **Run views**: graph, timeline and list share the same node: name, type, status chip, duration in `mono`. Nodes appear with `duration-panel`; status changes with `duration-state`.
- **Empty states**: one sentence in `body`, one action. No illustrations.

## Iconography

Line icons at 1.5px stroke on a 20px grid, `currentColor`, from one set (Lucide). No filled icons, no emoji, no icon without a label except in a chip where the word is beside it.

## Motion

Use only `duration-state`, `duration-panel`, `duration-page` with `ease-out` for entrances and `ease-in` at half duration for exits. Allowed properties: opacity, transform (translate ≤ 8px), background-color, border-color, color. Disallowed: scale on enter, bounce, infinite loops, parallax, skeleton shimmer. A spinner is a 1.5px arc rotating once per 1.6s, in `accent`, and the only looping motion in the product.

## Writing

Sentence case. Second person for the Bauherr ("You approve the plan"), third person for agents ("The agent opened a merge request"). Buttons are verbs ("Approve plan", "Re-run failed steps"). Errors say what happened and what to do next in one sentence each. No exclamation marks, no emoji, no praise.
