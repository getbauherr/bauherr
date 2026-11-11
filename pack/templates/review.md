---
name: review
title: Review
used_by: Review Runs (the MR comment `submit_review` posts)
description: The verdict first, then only findings that have a scenario.
---
## Verdict {#verdict}
<!-- clean or changes. changes exactly when a finding that counts exists (any class but low). -->

## Findings {#findings}
<!-- One bullet each: - [high|medium] file:line what is wrong. Scenario: when ..., then .... A correctness, wrong-results or data-loss finding names its failing test (command and failure). No scenario, no finding. -->

## Open {#open}
<!-- Low findings, nits and what you could not check. They do not block. The factory adds the failing tests and the items you noted, not sent back (no failing test, constructed input, outside the round). -->

## Checked {#checked}
<!-- One line per area (correctness, over-engineering, spec-vs-plan, evidence): what you did, even without findings. -->
