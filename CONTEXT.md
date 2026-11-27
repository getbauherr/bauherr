# Bauherr

An AI software factory. Agents take a ticket through Intake, Brief, Build, Verify and Ship. The Bauherr decides on three cards.

## Language

### Tenancy

**Workspace**:
The isolation boundary for one client or organisation. Everything else belongs to exactly one Workspace.
_Avoid_: Tenant, organisation, account

**Product**:
A deliverable software product inside a Workspace, with its own repositories and settings. It is `observing` until the Bauherr switches it on, then `active`. Its executor is `session` or `runner`.
_Avoid_: Project (a repository in GitLab), app

### People

**Bauherr** (plural Bauherren):
A member of a Workspace who owns its Products and decides on the cards. Sets risk and spend, owns production.
_Avoid_: Operator, owner (bare; say Bauherr or Product owner)

**Admin**:
A Bauherr who runs the Bauherr instance. Creates Workspaces, is a member of all of them, changes the factory Memory document.
_Avoid_: Superadmin, root

**Product owner**:
An account with a login that ranks below the Bauherr. It sees a reduced shell: Requests of its own Products. See `docs/spec/people.md`.
_Avoid_: Project owner

### External systems

**Connection**:
A credentialed link from a Workspace to an external system: a forge or an LLM provider.
_Avoid_: Integration, credential

**Forge**:
GitHub or GitLab. Issues, pull requests, comments and checks live there.

**Mirror**:
The factory's copy of a forge's issues, comments, pull requests, reviews and checks. It is kept by polling; a webhook only triggers a re-read. The factory database is the truth for factory state.
_Avoid_: Cache

**Forge writer**:
The one module, `core/forge/writer.ts`, that writes to the forge. A lint rule keeps every other module out.

**Gateway**:
The LLM gateway inside every instance. Every agent request passes through it with the Workspace's own provider credential and budget.
_Avoid_: Proxy

**Tier**:
One of cheap, standard, strong. A role asks for a tier in `pack/pack.yaml`; the Workspace maps it to a model.
_Avoid_: Model (in config)

**Repository**:
One code repository reached through a Connection. It belongs to exactly one Product.
_Avoid_: Repo (in prose)

### Lifecycle

**Stage**:
One of Intake, Brief, Build, Verify, Ship, Done. The set is fixed.
_Avoid_: Column

**Ticket**:
One issue of a Product, with its record. It enters Intake by a selection rule in code. Bauherr never owns the issue; it mirrors it.
_Avoid_: Task, story

**Record**:
The one versioned JSON document per ticket: goal, type, source, criteria, out of scope, risk, decisions, plan, findings, handoff, result. Every card, page and agent input is a view of it.

**Brief**:
What Build works from: a goal, up to seven criteria a user can observe, risk, decisions and plan steps. A change a user can see carries mockups. Also the name of the first card.

**Card**:
What the factory asks a Bauherr. There are three: Brief, Result and Question. Each offers options and free comments. The factory acts on the chosen option, never on the text.
_Avoid_: Checkpoint

**Result**:
What Verify found, shown as pictures first: before and after per mockup screen, proof per criterion and what was not verified. The Bauherr accepts it.

**Question**:
A card for what the factory cannot settle: a disputed issue, a silent reporter, failed runs, used-up verify rounds, a stalled deploy, production approval.

**Risk rule**:
The code that decides whether a Brief goes to the Bauherr. It does on an open decision, a one-way door, a risk area, a visible change, an old backlog issue, an outside request for a feature or change, a readiness fix or a send-back. Every other Brief is approved by the rule.
_Avoid_: Brief gate

**Back to Brief**:
The option that returns a ticket in Build or Verify to Brief with a note.

**Risk area**:
A named set of path globs a Product declares, such as `security`. A change that touches one needs the Bauherr's Brief approval.

**Criterion**:
One observable statement of a Brief. It names how to verify it (`test`, `command`, `screenshot`, `manual`) and has a status.

**Proof**:
Evidence for a criterion. Exit-code proof comes only from CI checks on the pull request head or from the Runner.

**Verification gate**:
The server check that refuses a verdict without proof per criterion, from the author of the patch, for a stale patch or for a moved head.

**Caps**:
Three verify rounds, two reporter rounds, two failed runs. Then a Question card.

### Agents

**Role**:
One of builder, reviewer, verifier. Verify is a review run, then a verifier run. Neither built the patch.
_Avoid_: Agent (it names a client or a model)

**Executor**:
What runs a role: a Claude Code session over MCP, or the headless Runner. A Product picks one.

**Agent session**:
A connected Claude Code that `connect`s as a role and pulls runs with `next_work`. It shows as working, idle or offline.
_Avoid_: Worker

**Runner**:
The headless executor in `packages/runner`: a shallow clone, the Claude Agent SDK, a credential proxy and hooks.

**Run**:
One execution of one role on one ticket. Its result must match a schema before it counts.
_Avoid_: Job (a background task)

**Pack**:
`pack/`: the roles, rules and skills handed to a run. A skill is an instruction package in the Agent Skills format.

**Context pack**:
What code assembles for one run: the stage skill, the repository's `AGENTS.md`, the record, matching memories and three similar past tickets.

### Memory

**Memory**:
Three markdown documents: factory, workspace and product. Parts of them go to the runs of Brief, Build, Review and Verify. Only the owner or a Retro changes them. The old single memories are no longer handed out.
_Avoid_: Statement (on screen), lesson, Learn

**Retro**:
A conversation the owner starts for one Product over a range of tickets. It proposes document changes or new tickets; the owner applies or drops each one.
_Avoid_: Retrospective

### Onboarding

**Import**:
Step two of connecting a project: all issues with comments and all open pull requests are mirrored. Nothing is written to the forge.

**First look**:
Intake and a repository check run on every open issue while the Product is `observing`. The forge writer refuses.

**Switch on**:
The Bauherr makes the Product `active`. Briefs for old issues come one at a time, at most five waiting on the Bauherr.

**Adopted pull request**:
An open pull request that closes an issue and comes from a trusted author. It enters at Verify. The factory never pushes to it.

**Repository readiness**:
The checks of a Product's repository: required checks, CI runs, risk areas, `AGENTS.md`, issue forms, connected sessions, branch protection. A gap offers a fix.

### Views

**Factory view**:
The home page: the stages as a board with counts, median time, who works, send-back loops and a hold strip. Dragging reorders within a stage.

**Inbox**:
The same tickets as a list by who has to act.

**Hold**:
A cause that stops several tickets, shown above the board: no agent for a role, a Product still observing, a failed sync, checks that never started.

**Someday**:
The label `bauherr:someday` parks an issue: no run, no card.

**Insights**:
Time per stage, how often tickets were sent back, and tokens and cost per ticket, model and role.

### Planned, not built

Ticket relations (#939 to #943), requests from Product owners (#840 to #848) and releases (#922 to #929).
