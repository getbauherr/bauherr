---
title: Bauherr
hide:
  - navigation
  - toc
---

<section class="bh-hero" markdown>

# An open-source AI software factory

**Agents take your tickets from issue to verified pull request. You decide on three cards.**

Bauherr connects to the forge you already use. Agents write a Brief, build, review and verify. You approve the Brief, accept the Result and answer Questions. Self-hosted, with an audit trail and a budget per Workspace.

[Get started](#install){ .md-button .md-button--primary }
[Read the guide](ui.md){ .md-button }
[Source on GitHub](https://github.com/getbauherr/bauherr){ .md-button }

<img class="bh-shot bh-shot--hero bh-light" src="screenshots/screenshot-factory.png" alt="The Factory view: tickets by stage from Intake to Done, filters, a strip of what holds up work and send-back loops">
<img class="bh-shot bh-shot--hero bh-dark" src="screenshots/screenshot-factory-dark.png" alt="The Factory view: tickets by stage from Intake to Done, filters, a strip of what holds up work and send-back loops (dark theme)">

Pre-release: the data model can still change between versions. Back up the database before you upgrade.

</section>

<section class="bh-section" markdown>

## What it does

*Bauherr* is German for the person who commissions a building and signs off on the work, not the one who lays the bricks. That is the role you get.

<div class="bh-cards" markdown>

<div markdown>
### You decide, the factory works
Tickets move by themselves. You are asked on three cards: Brief, Result and Question. Each shows the ask, a recommendation and the real options, and takes a free comment.
</div>

<div markdown>
### Pictures before prose
A Brief for a visible change carries mockups. A Result shows before and after per screen. Plans and results are drawn, not described.
</div>

<div markdown>
### Low risk goes through
A rule in code approves a Brief with no open decision, no one-way door, no risk area and no visible change. Everything else waits for you.
</div>

<div markdown>
### Nobody checks their own work
A review run and a verifier run check every patch. Neither built it. A verdict needs proof per criterion, and the server refuses one without.
</div>

<div markdown>
### Your tickets stay in your forge
GitHub or GitLab is mirrored into the factory database. The factory database is the truth for factory state. One module writes to the forge.
</div>

<div markdown>
### Small to run
Docker and Postgres 17. Agents run as your own Claude Code sessions over MCP, or in the headless Runner.
</div>

</div>

</section>

<section class="bh-section" markdown>

## How it works

A ticket moves through six fixed stages. Three roles work them: builder, reviewer and verifier.

| Stage | What happens |
|---|---|
| Intake | Code selects the issue. A model checks it and asks the reporter one numbered round of questions when something is missing. |
| Brief | The builder writes the goal, up to seven criteria a user can observe, the risk and the plan. You approve it, or the risk rule does. |
| Build | The builder implements the Brief and opens a pull request. |
| Verify | A reviewer reads the diff. Then a verifier checks each criterion against proof. |
| Ship | The factory merges. You accept the Result. Production approval is a switch per Product. |
| Done | The ticket is closed. |

After three failed verify rounds, two failed runs or a silent reporter, the ticket stops on a Question card. **Back to Brief** returns a ticket from Build or Verify with a note.

</section>

<section class="bh-feature" markdown>
<div markdown>

## Factory view: the whole line at a glance

Every ticket as a card under its stage, with who has the turn and how long it has waited. Filter by what waits on you, what agents work on, what is stuck and what waits on others. A strip above the board names what holds up work, for example a role with no connected agent.

</div>
<img class="bh-shot bh-light" src="screenshots/screenshot-factory.png" alt="The Factory view with filters, the holding strip and tickets under six stages">
<img class="bh-shot bh-dark" src="screenshots/screenshot-factory-dark.png" alt="The Factory view with filters, the holding strip and tickets under six stages (dark theme)">
</section>

<section class="bh-feature bh-feature--flip" markdown>
<div markdown>

## Inbox: who has to act

The same tickets as a list. Waiting on you comes first, then agents working, then waiting on others.

</div>
<img class="bh-shot bh-light" src="screenshots/screenshot-inbox.png" alt="Inbox grouped into waiting on you and agents working">
<img class="bh-shot bh-dark" src="screenshots/screenshot-inbox-dark.png" alt="Inbox grouped into waiting on you and agents working (dark theme)">
</section>

<section class="bh-feature" markdown>
<div markdown>

## Ticket: one card at a time

The ticket page shows the card that waits for you, with the criteria, the risk and why you are asked. Tabs hold the Brief, the Result and the activity. Back to Brief is one click.

</div>
<img class="bh-shot bh-light" src="screenshots/screenshot-ticket.png" alt="A ticket with a Brief card: the goal, a decision with a recommended option and the Approve Brief button">
<img class="bh-shot bh-dark" src="screenshots/screenshot-ticket-dark.png" alt="A ticket with a Brief card: the goal, a decision with a recommended option and the Approve Brief button (dark theme)">
</section>

<section class="bh-feature bh-feature--flip" markdown>
<div markdown>

## Insights: time and cost

Time per stage, how often tickets were sent back, and tokens and cost per ticket, model and role.

</div>
<img class="bh-shot bh-light" src="screenshots/screenshot-insights.png" alt="Insights with time per stage and cost per stage">
<img class="bh-shot bh-dark" src="screenshots/screenshot-insights-dark.png" alt="Insights with time per stage and cost per stage (dark theme)">
</section>

<section class="bh-feature" markdown>
<div markdown>

## Repo readiness: fix the gaps first

Each Product shows what its repository lacks: required checks, risk areas, an `AGENTS.md`, issue forms, connected sessions. Most gaps offer a fix.

</div>
<img class="bh-shot bh-light" src="screenshots/screenshot-readiness.png" alt="Product page with the readiness list: gaps, unknowns and one passed check">
<img class="bh-shot bh-dark" src="screenshots/screenshot-readiness-dark.png" alt="Product page with the readiness list: gaps, unknowns and one passed check (dark theme)">
</section>

<section class="bh-section" markdown>

## Memory: what the factory knows

Three documents hold what agents are told: factory, workspace and product. Parts of them go to the runs of Brief, Build, Review and Verify. Only you or a Retro change them. A Retro is a conversation about a range of tickets that proposes changes; you apply or drop each one.

## Bring a project you already have

1. **Connect** the repositories.
2. **Import** all issues and open pull requests. Nothing is written to the forge.
3. **First look**: Intake and a repository check run on every open issue.
4. **Switch on**: briefs for old issues come one at a time, at most five waiting on you.

An open pull request that closes an issue and comes from a trusted author enters at Verify. The factory never pushes to it.

## Planned

Ticket relations, requests from Product owners and releases are planned, not built.

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
