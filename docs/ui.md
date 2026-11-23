# UI

The Bauherr UI is served at `/`. Everything an Admin configures is a page here, and every feature with its page is listed in the feature map. This page is the short guide.

## Shell

Every signed-in page has the same frame.

- **Sidebar**: Inbox, Memory, Tickets, Agent team, Requests, Releases, Knowledge, and Runs for an Admin. Settings and the user menu sit at the bottom. `Ctrl/Cmd+B` collapses it.
- **Header**: breadcrumb, "New request", the agent presence pill (who is working, who is idle) and the command palette on `Ctrl/Cmd+K`. The palette jumps to any page and finds Tickets.
- **Holding up work strip**: one line for each thing that stops work for several Tickets, linking to its cause, only while runs wait: "No builder session is connected: 2 runs wait (Build 2)" with a Connect a session link, one line per role of a session Product with no session of that role seen for 10 minutes; "The Runner has not picked up a run for 10 minutes" when a Runner Product's run waits that long.
- **Ask button**: opens the [chat](#chat) dock on `Ctrl/Cmd+J`.
- **Workspace switcher**: appears with two or more Workspaces.

A Product owner gets a smaller shell with Requests and Profile only, and no chat.

## Get a Ticket through

1. **Request**: open `/requests/new` and answer the assistant's questions until the request card is complete. Then File request.
2. **Triage and plan**: the factory reads the request and may ask questions. You answer them in the Ticket's conversation. It then writes a plan.
3. **Approve the plan**: the Inbox shows one card with the ask, a recommendation and the options. Approve it, or send it back with a note.
4. **Build and review**: agents build and review without you. A Run that needs you appears in the Inbox.
5. **Accept on staging**: open staging from the Ticket page and press Accept, or Request changes with a note.
6. **Release**: the Releases page collects done Tickets into a version and its notes. Production may ask for one more approval.

Only acceptance on staging closes a Ticket.

## Pages

| Path | What you do |
|---|---|
| `/inbox` | Decide what waits for you. The list is on the left and the decision card on the right. Keys `e` and `r` take the primary action and send back. |
| `/` | See the workflow as a graph and the open Tickets by stage. Tabs Workflow, Graph and Epics. |
| `/workflow/<stage>` | See the Jobs of one stage and the Tickets in each. |
| `/requests` | Follow your requests in four sections, starting with Needs you. |
| `/requests/<id>` | Read one request, its status and its timeline. Report a problem once it is released. |
| `/releases` | Pick done Tickets, choose the version and edit the notes. |
| `/insights` | Read time to market, time per stage and the bottleneck. Choose 7, 30 or 90 days. |
| `/knowledge` | Search and read the documents the agents use. |
| `/team` | Connect an agent session and see who works on what. |
| `/runs` | Admin only. The newest Runs with stage and status. |
| `/setup` | Admin only. Five steps from forge connection to the first request. |

## Overview

The `/` page shows the workflow of your factory file. Tickets are listed by stage, with "Needs you" first. The Graph tab orders Tickets by blockers. A Ticket with sub-tickets is an epic and shows its progress on the Epics tab.

Every Ticket has one status. The labels are Done, Split, In progress, Queued, Waiting for you, Waiting for CI, Blocked and Failed. The first matching label wins, and the list, the graph, the chat and the Ticket page show it the same way.

## Someday

Label an issue `bauherr:someday` to park an idea: no Intake Run, no Inbox item. It is excluded by default (Product settings, Intake). The Factory view shows `Someday: N`, linked to those issues. Remove the label and the next sync takes it into Intake.

## Ticket page

The page has two halves. On the left is the conversation with the factory, which ends in a comment box. On the right is the Now pane with four tabs: Now, Plan, Proof and History.

The action bar atop the Now pane holds the next step: one sentence and one primary button naming it, such as Approve plan or Re-run Build.

- **Approve plan** is refused while critical decisions are unanswered.
- **Send back** asks for a note and returns the Ticket to Build or the Backlog. Every comment has an Applies to choice: This ticket (the default), This product or Do not remember. The Ticket page lists each used memory with its scope.
- **Fast lane** skips Triage and plan approval and jumps the queue. It is available for one Ticket at a time when the Workspace allows it.
- **Round cap**: when review reaches its cap you grant one more round or stop.
- **Close as done**: when Build reports another pull request or Ticket covers the work, the card asks "Close #n as done by #m?". Close comments with the evidence, closes the issue as completed and moves the Ticket to done; Re-run build queues Build again.

- **Archive** (before Ship, after a dialog): releases the Run, hides the Ticket, closes the issue as not planned.
- **Restore** reopens the issue and reruns the stage; so does reopening it on the forge.

### Decision card

Every human checkpoint uses one card. It has the ask in one sentence, a recommendation, at most three reasons, the options and a collapsed details section. The Inbox and the Ticket page show the same card. Each option is an existing action, and a decided card does not come back.

## Request conversation

`/requests/new` opens an interview with the Factory assistant. The request card fills in beside the stream.

- Pick Report a bug, Ask for a feature or Change something, or just describe it.
- Click a suggested answer or type your own.
- Edit any field of the card by hand. Your edit is kept.
- Several problems in one message become several Tickets.
- File request is enabled when the card is complete or the question limit is reached.

After filing, the conversation is read-only history.

## Run page

`/runs/<id>` shows one attempt of a stage. The header gives a status such as Working, Stuck or Session gone. It shows the Steps, the proof, the merge request links and the times.

A Run offers one primary action: Connect an agent, Re-run the stage or Open ticket. An Admin can release the lock on a stuck Run.

## Agent team

`/team` is where a session joins the factory.

1. Choose a role in the Connect panel.
2. Press Copy prompt and paste it into a Claude Code session that has the Bauherr MCP server.
3. The session appears as Idle, then Working when it claims a Run.

Rows show the status, the Ticket and today's cost. Open a row for the agent view with current Run, milestones and cost. An Admin edits a role's model and agent limit in the role drawer. Commands are in session mode.

## Chat

One assistant is docked on every page. It answers questions about the factory and the page you are on. Ticket numbers like `#123` in answers are links.

- Actions such as approving show a confirmation card first. Nothing runs until you press Approve.
- Paste or drop images into the composer.
- Rate answers with thumbs. Admins read the ratings at `/settings/chat-feedback`.
- Slash commands: `/context`, `/new`, `/request`, `/help`. On a Ticket thread, `/comment <text>` posts to the issue.

## Settings

Settings are grouped by scope. Account is for everyone, with Profile and API keys. Factory has Workflow, Templates, Models and budget, and AI usage. Workspace has General, Products, Connections, People and Knowledge. Admin has Audit and Health.

API keys lists each session with its live Runs and slots, for example "2 of 3 working": a session connected with a capacity of 1 to 4 holds that many Runs at once, one subagent each.

Only an Admin edits, except Profile and API keys. Members read the rest. The sidebar's Settings item opens Profile, and the command palette lists every page you may open.

## Memory

`/memory` lists what the factory remembers for one Product, filtered by All, New, You said, Agents found, Came back and Off. A memory Learn wrote shows as New until its page is opened; the sidebar counts them. A memory page edits, switches off or deletes it, quotes where it came from and lists how it fared: Came back, Clean or No verdict yet. Came back counts tickets that were corrected for the same thing although a run had the memory. The run page lists the memory a run got, and the Activity of a Ticket says what Learn kept.

## Not in the UI, by design

- `return_to_build`: the agent repair for a dead Ticket. People use Back to Build.
- Connection slug: derived from the name and used in model ids.
- `/api/health`: a probe for monitoring. The same facts are in Settings, Health.
- Payload `/admin`: a developer escape hatch behind `BAUHERR_ENABLE_ADMIN=1`.
- CLI commands, environment flags and background jobs: deployment configuration. Their effects show on Tickets, Runs and Health.
