---
name: progress
title: Progress
used_by: The progress Comment the factory keeps on the issue, and the progress shown on Requests
description: Where a request stands, in plain words for the person who filed it.
---
<!-- One section per state. The first line is the headline, a line starting "Next:" is the next step, other lines are the detail. A line with a {{placeholder}} that has no value is left out. Placeholders: {{stage_title}} {{staging_url}} {{waiting}} {{release_note}} {{reason}} {{blockers}} {{children}}. -->
## Received {#received}
Received. The factory is reading it.
Next: You hear from us if anything is unclear.

## Questions for you {#question}
Questions for you.
The factory needs a few answers before it can plan this.
Next: Answer the questions in the comment on this issue.

## Being planned {#planning}
Being planned.
The factory is working out the steps.

## Plan waiting for approval {#approval}
The plan is waiting for approval.
The Bauherr reads the plan and approves it before building starts.

## Being built {#building}
Being built.

## Being reviewed {#reviewing}
Being reviewed.
The change is built and is being checked.

## Custom agent stage {#agent}
{{stage_title}} in progress.

## Custom decision stage {#human}
Waiting for a decision: {{stage_title}}.

## Ready on staging {#staging}
Ready to try on staging.
Try it here: {{staging_url}}
Next: Tell the Bauherr whether it works. They accept it or send it back for changes.

## Waiting {#waiting}
{{waiting}}

## Released {#released}
Released.
{{release_note}}

## Stuck {#stuck}
Stuck: {{reason}}.
A maintainer has been asked to look at it.

## Closed without a change {#closed}
Closed without a change.
{{reason}}

## Split {#split}
Split into smaller requests.
{{children}}

## Blocked {#blocked}
Waiting for {{blockers}} to finish first.
