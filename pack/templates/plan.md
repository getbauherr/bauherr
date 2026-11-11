---
name: plan
title: Plan
used_by: Plan Runs (session and autonomous); the plan checkpoint's card is made from its TL;DR
description: The plan the Bauherr decides on: a TL;DR to decide in half a minute, then the work.
---
## TL;DR {#tldr}
<!-- The Bauherr decides from this block alone. Plain words, no factory jargon. Exactly these labelled lines; Options is optional. -->
Decision: <one sentence: what the Bauherr approves>
Recommendation: <what you recommend and the one reason>
Why:
- <1 to 3 short facts: what changes, what you checked, what is at risk>
Risk: <one line, or "none">
Options:
- <an alternative the Bauherr could pick>

## Goal {#goal}
<!-- What works after this change, as checkable bullets. Covers every acceptance criterion. Keep the heading "Goal". -->

## Steps {#steps}
<!-- Numbered steps, each one commit-sized. Keep the heading "Steps". -->

## Files {#files}
<!-- Every path the plan changes, one path glob per line, nothing else. A Build waits while an earlier ticket changes the same paths. Keep the heading "Files". -->

## Decisions {#decisions}
<!-- Only questions the Bauherr must answer: - **D1** Question? Alternatives: ...; .... Default: .... Why: .... critical: true|false. Keep the heading "Decisions". -->

## Sub-tickets {#sub-tickets}
<!-- Only for work too large for one change: - **Title** — one-line body; an indented "after: <title>" line orders it. Keep the heading "Sub-tickets". -->
