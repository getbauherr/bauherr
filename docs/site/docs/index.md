---
title: Bauherr
hide:
  - navigation
  - toc
---

<section class="bh-hero" markdown>

# An open-source AI software factory

**Agents take your tickets through gated stages. You approve the plan, not every keystroke.**

Bauherr connects to the issue tracker and repositories you already use. Agents plan, build, review and release; you decide at the checkpoints. Self-hosted, with an audit trail and a budget per Workspace.

[Get started](#install){ .md-button .md-button--primary }
[Read the docs](features.md){ .md-button }
[Source on GitHub](https://github.com/getbauherr/bauherr){ .md-button }

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/screenshot-workflow-dark.png">
  <img class="bh-shot bh-shot--hero" src="screenshots/screenshot-workflow.png" alt="The Workflow view: the stages as a graph with open Tickets, who waits on whom and the human checkpoints">
</picture>

Pre-release: the data model and the workflow can still change between versions. Back up the database before you upgrade.

</section>

<section class="bh-section" markdown>

## What it does

*Bauherr* is German for the person who commissions a building and signs off on the work, not the one who lays the bricks. That is the role you get.

<div class="bh-cards" markdown>

<div markdown>
### You decide, the factory works
Tickets move through stages by themselves. You are asked at a few checkpoints, and the Inbox shows each one as a prepared card: the ask, a recommendation, the facts and the real options.
</div>

<div markdown>
### Your tickets stay yours
They live in GitHub. Bauherr keeps a pointer and what it derives, and writes the stage as a label.
</div>

<div markdown>
### Everything is on the record
Runs, steps, tool calls, human touches and cost are stored. Every step of a Ticket shows who or what did it, with which model, for how much.
</div>

<div markdown>
### Cost is capped
Each Workspace has its own provider key and a rolling 30-day budget in a bundled gateway. An exhausted budget ends the Run.
</div>

<div markdown>
### Use your own session
A stage can wait for your Claude Code to claim it, so you work in your own worktree with your own credentials. See [Session mode](session-mode.md).
</div>

<div markdown>
### Small to run
Docker and Postgres 17. No Redis, no external service.
</div>

</div>

</section>

<section class="bh-section" markdown>

## How it works

A Ticket moves through the stages Triage, Plan, Build, Review, Staging and Done. Each stage has named outcomes: a failed review sends the Ticket back to Build, and a split plan turns it into a parent with sub-tickets.

| Stage | What happens |
|---|---|
| Triage | An agent checks the Ticket and asks what is unclear. You answer in a short chat with recommended defaults. |
| Plan | An agent writes the plan and a decision sheet. |
| Build | An agent implements the plan on a branch and opens a merge request with evidence: commands, exit codes, test results. |
| Review | A reviewer agent without memory of the change reads the diff. The factory merges when it is clean. |
| Staging | The Product's own CI deploys. |
| Done | The Ticket is closed on merge. Release notes group done Tickets per release. |

You are asked at **Answer questions**, **Approve plan** and **Approve production** by default. **Accept on staging** is an optional gate. The full workflow: [Workflow spec](spec/workflow.md).

</section>

<section class="bh-feature" markdown>
<div markdown>

## Inbox: each decision as a card

One prepared card per decision, grouped by checkpoint: the ask, a recommendation, the facts and the real options. Approve a plan, accept on staging, approve production, or give a review one more round. More in [Features](features.md#decisions).

</div>
<img class="bh-shot" src="screenshots/screenshot-inbox.png" alt="Inbox with decision cards: approve the plan for a Ticket, with a recommendation and three facts">
</section>

<section class="bh-feature bh-feature--flip" markdown>
<div markdown>

## Ticket: the path it took

The stages a Ticket visited on the same graph, and a Steps timeline with every wait and every piece of work, with its executor, model, outcome and cost. More in [Features](features.md#tickets).

</div>
<img class="bh-shot" src="screenshots/screenshot-ticket.png" alt="Ticket page with the Path through the stages and the Steps timeline">
</section>

<section class="bh-feature" markdown>
<div markdown>

## Insights: where time goes

Lead time, cycle time and time per stage with the bottleneck, and [tokens and cost](cost.md) per model, role, session, stage and Ticket.

</div>
<img class="bh-shot" src="screenshots/screenshot-insights.png" alt="Insights with lead time, cycle time and time per stage with the bottleneck">
</section>

<section class="bh-feature bh-feature--flip" markdown>
<div markdown>

## Chat: ask, then confirm

A chat on every page that knows the page, with stored threads. An action such as approve, accept or stop is shown as a card and runs only when you confirm it. See [Chat](chat.md).

</div>
<img class="bh-shot" src="screenshots/screenshot-chat.png" alt="Docked chat with an answer and a confirm card for approving a plan">
</section>

<section class="bh-feature" markdown>
<div markdown>

## Templates: edit what the factory writes

The texts the factory writes are editable templates, with a live preview. Settings are grouped by scope in the [UI](ui.md).

</div>
<img class="bh-shot" src="screenshots/screenshot-templates.png" alt="Template editor with the text on the left and a live preview on the right">
</section>

<section class="bh-feature bh-feature--flip" markdown>
<div markdown>

## Agent team: who is working

An Agent team page to pick a role and see its profile, skills and model, and which sessions are working on what and which are idle. See [Session mode](session-mode.md).

</div>
<img class="bh-shot" src="screenshots/screenshot-team.png" alt="Agent team page: the roster with the Reviewer selected, one session working on a Ticket and one idle">
</section>

<section class="bh-section" id="install" markdown>

## Install

Requires Docker with Compose and Node 22.14+. No clone, no build:

```bash
npx bauherr init
```

It asks for the install directory, port and public URL (`--yes` takes the defaults), writes `compose.yaml` and a mode-600 `.env` with generated secrets, starts the stack and opens the UI. Details: [Quick start in the README](https://github.com/getbauherr/bauherr#quick-start).

[Open an issue](https://github.com/getbauherr/bauherr/issues/new){ .md-button .md-button--primary }
[Source on GitHub](https://github.com/getbauherr/bauherr){ .md-button }

</section>
