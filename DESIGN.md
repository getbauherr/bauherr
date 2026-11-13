---
version: alpha
name: Bauherr
description: Interface of the Bauherr software factory. Few elements, one accent, square geometry, slow motion.
colors:
  surface-000: "#f5f6f7"
  surface-100: "#ffffff"
  surface-200: "#eceef0"
  ink: "#171a1f"
  ink-muted: "#5b6168"
  hairline: "#d9dce0"
  accent: "#2457c5"
  accent-strong: "#1b46a3"
  on-accent: "#ffffff"
  accent-soft: "#e4ecfb"
  ok: "#1a7f4b"
  warn: "#9a6200"
  danger: "#b42318"
  focus: "{colors.accent}"
typography:
  display:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: 40px
    lineHeight: 44px
    fontWeight: 600
    letterSpacing: -0.01em
  title:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: 24px
    lineHeight: 30px
    fontWeight: 600
    letterSpacing: -0.005em
  heading:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: 17px
    lineHeight: 24px
    fontWeight: 600
  body:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: 15px
    lineHeight: 22px
    fontWeight: 400
  small:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: 13px
    lineHeight: 18px
    fontWeight: 400
  label:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: 12px
    lineHeight: 16px
    fontWeight: 500
    letterSpacing: 0.04em
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace"
    fontSize: 13px
    lineHeight: 20px
    fontWeight: 400
    fontFeature: '"tnum"'
rounded:
  sm: 2px
  md: 4px
  lg: 8px
spacing:
  space-1: 4px
  space-2: 8px
  space-3: 12px
  space-4: 16px
  space-6: 24px
  space-8: 32px
  space-12: 48px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  button-danger:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.danger}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  button-disabled:
    backgroundColor: "{colors.surface-200}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 0 12px
  status-chip:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 4px 8px
  status-chip-running:
    textColor: "{colors.accent}"
  status-chip-succeeded:
    textColor: "{colors.ok}"
  status-chip-failed:
    textColor: "{colors.danger}"
  status-chip-needs-human:
    textColor: "{colors.warn}"
  card:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 24px
  gate:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 24px
  action-bar:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  drawer:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 24px
  field:
    backgroundColor: "{colors.surface-200}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 0 12px
  selected-row:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  code-span:
    backgroundColor: "{colors.surface-200}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
---

# Bauherr design system

Source of the tokens: `docs/design/tokens.json`. The YAML front matter above is derived from it (light theme) and must stay equal to it; the dark theme, motion tokens and all rules live in this file. `docs/design/README.md` is a pointer to this file. Component guidelines and previews stay in `docs/design/components/` and `docs/design/assets/`.

## Overview

Bauherr is the person who commissions a building and signs off on the work. The product is the factory that does the work; the interface exists so that person can decide quickly and trust what they see. Everything serves that: few elements, one accent, square geometry, slow motion. Tone: professional, calm, dense without clutter.

Principles:

1. **Decide, don't browse.** Every screen has one job and one primary action. A page that asks for a decision shows the decision sheet first and the evidence beside it; nothing else competes.
2. **One accent.** `accent` is the only brand hue. Status colors (`ok`, `warn`, `danger`) mean state and always come with a word or glyph. If something is blue, it can be clicked or it is selected.
3. **Hairlines, not shadows.** Surfaces are separated by `hairline` on `surface-000` / `surface-100`. Shadows exist only on a drawer in motion.
4. **Nearly square.** `radius-sm` by default, `radius-md` on buttons and cards, `radius-lg` only on drawers and the cover. Nothing is a pill.
5. **Slow and unobtrusive.** Motion confirms a state change (`duration-state`) or places a panel (`duration-panel`), always `ease-out`, never more than 8px of travel, never a bounce or loop. Under `prefers-reduced-motion` every duration is 0.
6. **Plain words.** Say what happens: "Approve plan", then "Plan approved". Name things as the Bauherr sees them (ticket, stage, run, gate), never as the system is built (job, label, webhook). Sentence case everywhere except `label`.

### Name and mark

Write **Bauherr** with a capital B, in `display` or `title`, never in uppercase. The mark is the **cornerstone**: a square outline in `ink` with a solid square in `accent` at its bottom-left corner, the one stone the Bauherr lays. Use `assets/Logos/bauherr-mark.svg` at 16, 20, 24 or 32px (drawn on a 32 grid); the wordmark `assets/Logos/bauherr-wordmark.svg` only on the cover, the login page and documents. Keep clear space of one mark width around it. Never recolor the outline, never put the mark on `accent`, never rotate it.

### Writing

Singular Bauherr, plural Bauherren, never "Bauherrs". People are added, not created: "Add Bauherr", "Add Product". Sentence case. Second person for the Bauherr ("You approve the plan"), third person for agents ("The agent opened a merge request"). Buttons are verbs ("Approve plan", "Re-run failed steps"). Errors say what happened and what to do next in one sentence each. No exclamation marks, no emoji, no praise.

### Patterns

- **Decision sheet**: a table of rows, each with a number, the decision, the recommended default and a `critical` mark. The Bauherr answers once; unanswered non-critical rows take their default. The Ticket page does not render it as a table: the owner answers the rows one at a time in the owner chat.
- **Gate**: the two human gates (plan approval, merge) are the only places the product asks for a signature. A `Gate` shows only what is being approved (budget, model and evidence sit in the Ticket page's Details); the action is the ActionBar's one primary button.
- **Action bar**: one sticky bar, the first element of the Ticket page's Now pane (docked to the bottom on phones), with a sentence and at most one primary button; same place in every state. See Product patterns > One primary per page and state, Split pane.
- **Status**: every ticket, run, step and session carries a `StatusChip` using the status colors with its word; the words are the Product patterns > Activity vocabulary.
- **Run views**: the milestone timeline is the default (Product patterns > Milestone timeline); the bars view (Admin) and the Workflow graph share one node: name, type, status chip, duration in `mono`. Nodes appear with `duration-panel`; status changes with `duration-state`.
- **Chat**: every AI chat surface (owner decisions chat, intake request chat, the embed widget and any later one) is built from [assistant-ui](https://www.assistant-ui.com/elements/) (`@assistant-ui/react`), as much of it as fits: thread, message, composer, attachments, suggestions, tool UI. It is an approved dependency; no hand-built chat components. Style it with the tokens above.
- **Empty states**: one sentence in `body`, one action. No illustrations.

### Iconography

Line icons at 1.5px stroke on a 20px grid, `currentColor`, from one set (Lucide). No filled icons, no emoji, no icon without a label except in a chip where the word is beside it.

### Styling (implementation)

Pages use Tailwind v4 utilities with shadcn/ui components (Radix primitives, copied into `apps/server/src/app/(app)/components/ui`, no runtime UI package). `app.css` holds no component classes: only the font variables, the base `body` and focus rules and the navigation-progress styles. The app shell is a shadcn `Sidebar` (icon rail, Sheet on phones) | content | optional right dock, with a header (sidebar trigger, breadcrumb, New request, ⌘K command palette); see `docs/ui.md` > Shell. Tailwind's colors, radius, spacing and fonts resolve to the tokens in `tokens.css` (`tailwind.css` maps them, light and dark). Tailwind's preflight is not loaded; shadcn roots carry the `aui-root` class for the part they need. Chat UIs use assistant-ui's shadcn components.

## Colors

Light theme first; dark theme is a full second palette, not an inversion. Text is `ink` on `surface-000`, `surface-100` and `surface-200`; secondary text is `ink-muted`. The accent is text-safe on every surface in both themes; on an accent fill use `on-accent`. Selected rows and active tabs use `accent-soft` with `ink` text. The front matter holds the light values; this table is the dark theme.

| Token | Light | Dark | Use |
|---|---|---|---|
| `surface-000` | #f5f6f7 | #121417 | Page ground. Everything sits on it; no gradients. |
| `surface-100` | #ffffff | #1b1e23 | Raised panels: cards, drawers, decision sheets. Separated from `surface-000` by `hairline`, never by shadow. |
| `surface-200` | #eceef0 | #242830 | Inset fields and table header rows on `surface-100`. |
| `ink` | #171a1f | #e9ebee | Primary text on the three surfaces (≥ 12:1). |
| `ink-muted` | #5b6168 | #9aa1a9 | Secondary text, captions, timestamps on all surfaces (≥ 4.5:1). |
| `hairline` | #d9dce0 | #2b3036 | 1px borders and dividers. The only way surfaces are separated. |
| `accent` | #2457c5 | #8db1ff | The one brand hue: links, primary action, focus ring, selected state, the cornerstone. Text on `surface-000` ≥ 5:1 in both themes. |
| `accent-strong` | #1b46a3 | #a9c4ff | Hover and pressed state of an accent fill; `on-accent` stays the text color on it. |
| `on-accent` | #ffffff | #0b1a3a | Text and icons on an accent fill. |
| `accent-soft` | #e4ecfb | #1f2d4d | Selected row, active tab ground. `ink` stays the text color on it. |
| `ok` | #1a7f4b | #5bcf8a | Succeeded, approved, verified. |
| `warn` | #9a6200 | #e3b04b | Needs a person: needs_human, blocked, budget near limit. |
| `danger` | #b42318 | #f08a7f | Failed, destructive action. |
| `focus` | = `accent` | = `accent` | 2px solid focus ring, 2px offset, on every interactive element. |

Status colors: `ok` for succeeded, approved and verified; `warn` for needs_human, blocked and budget near its limit; `danger` for failed and destructive actions. Each status also shows its word or a glyph, so color never carries meaning alone.

## Typography

One family, Archivo, from Google Fonts (`family=Archivo:wght@400;500;600`), with IBM Plex Mono (`family=IBM+Plex+Mono:wght@400`) for data. Set page titles in `title` (one per page), sections in `heading`, running text in `body` at ≤ 68 characters per line, metadata in `small` with `ink-muted`, uppercase labels in `label`. Identifiers, label names, commands, costs and anything a person might copy go in `mono` with tabular numerals. Headings get `text-wrap: balance`. No italics, no light weights.

| Style | Use |
|---|---|
| `display` | Wordmark, page titles on the cover and the empty state. Rare. |
| `title` | One per page: the page title. |
| `heading` | Section and card headings. |
| `body` | Running text, decision sheet rows, ticket content. Measure ≤ 68 characters. |
| `small` | Metadata, timestamps, captions in `ink-muted`. |
| `label` | Uppercase labels above values and in chips. |
| `mono` | Identifiers, labels as text, commands, evidence output, costs in tables (tabular numerals). |

## Layout

A 4px grid: `space-1` to `space-12`. Desktop pages pad `space-8`, phones `space-4`. Related controls sit `space-2` apart, sections `space-6`, major blocks `space-12`. Content measures: forms and decision sheets 640px wide, reading 68 characters, run views full width. Tables align numbers right in `mono`. Use flex and grid with `gap`; no per-element margins. Phone breakpoint: 640px.

| Token | Value | Use |
|---|---|---|
| `space-1` | 4px | Icon to text, chip padding vertical. |
| `space-2` | 8px | Between related controls; chip padding horizontal. |
| `space-3` | 12px | Inside inputs and buttons (horizontal). |
| `space-4` | 16px | Card padding, between rows of a sheet; page gutter on phones. |
| `space-6` | 24px | Between sections; panel padding. |
| `space-8` | 32px | Page padding on desktop; above a page title. |
| `space-12` | 48px | Between major blocks on the cover and empty states. |

### Motion

Slow and unobtrusive: motion confirms a state change, never decorates. Use only these durations with `ease-out` for entrances and `ease-in` at half duration for exits. Allowed properties: opacity, transform (translate ≤ 8px), background-color, border-color, color. Disallowed: scale on enter, bounce, infinite loops, parallax, skeleton shimmer. Under `prefers-reduced-motion` every duration is 0.

| Token | Value | Use |
|---|---|---|
| `duration-state` | 320ms | Hover, focus, chip and status changes, row highlight. |
| `duration-panel` | 560ms | Drawers, sheets, step nodes appearing in the run graph. |
| `duration-page` | 800ms | Page-level transitions only: opacity 0→1 of a view after data arrives. |
| `ease-out` | cubic-bezier(0.2, 0.7, 0.2, 1) | Every entrance and state change; elements move at most 8px while fading in. |
| `ease-in` | cubic-bezier(0.6, 0, 0.8, 0.4) | Exits only, at half the entrance duration. |

A spinner is a 1.5px arc rotating once per 1.6s, in `accent`, and, besides the running-Ticket indicator, the only looping motion in the product. The indicator marks a Ticket whose Run is `running`: a dashed accent border marching at 1.6s on Graph nodes, a stripe sliding along the edge of Board cards, always with the activity word (building, reviewing, planning, deploying). Under `prefers-reduced-motion` it is a solid accent border plus the word.

## Elevation & Depth

Flat. Depth comes from two tonal layers, `surface-000` (ground) and `surface-100` (raised), separated by a 1px `hairline`; `surface-200` is inset (fields, table headers). No shadows, no gradients. The only shadow is on a drawer while it moves.

## Shapes

Nearly square. `radius-sm` (2px): chips, checkboxes, code spans, the default. `radius-md` (4px): buttons, inputs, cards. `radius-lg` (8px): drawers, modals, the cover blocks. Nothing rounder exists; nothing is a pill. In the front matter these are `rounded.sm`, `rounded.md`, `rounded.lg`.

## Components

Guidelines and previews: `docs/design/components/{Button,Cover,Gate,StatusChip}`.

- **Button**: one size, height 36px, padding `0 space-3`, `radius-md`, `body` at weight 500. Primary (`accent` fill, `on-accent` text): the single step a page asks a person for; at most one per view (a modal or drawer is its own view); none when nothing is asked. Secondary (`surface-100`, `hairline` border, `ink`): every other action. Danger (`danger` text, `hairline` border, never a fill): destructive actions. Disabled (`surface-200`, `ink-muted`): only with a visible reason nearby; never as a placeholder primary. Hover changes `background-color` over `duration-state`; focus is a 2px `focus` outline, 2px offset. Verb label in sentence case. Buttons sit `space-2` apart. No shadows, pills or icon-only buttons; animate only `background-color` and `border-color`.
- **StatusChip**: the state of a ticket, run or step as a word. `label` type (uppercase), `radius-sm`, 1px border and text in the status color on `surface-100`, padding `space-1 space-2`. queued: `ink-muted` text, `hairline` border. running: `accent` with a 1.5px arc spinner. succeeded: `ok`, "✓" before the word. failed: `danger`, "×". cancelled: `ink-muted`. needs human: `warn`, shown as "Waiting for you" or the specific word (Stuck, Session gone, Blocked). Waiting on a machine (Waiting for CI, for review, for the fast lane): `queued` colors with a clock glyph before the word. Always the word; the word list and tones are Product patterns > Activity vocabulary. No fills, pills or other loops; `accent` only for running. Not on Workflow rows (they show the ticket status vocabulary: In progress, Waiting for you, Blocked, …). Under `prefers-reduced-motion` the spinner stops.
- **Gate**: the decisive content behind a sign-off: no heading, no subtitle, no explanation. Card on `surface-100`, `hairline` border, `radius-md`, padding `space-6`; title in `heading`, meta in `small` / `ink-muted`. Goals with "✓ verified" in `ok` or "Unverified" in `warn`; evidence in a `mono` block on `surface-200`, exit 0 in `ok`. Carries no primary button. Budget and model stay in Details (Admin only). Evidence sits next to the goals it supports; never color alone for verified state.
- **ActionBar**: first element of the Ticket page's Now pane in every state, same position (the page's first element when no split is shown). Left: one sentence (`body`). Right: "About" link (scrolls to and opens the About disclosure), at most one secondary Button (forge link, Send back), at most one primary Button labelled with the step's verb. Sticky top of the pane on desktop; at ≤ 640px fixed to the bottom with a top hairline and `env(safe-area-inset-bottom)` padding. `surface-100`, `hairline` border, `radius-md`, padding `space-3` / `space-4`.
- **Cover**: the brand surface (wordmark allowed, `radius-lg` blocks); see `components/Cover/preview.html`.
- **Card, drawer, field, selected row, code span**: as in the front matter. Card and field use `radius-md`; drawer `radius-lg`.

## Do's and Don'ts

- Do give each screen one job and at most one `accent` button; do show recovery actions only when valid, as secondary buttons.
- Do pair every status color with its word or glyph.
- Do separate surfaces with `hairline`; do use `mono` for anything copyable.
- Do write sentence case, verb buttons, plain words (ticket, stage, run, gate).
- Do honor `prefers-reduced-motion`; do keep travel ≤ 8px.
- Don't use shadows (except a moving drawer), gradients, pills, filled icons, emoji or illustrations in empty states.
- Don't use `accent` for anything that is not clickable, selected or running.
- Don't use `danger` as a fill, or icon-only buttons.
- Don't introduce hues, radii above `radius-lg`, or durations outside the three tokens.
- Don't build chat from scratch; use assistant-ui.
- Don't show `runs.status` as the state; use the derived activity word. Don't use native dialogs; use a shadcn Dialog.
- Don't use italics, light weights, uppercase "Bauherr", or "Bauherrs".

## Product patterns

Rules that every page applies the same way. Each has a name (pages cite it), the rule and one line of why. These sit after the spec's sections; consumers keep unknown sections. Page designs: Agent team (F4), Run (F9), Ticket (F11).

### Activity vocabulary

Rule: an activity word says what a Run, an agent session or a Ticket is doing right now. It is derived (see Derived health), never copied from a database status. The words, chip tone and the sentence under them are defined once here; pages add context (ticket, step, time) after the sentence, never reword it. Role names are the workflow's role titles ("Software engineer", "Reviewer"), never ids.

| Word | Chip tone (StatusChip style) | Sentence | Who acts |
|---|---|---|---|
| Working | `running`: accent, arc spinner | "Working on plan step 3 of 5. Last report 2 min ago." Fallback "Working. Started 3 min ago." | nobody |
| Waiting for CI n/m | `queued` style: `ink-muted`, clock glyph, n/m in `mono` | "Waiting for CI: 2 of 3 checks done. The agent resumes when they finish." Without counts: "Waiting for CI." | nobody |
| Waiting for review | `queued` style, clock | "Review requested 3 min ago. Waiting for the reviewer." | nobody |
| Waiting for the fast lane | `queued` style, clock | "Waiting for the fast lane: #471 holds it." | nobody |
| Waiting for a session | `queued` style while sessions of the role are connected but busy; `needs-human` (`warn`) when none is connected | "No Software engineer agent is connected." / "Waiting for a Software engineer agent to pick this up." | a person connects one |
| Stuck | `needs-human` (`warn`) | "Not responding for 14 min. Session `eng-2a1` last seen 14 min ago." | an Admin releases it |
| Session gone | `needs-human` (`warn`) | "Session `eng-2a1` disconnected (<reason>) 5 min ago." | an Admin releases it |
| Not responding | `needs-human` (`warn`) | session subject only, no Run held: "Not responding. Last seen 3 min ago." | nobody |
| Waiting for you | `needs-human` (`warn`) | the gate or reason sentence | the Bauherr |
| Blocked | `needs-human` (`warn`) | "Blocked by #339." | another Ticket |
| Queued | `queued` | "Queued for the Runner." / "Queued for Build: waits for #356, which changes the same files." | nobody |
| Releasing | `running` | "Releasing to production." | nobody |
| Succeeded, Done | `succeeded` | "Finished 2 h ago in 18 min." / "Released in v1.4.2." | |
| Failed, Budget exhausted | `failed` (`danger`) / `needs-human` | first line of the error / "Stopped at the budget cap." | the Bauherr |
| Cancelled, Abandoned | `cancelled` (`ink-muted`) | "Cancelled 3 min ago." / "No session claimed this Run." | |
| Idle | plain `ink-muted` word, no chip (session subject only) | "Idle since 14:20. Last seen 40 s ago." | |
| Disconnected | `queued` style (session subject only) | "Disconnected at 14:31. The agent ended the session." / "No signal for 5 min." | |

- Tone rule: waiting on a machine is neutral (nothing is wrong), waiting on a person is `warn`, only a live Run is `accent`. Why: color then answers "do I have to do something".
- Stage verb: on surfaces that do not show the stage beside the chip (Board cards, Graph nodes, Agent team rows) the Working chip carries the stage verb (Building, Reviewing, Planning, Triaging, Testing, Deploying; fallback "Working"). Where the stage is shown beside it (Ticket page, Run page, agent view header) the word is "Working". Why: the verb is information only when the stage is missing.
- Ticket status vs activity: lists show `ticketStatus()` (In progress, Queued, Waiting for you, Waiting for CI, Blocked, Failed, Done); "Working" is never a ticket status in lists. The Ticket page header chip is the `ticketStatus()` label; the activity word appears in the Now pane status block and on Run and agent views. Where both exist for the same state the words are identical ("Waiting on CI" is renamed "Waiting for CI").
- "building", "The factory is working on this" and any "running" are never shown while the Run waits. Why: #542 said "building for 8 min" while waiting on CI.
- n/m comes from the stored check summary (CI state, #551), never from a live forge call. Without it the word is "Waiting for CI".
- Names: Ticket `#214`; Run `Run 1030` (no hash, `mono` id); GitHub `pull request #88`; GitLab `merge request !88`; session `eng-2a1` in `mono`. Why: `#` belongs to Tickets and GitHub, `!` to GitLab.

### Derived health

Rule: the state a page shows comes from one pure function over Run, session, Ticket and the stored check summary (extension of `lib/liveness.ts`; `runHealth`, `ticketLive` and the session sentence are thin wrappers). First match wins; the result is `{word, tone, sentence, action}`. Stale means no heartbeat or session `lastSeenAt` for longer than `sessionTimeoutS()` (the lease TTL if it differs). Why: `runs.status = running` is true for a Run waiting on CI, a dead session and a healthy agent; three pages must not disagree.

### One primary per page and state

Rule: a page and state has at most one `button-primary`: the single step that moves the work forward and needs a person (Approve plan, Answer 3 questions, Accept on staging, Connect an agent, Re-run Build, Open ticket, Copy prompt). With nothing to decide there is no primary; no disabled primary is shown as a placeholder, the sentence says who has the turn. A modal or drawer is its own view and may hold its own primary while open. Why: a decision page must not make the person choose which button matters.

- Recovery actions (Release lock, Disconnect, Send back, Back to backlog) are secondary buttons (`hairline` border; `danger` text where an agent session ends), shown only when valid and with the reason in the sentence beside them. Non-Admins see neither button nor placeholder; the sentence adds "An Admin can release it." Why: recovery is for exceptions; accent would invite it.
- "Release lock" is the one name for putting a Run of a gone session back in the queue (pages, menus, tests).
- Where the person has nothing to do, the bar still carries the forge link (below) if one exists. Why: "where is the work" is the commonest next click.

### Forge link button

Rule: a link to the merge request is a secondary button with an external-link glyph, labelled from the backend adapter: GitHub "Open pull request #88 on GitHub", GitLab "Open merge request !88 on GitLab"; adapter unknown "Open merge request". In lists of links the label drops "Open" ("Pull request #88 on GitHub"). Opens in a new tab, `rel="noopener noreferrer"`, visible text plus "(opens in new tab)" for screen readers; absent without a URL. CI links: "CI checks on GitHub". Never "PR" or "MR" as button text. Why: plain words, and the forge name tells where it goes.

### Time display

Rule: relative text ("2 min ago", "1 h ago", "yesterday 14:03"), exact local time in `title` and as `<time datetime>`. Durations are bare ("12 min"). Ids, costs, counts and times of day in `mono` with tabular numerals. Elapsed counters tick on the client, `aria-hidden`; the status sentence never re-announces for a tick. Why: people scan relative, copy exact.

### Cost panel

Rule: Admin only, and the data never reaches a non-Admin render (loader guard, tested on the rendered output). One panel everywhere: headline total in `mono` with a source badge, one tokens line, then collapsed splits.
- Total: "Cost" (finished) or "Cost so far" (running); source badge Gateway (`ok`) / Session-reported (neutral) / Estimated (`warn`, "Estimated from the client, not billed"); unpriced: "412k tokens, unpriced", total labelled "at least"; mismatch: "Gateway and session differ by 12 %".
- Tokens: in, out, cache read, cache write.
- Splits: by model (from usage entries, with source) and by step or stage or run (always "Estimated" when from steps); numbers right-aligned in `mono`; stacked rows under 640px.
- Scopes reuse the panel: Run, Ticket (by stage, by run), session (today, 30 days).
- Budget line "$41 of $200 / 30 days", `warn` from 80 %.
- Also Admin only: tokens, model, provider, client version, owner email, agent key, tool calls. Role settings (tier, model) stay readable by everyone, read-only for non-Admins.
Why: money data is the first thing a non-Admin must not see by accident; one panel means one place to get it right.

### Milestone timeline

Rule: a list of what the agent reported, visible to everyone: `[time mono] [glyph] [summary]` plus a link where one exists (pull request, Run). Kinds: plan step, checks, pull request opened, waiting for CI, review requested, note. Glyph (check, dot, clock, cross) is `aria-hidden`; the state is in the text. Admins additionally see duration, tokens and tool calls per row. Order follows scope: inside one Run oldest first with the newest at the bottom, no auto-scroll, updating in place; across Runs (agent view, Ticket history) newest first. A running Run with no milestones says "The agent has not reported a step yet. It started 3 min ago." never "No steps recorded." Why: the Bauherr needs "what has it done", the bars are for Admin debugging.

### List to detail

Rule: a list row opens `/entity/<id>` (a real route); the row is one link, inner links keep their own targets; trailing chevron decorative. Back (link above the title and browser Back) restores the list: filters already in the URL stay in the URL; ephemeral state (a "show disconnected" toggle, scroll offset) is kept in `sessionStorage` under `bauherr-<surface>:<workspaceId>` and restored on mount. Old anchors (`/team#ses_x`, `/tickets/<id>#steps`) redirect to the new route or tab. A deep link into a tab is `?tab=<name>`. Unknown or foreign ids show an EmptyState with the way back. Why: a detail page is shareable, Back is the person's undo.

### Split pane

Rule: a page that pairs the conversation with the state uses one split: summary header (one line: title, chip, stage, elapsed), then conversation left and the Now pane right. The pane is resizable (`role="separator"`, drag and arrow keys, 360-640px, default 50 %, width and open state stored per person in `localStorage` `bauherr-<surface>-pane:<userId>` before first paint) and collapses to an artifact card in the stream. The ActionBar is the first element of the pane (the "decision surface"); the pane never auto-switches tabs. From a container width of 960px the split shows; below it, and on phones, two tabs (Conversation, Status) replace it with the bar docked at the bottom (44px minimum, safe-area padding), above the composer on the Conversation tab; the default tab is Conversation when a question is open, else Status, and a dot marks a need. Plan, Proof and History are documents (pane tabs on desktop, bottom sheets on phones), never beside Now. With the global dock open the container drops under 960px and the tabs apply. Why: the Bauherr's two questions, what is it doing and what may I do, are answered in the pane without scrolling.

### Transitions

Rule: a state change that stops or redirects work opens a shadcn Dialog (never `window.confirm`, `wire:confirm` or another native dialog) that names the object, lists what happens ("Run 1030 is stopped. Its branch and pull request stay.") and has a verb button naming the result ("Send back to Plan"). An optional comment field appears when the next agent run reads it ("The agent reads this before it starts."); required only when no findings exist to fall back on (staging "Request changes"). The confirm button is the modal's primary; `danger` text only when a session ends or data is deleted (Disconnect, Delete workspace; deleting asks to type the name). The action is a conditional update on the current stage; on conflict the dialog says "The ticket moved while this was open. Reload to see where it is now." Result: the sentence names who and what ("Sent back to Plan by you"), an inline conversation row records it, focus returns to the trigger, the audit log gets a row. Why: the agent must not lose work silently and the owner must be able to say why.

### Live updates

Rule: a page and its poll endpoint read only the database; forge data is stored by pollers and sweeps and shown with its age ("Checked 40 s ago"). Phase 1: `AutoRefresh` on `/api/changes` (5 s, paused when the tab is hidden); client state (composer draft, open disclosures, selected role, scroll) survives the refresh. Later: a per-entity version endpoint (3 s with an active Run, 15 s otherwise), then SSE from a change feed (`ticket_events`) with `Last-Event-ID`, falling back to the poll. Announce only the status sentence (`role="status"`, `aria-live="polite"`) and only when its text changes; streamed rows are not announced. Tests spy-count forge calls on polled paths. Why: a live page that calls the forge on every poll is a rate-limit incident.

### Cross-links

Rule: every entity links to its neighbours with its own label, never to a bare id: Ticket (`/tickets/<id>`), Run (`/runs/<id>`), session (`/team/<publicId>`), merge request (forge button), Run chain ("Continues Run 1021"). A Run and a Ticket show the same session as one `SessionBadge` (avatar, name, role, link). The shell's "holding up work" strip links to the cause (Ticket, `/team?role=<role>` for a missing agent; the query only preselects the role and is removed after load). Why: the Bauherr moves between these four objects all day; each must be one click from the others.

### Fast lane and defaults taken

Rule: decisions are open only in Triage or Plan, with no fast lane and no inherited approval. Otherwise each row shows read-only, one chip, no button: "Answered: <answer>", "Default taken (fast lane): <default>", "Default taken (at approval): <default>", "Decided with #339". The open-points card title becomes "Decisions · settled"; a fast-lane Ticket in Build never mentions questions. A Ticket waiting for the lane reads "Waiting for the fast lane: #471 holds it." Commenting stays possible. Why: #542 asked three questions after Build had started.


## Generation

Product patterns are prose only and have no source in `tokens.json`; page designs cite them by name. `tokens.json` is the source; this file's front matter and the Colors, Layout and Motion tables are derived. `apps/server/scripts/design-md.ts` keeps them in sync: it builds the expected `colors`, `typography`, `spacing` and `rounded` maps from `tokens.json` (light values; `radius-*` becomes `rounded.*`, `type.groups[].styles[]` becomes `typography.*`, `family` resolves via `type.families`, quotes normalised), parses the front matter and the three tables of this file, and fails on any difference, printing `<path>: expected X, got Y`. The `components` block has no source in `tokens.json` and is edited here by hand; its `{...}` references must resolve.

```bash
pnpm --filter server design:check      # tokens.json equals this file
pnpm exec design.md lint DESIGN.md     # spec structure and references
```

Both run in the CI `check` job. After changing `tokens.json`, run `pnpm --filter server tokens` and update this file.
