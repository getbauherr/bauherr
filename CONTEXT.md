# Bauherr

An AI software factory: agents take tickets through gated stages for products their Bauherren have connected, with human approval at the gates.

## Language

### Tenancy

**Workspace**:
The isolation boundary for one client or organisation; everything else belongs to exactly one Workspace.
_Avoid_: Tenant, organisation, account

**Product**:
A deliverable software product inside a Workspace, with its own repositories, ticket source and workflow; intake always targets a Product.
_Avoid_: Project (a repository in GitLab, a board container in Planka, a board in GitHub), app

### People

**Bauherr** (plural Bauherren):
A person who is a member of a Workspace and owns all its Products: configures the factory for them and approves work at gates; owns the factory, risk, spend and production. Can decide every Checkpoint, also one addressed to the Product owner (recorded as `bauherr`).
_Avoid_: Operator, project owner, owner (bare; say Bauherr, Product owner or Product user)

**Open point**:
One question of a Ticket's decision sheet, or one the refinement conversation added, with its reason, options and recommended default. It is `open`, `answered` or `dropped` (no longer needed); the owner settles them in the refinement conversation and sends the Ticket on when none is open. Same rows as the Decisions of a plan; "critical" ones hold the plan.
_Avoid_: Question card, decision row (say Open point; Decision is the recorded answer)

**Product owner**:
The person accountable for a Product's requirements: files requests for it and answers product questions about it. Has an account with a login (role `product-owner`, ranks below the Bauherr) that an Admin assigns to a Workspace or to single Products; it works in the Inbox, Requests and the reduced Ticket page of the Products assigned to it, and decides the Checkpoints and decision rows addressed to it (by default Triage's questions and acceptance on staging); everything else goes to a Bauherr. See `docs/spec/people.md`.
_Avoid_: Project owner, owner (bare)

**Admin**:
A Bauherr who runs the Bauherr instance: creates Workspaces and is a member of all of them.
_Avoid_: Superadmin, instance owner, root

**Product user**:
The wider group of people who use a Product and can only send a request to the factory (through intake or the widget), without access to the factory's configuration.
_Avoid_: User (bare), requester, client, customer

### External systems

**Connection**:
A credentialed link from a Workspace to one external system (a forge, a board tool, an LLM provider), shared by that Workspace's Products.
_Avoid_: Integration, credential, account

**Gateway**:
The LLM gateway shipped inside every Bauherr instance; every agent request passes through it with the Workspace's own provider credential and key budget.
_Avoid_: Proxy, LLM router

**Tier**:
One of cheap, standard, strong: a Workspace resolves each to a model name; stages pick a Tier, never a model.
_Avoid_: Model (in config)

**LLM provider**:
The company or cloud whose models a Workspace pays for with its own credential.
_Avoid_: Vendor, backend

**Repository**:
One code repository reached through a forge Connection; it belongs to exactly one Product, and a Product has one or more.
_Avoid_: Repo (in prose), project

**Ticket source**:
The one issue tracker a Product's Tickets live in, reached through a forge Connection: a GitHub repository's Issues or a GitLab project's issues. It is the source of truth for every Ticket.
_Avoid_: Tracker, backend, board

### Knowledge

**Knowledge source**:
A place agents read knowledge from, reached through a Connection; every one can be read and searched, some can also be written to or are copied into the factory's index.
_Avoid_: Context pack, data source, knowledge base

**Core pack**:
The open-source Knowledge source that ships with Bauherr; read-only, the base every Product starts from.

**Knowledge repo**:
A Workspace's private Git Knowledge source, shared by its Products with a part per Product; changed only through merge requests.
_Avoid_: Knowledge base, wiki

**Skill**:
A reusable instruction package an agent loads when its description matches the task, following the open Agent Skills format.
_Avoid_: Prompt, recipe

**Stage kind**:
What a Stage is for in the workflow (`triage`, `plan`, `container`, `build`, `review`, `release`, `done`, `agent`, `human`); the factory's rules attach to the kind, not to the Stage's name.

**Conditional stage**:
An `agent` or `human` Stage with a `when` (`touches` a Path set, `paths`, `labels`, request `types`): a Ticket enters it only when the change matches, otherwise it moves on as if the Stage's pass Outcome had fired and a `skip:<stage>` event records why. Unknown changed paths count as matching.

**Path set**:
A named list of path globs a Product declares (`security`, `ui`); a conditional Stage names it in `touches`. A set the Product has not declared never matches.

**Outcome**:
A named result of a Stage (`plan`, `clean`, `changes`, ...) that maps to the Stage a Ticket moves to next; declared per Stage in `factory.yaml`.

**Role**:
A member of the factory's team (`team.roles` in `factory.yaml`): a title, a model tier or provider/model, a profile and optionally an `agents` cap; a Stage names the Role that works it. Roles are the only source of roles: an agent never invents one.

**Agent session**:
A connected client (e.g. Claude Code) working as one Role: it `connect`s, pulls Runs of its Role's Stages with `next_work`, and its presence (`working`, `idle`, `offline`) and active time are recorded.
_Avoid_: Agent, worker

**Exceptions role**:
The one Role (`exceptions: true`) that also receives stuck Tickets when nothing normal is claimable; it can only use the repairs agents already have, never a human gate.

**Factory file**:
The `factory.yaml` of a Workspace: its team and workflow. One per Workspace, edited in the workflow editor (`/workflow/edit`) or applied from the CLI, the API or at boot; the shipped `pack/factory.yaml` is the default.

**Workflow version**:
One applied state of a Workspace's Factory file (`workflow_versions`): the file with its profiles inlined, the compiled workflow and its hash. The newest applied one is active; an identical file adds no version.

**Decision**:
The choice of whom a `human` Stage asks (the Bauherr, or the Product owner with `by: product-owner`) in that Stage: one of the Stage's Outcomes, recorded as a human touch `decide:<stage>:<outcome>`; the Ticket then follows that Outcome.

**Asked**:
Whom a Checkpoint or decision row is addressed to: `bauherr` or `product-owner` (`gate: {by}`, `refine: {by}`, `by:`, a row's `for:`). A Checkpoint asked of the Product owner of a Product without one asks the Bauherr; `tickets.needsBy` stores it. _Avoid_: assignee, owner (bare)

**Checkpoint**:
A point where the workflow waits for a person (Triage's questions, a `gate`, the production gate, a `human` Stage). Each is addressed (`by: bauherr | product-owner`, default the Bauherr): only that person, and a Bauherr or Admin in their place, can decide it (`mayDecide`).

**Decision**:
What one Checkpoint asks of a person, prepared the same way every time (ask, recommendation, at most three facts, options, what happens next) and stored on the Ticket; the Inbox lists exactly the Tickets that have one.

**Progress comment**:
The one Comment the factory keeps on a Ticket's issue, edited in place, saying in plain words where the request stands (headline, next step, a six-step path). A separate short Comment mentions the issue's author when a question is open, a change is ready on staging, it is released or stuck. Texts are the `progress` Template; switch `workspaces.progressComments`.

**Template**:
The markdown structure of one text written for people (request, plan, decision, review, staging summary, release note, worklog, triage questions, progress): shipped in the pack, overridable per Workspace, handed to agents with their skill.

**TL;DR**:
The leading section of a plan (`Decision:`, `Recommendation:`, `Why:`, `Risk:`) the plan Checkpoint's Decision is made from.

### Tickets

**Ticket**:
One issue in a Product's Ticket source. Bauherr never owns a Ticket; it reads and changes it through the Ticket source and keeps only a pointer and what it derives.
_Avoid_: Issue (in prose), card, task, story

**Comment**:
A message on a Ticket, written by a person or an agent.

**Label**:
A tag on a Ticket; a Ticket's type is a Label.
_Avoid_: Tag, category

**Claim**:
Assigning a Ticket to someone so others leave it alone; an unassigned open Ticket is unclaimed.
_Avoid_: Lock, reservation

**Sub-ticket**:
A Ticket that is a child of another Ticket, its parent.
_Avoid_: Subtask, child issue

**Blocked by**:
The relation saying a Ticket cannot start until another Ticket is closed.
_Avoid_: Depends on

**Frontier**:
The open, unblocked, unclaimed Sub-tickets of a parent: what can be taken next.

**Link**:
A reference from a Ticket to an asset kept elsewhere (a document, a prototype, a merge request); assets are linked, never pasted in.

**Attachment**:
A file stored with a Ticket in the Ticket source, such as a screenshot; only available where the Ticket source supports it.
_Avoid_: Upload, asset (an asset lives elsewhere and is Linked)

### History

**Ticket event**:
One row of a Ticket's append-only history: the moment its stage or phase changed, with the cause, the Run and the Executor.
_Avoid_: Audit entry, transition

**Phase**:
What a Ticket's time is spent on while in a stage: working (a Run runs), queued (waiting for the factory), human (waiting for the Bauherr), ci (waiting for checks, the merge queue or a deploy), closed.
_Avoid_: State

**Status**:
The one label the Bauherr reads for an open Ticket (`ticketStatus`): In progress, Queued, Waiting for you, Waiting for CI / merge queue / deploy, Blocked, Failed or Done, with a detail line and who is doing it. A Phase refined by blockers and failed Runs; "Working" is not a Status.

**Lead time**:
From a Ticket's first event to its first closed event.

**Cycle time**:
From a Ticket's first event outside the triage stage to its first closed event.

**Executor**:
Who did a step: a session (an agent session), the runner (the autonomous Runner), CI, a human or the factory itself; a Run records its executor, client, model and provider.
_Avoid_: Agent (it names the model or client, not who executed)

### Work

**Review artifact**:
A typed piece of proof attached to a Ticket for a person to judge: a screenshot (alone or before and after), a recording, a preview link, a terminal session, a sample or a test or contract report. A Product's rules say which changes need which proof; the acceptance card shows it next to each acceptance criterion.
_Avoid_: Attachment (a file a person adds to a request), screenshot (one kind of it)

**Run**:
One agent execution on exactly one Ticket. Work that starts without a Ticket first creates one.
_Avoid_: Job, execution, session

**Step**:
One recorded unit inside a Run (an agent turn or tool call), kept for audit and cost.
_Avoid_: Action, event

**Chat thread**:
One person's stored conversation with the factory assistant in one Workspace; it remembers the page of its last message and at most one tool call awaiting confirmation. Private to its owner. It is not a Run and not an Intake session; the request conversation is not a thread: it reads and writes its Intake session directly.
_Avoid_: Conversation, session

**Page context**:
What the assistant is told about the page the person is looking at, built on the server from the URL path alone (never from text the browser sends) and limited to the person's current Workspace.
_Avoid_: Screen state, page content

**Request**:
What a person asks the factory for: an Intake session that has been sent, with its Ticket(s). Before it is sent it is a draft with a request card (title, type, product, urgency, what is wrong or wanted, "It is done when", screenshots). The type is Bug, Feature, Change or Question; it becomes the label `bauherr:type:<kind>` on the issue and a chip on request rows, the Ticket page and the Workflow list. A Question is answered in the thread and files nothing.
_Avoid_: Ticket (the factory's own record of it), order, wish

**Urgent request**:
A Bug marked "Urgent: something is broken for users now", with the reason (what is broken, for whom, since when). It is offered only while the Workspace's fast lane is on. An Admin who sends one puts it on the fast lane at once; anyone else's asks the Bauherr ("Fast lane for ...?" at the top of the Inbox).
_Avoid_: Hotfix request, P1, emergency

**Fast lane**:
What the user sees of the expedite lane: a Ticket on it skips Triage and plan approval and jumps the queue, one at a time. The data names stay `expedite` (`tickets.expedite`, `bauherr:expedite`, `workspaces.expediteLane`).
_Avoid_: Expedite (in text people read), hotfix lane

**Intake session**:
A Product user's conversation with the factory about a Product; it ends with a created Ticket or is abandoned. It is not a Run. In the app it is the request conversation (the Factory assistant in the conversation shell, the request card as its artifact); the embeddable widget is its other surface.
_Avoid_: Chat, interview, request
