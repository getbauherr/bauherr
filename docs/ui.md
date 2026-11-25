# UI

The Bauherr UI is served at `/`. A Bauherr or Admin decides on tickets here and sets up Products. This is the short guide.

## Shell

Every signed-in page has this frame.

- **Sidebar**: Factory, Inbox, Memory and Insights. Settings and the user menu sit at the bottom. `Ctrl/Cmd+B` collapses it.
- **Header**: breadcrumb and Search on `Ctrl/Cmd+K`. Search jumps to any page and finds tickets.
- **Workspace switcher**: appears with two or more Workspaces.

A Product owner gets a smaller shell today. Requests from Product owners are planned, not built.

## Get a ticket through

1. **Connect a project**: add a repository to a Product and switch it on. See Connect a project below.
2. **Intake**: code selects the issue. The factory may ask the reporter one numbered round of questions.
3. **Approve the Brief**: a ticket that needs you shows the Brief card. Approve it, request changes or discard it. A low-risk Brief is approved by the risk rule and never reaches you.
4. **Build and Verify**: agents build, then a reviewer and a verifier check the patch. You are not asked.
5. **Accept the Result**: the Result card shows before and after pictures and proof per criterion. Accept it, or send it back with a note.
6. **Done**: the ticket closes. Production approval is a switch per Product.

## Pages

| Path | What you do |
|---|---|
| `/` | See the Factory view: tickets by stage, filters, holds and loops. |
| `/inbox` | Decide what waits for you. Keys: `j`/`k` move, `o`/`Enter` open, `Esc` clear, `?` help. |
| `/requests` | Follow your requests in four sections, starting with Needs you. |
| `/requests/<id>` | Read one request: whose turn it is, then its story. |
| `/tickets/<id>` | Decide one ticket. Tabs Now, Brief, Result and Activity. |
| `/memory` | Edit the factory, workspace or product document. `/memory/retro` starts a Retro. |
| `/insights` | Read time per stage and cost. Choose 7, 30 or 90 days. |
| `/settings/products/<id>` | Read Repo readiness and set gates, intake and proof for a Product. |
| `/settings/products/<id>/connect` | Connect a project: import, first look and switch on. |
| `/runs/<id>` | Read one run: its steps, handoff and links. |
| `/settings/...` | Profile, API keys, General, Products, Connections, Models and budget, People, Health, Audit. |

## Factory view

The six stages are fixed: Intake, Brief, Build, Verify, Ship and Done. Each shows its count, a bar by state, who works there and the median time in the stage. Tickets sit as cards under their stage.

- **Filters**: All, Waiting on you, Agents working, Stuck and Waiting on others. With several Products, a Product filter joins them.
- **Holding up work**: one line per cause that stops several tickets. Examples are no connected session for a role, a Product that is still observing and a repository whose sync failed.
- **Loops**: dashed lines count tickets sent back from Verify and from Ship in the last 7 days.
- **Order**: drag a card, press `Alt` and an arrow key, or use the card menu. Priority changes inside a stage only. A stage changes through the card's actions.
- **Someday**: the label `bauherr:someday` parks an issue. The view shows how many are parked and links to them.

The page refreshes from the database on its own.

## Inbox

The same tickets as a list, grouped by who has to act: Waiting on you, Agents working, Waiting on others and Done. The badge on the sidebar counts what waits on you.

## Ticket page

The header shows the title, the status and the six stages with the current one marked. The Now tab holds the card that waits for you and a comment box. The side column shows the source issue, time and cost, and the verdict.

### The three cards

Each card has the ask in one sentence, the reason you are asked, options and a free comment. The factory acts on the option you choose, not on the comment text.

- **Brief**: Approve Brief, Request changes or Discard. It shows the goal, open decisions with a recommended option, the criteria, the risk and, for a visible change, mockups.
- **Result**: Accept or Send back with note. It shows before and after per mockup screen, criteria with proof and what was not verified.
- **Question**: what the factory cannot settle, for example failed runs, used-up verify rounds, a silent reporter or production approval. The options are in the card.

### Other actions

- **Back to Brief** returns a ticket in Build or Verify to Brief with a note.
- **Archive** hides a ticket before Ship, releases its run and closes the issue as not planned. **Restore** reverses it.
- A note you give with a decision is kept as a memory.

## Connect a project

An existing project comes in four steps. The page shows where you are.

1. **Connect**: attach a repository to the Product.
2. **Import**: all issues with comments and all open pull requests are mirrored. Nothing is written to the forge.
3. **First look**: Intake runs on every open issue and a repository check runs. The Product is `observing` and the forge writer refuses.
4. **Switch on**: the Product becomes `active`. Briefs for old issues come one at a time, at most five waiting on you.

You decide what is built: every issue that existed before connecting gets a Brief card. An open pull request that closes an issue and comes from a trusted author enters at Verify.

## Repo readiness

The Product page lists what the repository lacks: required checks, CI runs, risk areas, `AGENTS.md`, issue forms, connected sessions and branch protection. Each row says ready, gap or unknown. A gap offers a fix: set a value, open a ticket or follow a link. GitLab cannot report required checks, so that row shows unknown.

## Agent sessions

A Product's executor is `session` or `runner`. For `session`, create an agent key under API keys and add the MCP server to Claude Code. The session connects as builder, reviewer or verifier and pulls runs. With a capacity of 1 to 4 it holds that many runs, one subagent each. API keys lists each session with its live runs.

## Memory

`/memory` edits one document at a time in a markdown editor with preview. Pick factory, workspace or a Product. Headings are fixed: All stages, Brief, Build, Review and Verify. A Product's side column lists its repository instruction files and the document's versions. A run page lists the memory it was given.

**Retro** starts a conversation for one Product over a range of tickets. It proposes document changes or new tickets. You apply or drop each one.

## Conversations

Conversations are built on assistant-ui. The Thread, Composer, attachments, option lists and cards share one set of parts in `assistant-ui/`. `/conversations` starts a test conversation. Files may be up to 10 MB.

## Settings

Settings are grouped by scope. Account holds Profile and API keys. Workspace holds General, Products, People and, for an Admin, Connections and Models and budget. Admin holds Health and Audit. Only an Admin edits Product settings. Members read them.

## Not in the UI, by design

- `/api/health`: a probe for monitoring. The same facts are in Settings, Health.
- Payload `/admin`: a developer escape hatch behind `BAUHERR_ENABLE_ADMIN=1`.
- CLI commands, environment flags and background jobs: deployment configuration. Their effects show on tickets, runs and Health.
