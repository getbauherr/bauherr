# Bauherr

An AI software factory: agents take tickets through gated stages for products their owners have connected, with human approval at the gates.

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
A person who is a member of a Workspace and owns all its Products: configures the factory for them and approves work at gates.
_Avoid_: Product owner, operator

**Admin**:
A Bauherr who runs the Bauherr instance: creates Workspaces and is a member of all of them.
_Avoid_: Superadmin, instance owner, root

**Product user**:
A person who uses a Product and talks to the factory through intake and Tickets, without access to the factory's configuration.
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

### Work

**Run**:
One agent execution on exactly one Ticket. Work that starts without a Ticket first creates one.
_Avoid_: Job, execution, session

**Step**:
One recorded unit inside a Run (an agent turn or tool call), kept for audit and cost.
_Avoid_: Action, event

**Intake session**:
A Product user's conversation with the factory about a Product; it ends with a created Ticket or is abandoned. It is not a Run.
_Avoid_: Chat, interview, request
