# Parked parts

These parts were cut when the engine was replaced by the lean core on 2026-11-19. Their code is at the git tag `legacy-final`. Each page says what the part did, which requirement it met, where its code is, why it was cut, and what a module on the new core would need.

A part returns as a module: a folder that imports the core and never another module.

## Planned as later modules

| Page | Part |
|---|---|
| [product-owner-intake](product-owner-intake.md) | Product-owner accounts, Requests, intake chat and widget |
| [request-widget](request-widget.md) | Request widget for a Product's own site, stakeholder access |
| [releases](releases.md) | Release notes, changelog, publishing, deploy watching |
| [editable-workflow](editable-workflow.md) | Factory file, workflow editor, custom stages, Jobs, WIP limits |
| [insights-cost-trust](insights-cost-trust.md) | Insights, Trust grade, cost analytics |

## Parked without a date

| Page | Part |
|---|---|
| [merge-train-and-overlap](merge-train-and-overlap.md) | Merge modes, merge train, overlap holds |
| [fast-lane-and-preemption](fast-lane-and-preemption.md) | Fast lane and preemption |
| [epics-and-slices](epics-and-slices.md) | Epics, slices, the Split stage |
| [investigation-and-escalation](investigation-and-escalation.md) | Escalation ladder, investigation, liveness sweep |
| [review-pipeline](review-pipeline.md) | Review as find, verify, conclude with nine roles |
| [docked-chat](docked-chat.md) | Docked chat assistant and owner chat |
| [agent-team-and-presence](agent-team-and-presence.md) | Agent team page, sessions, presence |
| [knowledge-editor](knowledge-editor.md) | Knowledge editor, PR watcher, layered store |
| [setup-wizard-and-templates](setup-wizard-and-templates.md) | Setup wizard, presets, editable templates |
| [skill-distillation-and-eval](skill-distillation-and-eval.md) | Skill proposals from tickets, eval runner |
| [scheduled-scans-and-ax](scheduled-scans-and-ax.md) | Security scan, docs check, AX role |
| [semantic-router](semantic-router.md) | Model router and the `auto` tier |
| [observability-and-gateway-ui](observability-and-gateway-ui.md) | Prometheus, Jaeger, gateway UI |
| [planka-adapter](planka-adapter.md) | Planka ticket source |

## Replaced, kept for reference

| Page | Part | Replaced by |
|---|---|---|
| [workflow-page](workflow-page.md) | Workflow home page | Factory view |
| [legacy-artifacts](legacy-artifacts.md) | Per-stage documents | Ticket record and three cards |
| [mcp-tools-legacy](mcp-tools-legacy.md) | 38 MCP tools | Nine tools |
| [feature-map](feature-map.md) | Feature map with 118 features | `docs/references.md` and the Learn module |
