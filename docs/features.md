# Features

Every capability of Bauherr on `main`, where you reach it, and how well it is reachable. Paths are in the app at `/`. Settings pages are under `/settings/`, grouped by scope: Account, Factory, Workspace, Admin.

Status: **Live** (in the UI and easy to find), **Live, hard to find** (in the UI, but behind an Admin disclosure or a conditional page), **No UI** (works, but only a job, the MCP server, the CLI or the environment shows or drives it), **In progress** (built, not on `main` yet).

Taken from a code audit of the UI and the backend. The workflow itself: [spec/workflow.md](spec/workflow.md). The pages: [ui.md](ui.md).

## Workflow

| Feature | What it does | Where | Status |
|---|---|---|---|
| Workflow graph | The stages as a graph with open Tickets, who waits on whom, medians and the human checkpoints; the home page | `/` | Live |
| Graph and Epics views | The Ticket dependency graph, and parent Tickets with their sub-tickets | `/?view=graph`, `/?view=epics` | Live |
| Stage table and ranking | Tickets per stage; drag, Alt+arrows or the row menu rank them | `/` | Live |
| Stages from the factory file | Stage kinds (triage, plan, build, review, release, container, done, agent, human), roles, outcomes and WIP in one file; [`pack/factory.yaml`](https://github.com/getbauherr/bauherr/blob/main/pack/factory.yaml) is the default | `/workflow/edit`; "Edit workflow" on `/` (Admin) | Live |
| WIP limits | A cap on open Tickets per stage | Workflow editor, "at most N tickets at a time" on a step (`/workflow/edit`, Admin) | Live |
| Overlap hold | A Build waits while another Ticket touches the same paths; paths that never hold, with suggestions | Settings › Factory › Workflow (Admin) | Live |
| Fast lane (expedite lane) | An urgent bug skips Triage and plan approval and, per Product, staging approval; see [Urgent work](#urgent-work) | Request card "Urgent"; Ticket page "Put on the fast lane"; switch in the workflow editor | Live |
| Run mode per stage | Autonomous (the Runner) or session (your Claude Code) | Settings › Factory › Models & budget (`/settings/models`) | Live |
| One factory file per Workspace | Edit visually or as YAML in a draft, review the changes in words, apply (versioned), history with restore, download; stages can be added, renamed, removed and reordered, with exactly one build, review, release chain | `/workflow/edit`; `bauherr apply -f <file> --workspace <slug> [--dry-run]`, `bauherr export`; `GET`/`PUT /api/workspaces/<slug>/factory`; `BAUHERR_FACTORY_FILE` at boot | Live |
| Custom `agent` and `human` stages | A role works the Ticket and reports an outcome, or a person picks one; outcomes route Tickets; shown in the graph, Inbox, Path and Steps, Insights | Factory file | Live |
| Conditional steps | A specialist step (security, UX, tests) runs only when the change touches a path set of the Product, has a label or is of a request type; otherwise it is skipped and the Steps list says why | Workflow editor, "When does this step run?" (`/workflow/edit`); Product › Checks & merging › Path sets; presets Standard and Careful | Live |
| Approve plan on by default | Every plan waits for the owner; remove the gate in the factory file to let plans through | Factory file | Live |

## Tickets

| Feature | What it does | Where | Status |
|---|---|---|---|
| Ticket page | Next-step bar, the decision sheet, plan, review findings, escalations, investigation and worklog | `/tickets/[id]` | Live |
| Path | The stages this Ticket visited, on the same graph | `/tickets/[id]` | Live |
| Steps timeline | Every wait and every piece of work with its executor, session, client, model, outcome and cost | `/tickets/[id]` | Live |
| Epics and sub-tickets | Split a plan into sub-tickets that inherit the approval; the parent closes when all are done | `/?view=epics`, `/tickets/[id]` | Live |
| Repair | Set the stage, clear a wait, reset counters (with the counters' values), move to the top | `/tickets/[id]` details (Admin) | Live, hard to find |
| Ticket by number | A link such as `/tickets/n/42`, used by the chat | `/tickets/n/[number]` | Live |
| Run page | Timeline and list of Steps, tool calls, evidence, goal, gateway tokens, re-run, release lock, relink MR | `/runs/[id]` (Admin) | Live, hard to find |
| Run list | All Runs of the Workspace with status | `/runs` (Admin) | Live |
| Successor-run chain | Which Run replaced a failed one: "Continues Run #x" and "Continued by Run #y" | `/runs/[id]` | Live |
| Agent repair of a dead Ticket (`return_to_build`) | An agent sends a stuck Ticket back to Build | MCP only | No UI |

## Decisions

| Feature | What it does | Where | Status |
|---|---|---|---|
| Inbox | One prepared card per decision: the ask, a recommendation, the facts and the real options; grouped by checkpoint, filtered by Product | `/inbox` | Live |
| Approve plan | Approve the plan, refused while a critical decision is open | Inbox card, Ticket page, chat | Live |
| Answer questions and decisions | The Ticket page of a Ticket that waits for answers is the conversation: chat on the left (the role as partner, who really speaks, question card, options and free text, model and cost chips, screenshots), the refined Ticket as a living artifact on the right (open-points checklist, changed sections highlighted, reviewable diff, version), "Send to planning" at its foot; the Inbox card links to it | `/tickets/[id]`, Inbox | Live |
| Accept on staging (optional), approve production | Accept a change on staging, then approve the deploy | Inbox card, Ticket page, chat | Live |
| Review round cap | Give the review one more round, or stop | Inbox card, Ticket page | Live |
| Request changes, back to Build or backlog | Send a Ticket back with a note | Ticket page, Inbox | Live |
| Notifications at checkpoints | The Inbox badge counts what needs you | Sidebar badge | Live |
| Plain-word progress for product owners | One Comment on the issue, edited in place: where it is, what happens next, a six-step path; a new Comment mentions the author only for a question, ready on staging, released, stuck. The same path on the Requests pages. Text from the editable `progress` template | The issue; `/requests`, `/requests/[id]`; switch in Settings › Workspace › General | Live |

## Chat

| Feature | What it does | Where | Status |
|---|---|---|---|
| Docked chat | Ask about the page you are on; reads the factory | Every page, `Ctrl+J` | Live |
| Stored threads | Threads per person and Workspace, with titles and a thread list | Chat dock | Live |
| Confirm cards | An action (approve, accept, stop) is shown as a card and runs only when you confirm | Chat dock | Live |
| Images | Paste or drop a screenshot into the composer | Chat dock | Live |
| Feedback | Thumbs and reasons per answer; read by Admins | Chat dock; `/settings/chat-feedback` | Live |
| Command palette | Pages, Tickets by number or words, and actions | `Ctrl+K` | Live |

## Requests

| Feature | What it does | Where | Status |
|---|---|---|---|
| New request | A conversation with the Factory assistant: the chat in the middle, the request card on the right that the assistant keeps up to date while you talk (changed fields marked, what is missing as placeholders); you file it when it reads right, and it stays as read-only history with a handoff. The same for a Product owner (model as a label, no cost) | Header "New request", `/requests/new` | Live |
| Request card | Title, type (Bug, Feature, Change, Question), product, urgency, what is wrong or wanted, "It is done when" and attachments; the assistant fills it, every field is editable; "File request" says what is missing and what happens next | Right side of the request conversation (`/requests/[id]` of a draft), read-only on the request page | Live |
| Requests workbench | Four sections with counts: Needs you, Drafts, In the factory (plain-word status and who it waits for; order your own by drag or Move up/down), Done (release note, Report a problem); filters Product and Type; a Bauherr also sees By and Mine | `/requests` | Live |
| Request page | The card, a plain-word timeline, who it waits for, the Tickets with progress, comments through the dock, a link to the conversation | `/requests/[id]` | Live |
| Product owner view | A Product owner lands on Requests and sees only their assigned Products: the four sections, a request and a reduced Ticket page (card, plain-word path and timeline, who it waits for, proof for review, release note, comments). No Runs, cost, tokens, plan, settings, Inbox, dock or question card; a Ticket of another Product is a 404. Writing, answering and accepting come later | `/requests`, `/requests/[id]`, `/tickets/[id]`; [spec/people.md](spec/people.md) | Live |
| Forge channel | A gate label or answers comment on the forge counts only from a login linked to a Bauherr or Admin, or to an assigned Product owner where the checkpoint or row asks them; anything else is ignored with one comment saying why | Profile and People (link a login), Settings › Health; [spec/people.md](spec/people.md) | Live |
| Website widget | An embeddable request form per Product with its own token | Product page, tab Widget | Live |
| Widget rate limit per token | Sessions per hour of a token (default 20) | Product page, tab Widget | Live |

### Urgent work

An urgent bug does not wait in the queue. In the request card the type Bug offers the urgency "Urgent: something is broken for users now" (not for other types, and only while Settings › Factory › Workflow has the fast lane on; when it is off the select says why). It needs the reason: what is broken, for whom, since when. An Admin who sends it puts the Ticket on the fast lane at once (`bauherr:expedite`, the same path as the button, vouched for by an `expedite` touch). Anyone else's request is filed with `bauherr:expedite-proposed`: the Inbox shows "Fast lane for <title>?" first, with the requester's reason, as soon as the Ticket exists (no Triage Run has to finish first), and an Admin decides with one click. The request row reads "Urgent · waiting for the Bauherr", then "Fast lane". On the Ticket page the button "Put on the fast lane" does the same for any open Ticket (tooltip: "Skips Triage and plan approval, jumps the queue. One at a time."). One Ticket per Workspace is on the lane at a time; a second waits. The rules of the lane itself are in [spec/workflow.md](spec/workflow.md) (Expedite lane).

## Releases

| Feature | What it does | Where | Status |
|---|---|---|---|
| Release train and merge queue | Merge direct, through the forge's queue, or as a train; preflight finds what blocks a mode | Product page, tab Checks & merging (`?tab=checks`) | Live |
| Train state | Who waits in the queue or train, what is building, who was dropped back to Build | `/releases` strip above the panel | Live |
| Release notes and shipping | Group done Tickets per Product, write the notes, publish the release; optionally as a pre-release (rc) | `/releases`; Product page, tab Releases | Live |
| Release reminder | A banner when done Tickets wait too long for a release | `/` banner; Product page, tab Releases | Live |
| Staging and production checks | Deploy checks, webhook, production gate, auto-merge, check retries | Product page, tabs Deploy, Approvals, Checks & merging | Live |
| App changelog | The release notes of Bauherr itself | `/release-notes` via the user menu | Live |

## Quality and security

| Feature | What it does | Where | Status |
|---|---|---|---|
| Review stage | A reviewer agent without memory of the change; findings with severity and scenario | `/tickets/[id]` | Live |
| Pre-review checks | Commands that must pass before a review | Product page, tab Checks & merging | Live |
| Flaky-check tracking | Retries a failing check once and records flakes | Product page; Settings › Admin › Health | Live |
| Security scan | An hourly tick starts a scan Run per Product that has one enabled; the last scan links its Run and the finding Tickets | Product page, tab Security scan | Live |
| Docs check | An Admin starts a read-only Run that compares the docs with the Tickets merged since the last check; findings become one docs Ticket in Plan, updated in place while it is open | Product page, tab Docs | Live |
| Evidence | Commands, exit codes and test results attached to a Run and its merge request | `/runs/[id]`, merge request | Live |
| Review artifacts | Proof a person can judge (screenshots with before/after, recordings, preview links, terminal sessions, samples, reports) per acceptance criterion; a Product's rules require it before review, a waiver line is shown as "No proof" | Product page, tab Checks & merging (Proof for review); proof table on the Ticket page, Inbox cards and chat cards for accept and approve | Live |
| Skill proposals | The factory proposes a skill from a solved Ticket; an Admin approves or rejects it; skipped and rejected ones show their reason and results | Inbox card (Admin); `/knowledge` (Admin, needs a Knowledge repo) | Live |
| Audit | Human touches and tool calls (argument names and hash, never payloads) | `/settings/audit` (Admin) | Live |

## Agent team and sessions

| Feature | What it does | Where | Status |
|---|---|---|---|
| Your own Claude Code session | `claim_run`, `claim_next`, `heartbeat` and the other tools over `/mcp`; an agent key per laptop | Settings › Account › API keys (`/settings/api-key`); [session-mode.md](session-mode.md) | Live |
| Agent keys and personal key | Create, list and revoke keys | Settings › Account › API keys | Live |
| Profile | Your email, role and Workspaces, your linked forge login (editable, a Product owner's too), and the theme | Settings › Account › Profile (`/settings/profile`) | Live |
| Agent roles | Orchestrator, engineer, reviewer, security, UX and test: profile, skills, model or tier, agent limit, declared in the factory file | Factory file; [session-mode.md](session-mode.md#connect-as-a-role) | Live |
| Connect as a role | `connect {role}`, then `next_work` pulls the Runs of the role's stages; the orchestrator also gets stuck Tickets | MCP; [session-mode.md](session-mode.md#connect-as-a-role) | Live |
| Presence | Sessions show as Working, Idle or Offline with their active time; Ticket status and Steps name who works ("<session> (<role>)", Runner, CI); the chat answers who is working | Ticket page, chat | Live |
| Agent team page | Pick a role (avatar, profile, skills), set its model and agent limit (saved to the factory file), connect a session in three steps, live session list (Working, Idle, Offline, ticket, active time); agents on the Workflow graph; who is working (sidebar dot, header pill) on every page; team time in Insights | `/team`, `/`, `/insights` | Live |
| People and roles | Admin or Bauherr per person, Workspaces, forge login (the column shows who has none), SSO subject, unlock, remove | Settings › Workspace › People (`/settings/bauherren`) | Live |
| Workspaces | Isolation boundary with its own Connections, budget and keys; Admins always have the menu with settings and New Workspace | Settings › Workspace › General (`/settings/workspace`), workspace menu | Live |
| OIDC sign-in | SSO with role and Workspace mapping | `/login`; [auth.md](auth.md) | Live |

## Knowledge

| Feature | What it does | Where | Status |
|---|---|---|---|
| Knowledge repo | Search and read the documents of a connected repository | `/knowledge` (only with a Knowledge repo) | Live |
| Write-backs | Agents propose changes to the repository as merge requests | `/knowledge` (Admin) | Live |
| Knowledge repo setting | The Connection and repository of the Knowledge repo | Settings › Workspace › Knowledge (`/settings/knowledge`) | Live |
| Knowledge editor | Edit a document in the UI | "Edit" on a document of `/knowledge` (Admin), `/knowledge/edit` | Live |
| Pack | Skills, rules, hooks and templates added to every Run, never committed | [`pack/`](https://github.com/getbauherr/bauherr/blob/main/pack/README.md) | Live |
| Editable text templates | The comment and request texts, with a live preview | `/settings/templates` | Live |

## Models and cost

| Feature | What it does | Where | Status |
|---|---|---|---|
| AI gateway with budgets | Every request goes through the bundled gateway with the Workspace's own key and a rolling 30-day budget | Settings › Factory › Models & budget, AI usage (`/settings/models`, `/settings/usage`) | Live |
| Model tiers | `cheap`, `standard`, `strong` per Workspace mapped to models | Settings › Factory › Models & budget | Live |
| Cost per Product | Spend of the last 30 days; per Ticket and stage see Tokens and cost | `/settings/usage` | Live |
| Connections | Forge and model provider credentials, verified | `/settings/connections` (Admin) | Live |
| Gateway key rotation | Rotate the Workspace's consumer key | Settings › Workspace › General | Live |
| Insights | Lead time, cycle time, time per stage with the bottleneck, throughput per week | `/insights` | Live |
| Measure session cost | Your own coding sessions go through the gateway with one pasted block per tool (Claude Code, Codex, Gemini CLI, Copilot, opencode, Aider, Cline); each call is measured per session, with the gateway status and a notice on Insights when session cost is not measured | `/settings/usage#measure`, `/team`, [gateway.md](gateway.md) | Live |
| Prices and models | The model price catalog and the model lists refresh daily from the catalog the gateway project publishes; guards keep the previous prices on a bad answer; status and Update now | `/settings/models#prices`, [gateway.md](gateway.md#prices-and-models-update-themselves) | Live |
| Tokens and cost | Tokens and cost per model, role, session, stage and Ticket, cost per finished Ticket, source coverage; sessions are measured by the gateway, else report usage by tool argument or a Claude Code hook; cost per session and role on the Team page; `cost_summary` in the chat | `/insights#cost`, `/team`, [cost.md](cost.md) | Live |
| Health | Jobs, oldest queued, dead Tickets, last poll, expedite lead time, gateway budget, flaky checks | Settings › Admin › Health (`/settings/health`) | Live |

## Administration

| Feature | What it does | Where | Status |
|---|---|---|---|
| Products and repositories | Repository, Ticket source, staging, approvals, production, merging, releases, scan, docs, widget, in tabs | `/settings/products` (`?tab=`) | Live |
| Setup wizard | Five steps: connect your forge, pick a repository as Product, pick a team preset (Solo, Standard, Careful), connect a session or the Runner, send a first request (open issue or new) | `/setup`; an Admin of a Workspace without a Product is sent there from `/`; sidebar chip "Setup n/5"; palette "Set up" / "Setup checklist" | Live |
| Settings by scope | Account, Factory, Workspace and Admin groups; Product page in tabs; a place in the UI for every feature | `/settings/*` | Live |
| Background jobs | 19 jobs: polling, Runs, merging, releases, scans, pruning | Counts on Health | No UI |
| Health endpoint | Unauthenticated JSON of stale jobs | `/api/health` | No UI |
| Payload admin | Developer escape hatch | `/admin` with `BAUHERR_ENABLE_ADMIN=1` | No UI |

## CLI and API

| Feature | What it does | Where | Status |
|---|---|---|---|
| `bauherr` CLI | `init`, `up`, `down`, `status`, `seed`, `eval`, `apply`, `export`, `pack lint` | CLI only: `npx bauherr`; [`packages/cli`](https://github.com/getbauherr/bauherr/tree/main/packages/cli) | No UI |
| Pack lint | Checks the pack: size caps, cited paths, glossary terms, tiers vs the spec, no stack names in core, hook citations; red in CI on a finding | CI job `cli`; `bauherr pack lint` | No UI |
| Skill eval | Replays a skill against cases and scores it | CLI only: `bauherr eval` | No UI |
| MCP server | Frontier, claim, finish, worklog, evidence, knowledge; human gates refused for agent keys | MCP only: `/mcp` | No UI |
| REST API | Payload's API; chat and intake endpoints | API only: `/api`, [chat.md](chat.md), [intake-embed.md](intake-embed.md) | No UI |
| Runner | Runs one stage with the Claude Agent SDK in a fresh clone | job: [`packages/runner`](https://github.com/getbauherr/bauherr/tree/main/packages/runner) | No UI |
| Environment flags | `BAUHERR_DEFAULT_MODE`, `BAUHERR_ENABLE_ADMIN`, `OIDC_*`, `MEDIA_*`, `GATEWAY_URL`, `GATEWAY_PUBLIC_URL`, `GATEWAY_UI_URL`, `BAUHERR_PRICES_REFRESH`, `BAUHERR_PRICES_URL`, retention | env only: Environment | No UI |

## Known gaps

- No UI, by design: `return_to_build` (agent repair), the connection slug, job-level status; see "Not in the UI" in [ui.md](ui.md).
- Written but never shown: `oidcSynced`, `productionApprovedSha`.
- Security scan findings have no page of their own: the last scan links its Run and the finding Tickets. The same holds for the docs check.
