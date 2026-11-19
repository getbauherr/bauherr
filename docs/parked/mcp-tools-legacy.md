# MCP tools of the old engine

Cut from the lean core on 2026-11-19. The code is at the git tag `legacy-final`.

## What it did

- The factory served 38 MCP tools at `/mcp` (`apps/server/src/app/mcp/route.ts`, 55 lines): 28 agent tools and 10 human-only tools. A human-only tool is refused for an agent key with "needs a human".
- Agent flow: `connect` with a role returns a `sessionId`; the agent loops `next_work`, works one Run, ends it, then calls `disconnect`. Every agent tool except `connect` takes `sessionId`.
- A Run was claimed with a lease. `leaseToken` was required on writes while running; `heartbeat` at least every 10 minutes; 30 minutes of silence ended the lease and the Run was abandoned.
- Each stage had its own submit tool (`submit_triage`, `submit_plan`, `submit_investigation`, `submit_review`, `finish_run` for Build and agent stages).
- Every call was logged with an input digest, status and duration; the answer of any tool could carry a `preempt` notice when a hotfix took the session.
- After a human tool in the set `DECIDES` the open decision of the ticket was settled (`settleDecision`).

### Agent tools (28)

| Tool | Purpose |
|---|---|
| `connect` | Start a session for a role; returns `sessionId`, role profile, model hint, poll interval |
| `next_work` | Pull the next Run for the role (as `claim_next`, plus skill, outcomes, reminder) or an idle reason |
| `disconnect` | End the session; held Runs return to the queue |
| `heartbeat` | Keep a Run's lease alive; may report a beating expedite Run |
| `list_frontier` | Open, unblocked tickets with stage and latest Run state |
| `get_ticket` | Ticket pointer, live body, Goal statements, open MR (`pr`), epic data |
| `claim_run` | Claim one `awaiting_session` Run by id (only the one `claim_next` would give) |
| `claim_next` | Claim the top Run in frontier order (expedite lane first, then right to left) |
| `release_run` | Give a Run back to the queue or to the Runner (`takeover: autonomous`) |
| `read_worklog` | Read the ticket's worklog comment |
| `update_worklog` | Create or replace the worklog comment (lease token required while leased) |
| `report_step` | Record a Step of the Run |
| `attach_evidence` | Append markdown to the Run's `## Evidence` |
| `attach_artifact` | Attach one proof item (image, recording, preview, transcript, sample, report) |
| `run_checks` | Show the pre-review failures that `request_review` would hit |
| `request_review` | Move the ticket to review; refused on failed pre-review or red or pending checks |
| `relink_mr` | Link a replacement MR opened by hand (branch `bauherr/<n>-...`) |
| `submit_triage` | End a Triage Run: outcome plan, refine or skip, questions, expedite, `causedBy` |
| `submit_plan` | Post or update the plan comment; must start with `## TL;DR` |
| `submit_investigation` | Record cause and decision (revise, fix-ticket, needs-human) for a twice-failed Build |
| `submit_review` | End a Review Run: verdict, findings with class and failing test, open, checked |
| `finish_run` | End a Run: succeeded (MR or stage output), failed, or needs_human with `reasonKind` |
| `post_staging_summary` | Post the staging summary comment once per merge commit |
| `return_to_build` | Repair: send a mechanically dead ticket (missing MR, red checks) back to Build |
| `release_fast_lane` | Repair: a ticket holding the fast lane while it waits gives up its place |
| `load_skill` | Read a pack skill (and its session part) with the Workspace templates |
| `read_knowledge` | Read a Knowledge document by path (Workspace layer shadows core pack) |
| `search_knowledge` | Full-text search over pack, Workspace Knowledge repo and Product docs, up to 20 hits |

### Human-only tools (10)

| Tool | Purpose |
|---|---|
| `approve` | Approve the plan gate (label `bauherr:approved:plan`) |
| `accept_staging` | Accept on staging; moves to done |
| `approve_production` | Approve or retry the production deploy; refused while a session Run holds the ticket |
| `decide` | Decide a ticket waiting in a `human` stage by outcome key |
| `request_changes` | Send a release-stage ticket back to Build with a note |
| `send_back` | Send an open ticket to an earlier stage or the backlog, optional note |
| `grant_review_round` | At the review round cap, allow exactly one more round |
| `stop_review` | At the review round cap, stop: ticket to triage, MR stays open |
| `approve_skill_proposal` | Merge a distilled skill PR if its head equals `expectSha` |
| `reject_skill_proposal` | Close a skill PR and mark it rejected |

## The requirement behind it

- Let any MCP client (Claude Code, Copilot) work factory Runs as a session (#67, "Session mode and factory MCP server").
- Keep gates human: approvals need a person, never an agent key.
- Let several sessions share work without clashing: leases, frontier order, preemption.

## Where the code is

- `apps/server/src/lib/mcp-tools.ts` (987 lines): the `tools` array, `callTool`, `digest`.
- `apps/server/src/lib/sessions.ts` (424): `connect`, `resolve`, presence, `next_work` selection. `apps/server/src/lib/chat/tools.ts` and `engine.ts` also import `mcp-tools`.
- Collections in `apps/server/src/collections.ts`: `agent_keys`, `agent_sessions`; Run fields `session`, `sessionOwner`, `leaseHash`, `heartbeatAt`.
- Tests in `apps/server/tests/`, among them `lease.test.ts`, `agent-identity.test.ts`, `submit-plan.test.ts`, `send-back.test.ts`, `green-heads.test.ts`, `preempt.test.ts`, `production-gate.test.ts`.
- Docs: `docs/spec/sessions.md` (64), `docs/spec/runs.md`.
- Pack: `pack/skills/run-contract/session.md`.

## Why it was cut

The lean core has nine tools (`connect`, `next_work`, `heartbeat`, `search`, `attach_proof`, `ask`, `submit`, `release`, and `decide` for humans). Claiming, leases and per-stage submit tools collapse into `next_work` and `submit`.

## What a module on the new core needs

Mapping of every old tool to the new one:

| Old tool | New tool |
|---|---|
| `connect` | `connect` |
| `next_work`, `list_frontier`, `claim_run`, `claim_next`, `get_ticket` | `next_work` (the context pack carries the ticket) |
| `heartbeat` | `heartbeat` |
| `release_run` | `release` |
| `disconnect` | no successor; a session ends when its lease expires |
| `read_worklog`, `update_worklog` | no successor; the record and owner memory arrive in the context pack, `submit` writes `handoff` |
| `report_step` | `heartbeat` with a step note |
| `attach_artifact` | `attach_proof` |
| `attach_evidence`, `run_checks` | no successor; exit codes come from CI checks in the mirror or from the Runner, media proof goes through `attach_proof` |
| `load_skill` | no successor; the stage skill arrives in the context pack |
| `request_review`, `finish_run`, `submit_triage`, `submit_plan`, `submit_investigation`, `submit_review`, `post_staging_summary` | `submit` |
| `relink_mr` | no successor (forge writer) |
| `return_to_build`, `release_fast_lane` | no successor (repair tools; caps end in a Question card) |
| `read_knowledge`, `search_knowledge` | `search` |
| `finish_run` with `needs_human` and the decision sheet | `ask` |
| `approve`, `accept_staging`, `approve_production`, `decide`, `request_changes`, `send_back`, `grant_review_round`, `stop_review` | `decide` (a chosen card option) |
| `approve_skill_proposal`, `reject_skill_proposal` | no successor until a skill module exists; it would use `decide` |

- Lift almost unchanged: `callTool` structure (access check, digest log), `digest`, the pre-review failure messages, the human-only refusal text.
- Redesign: input schemas, one `submit` payload validated per stage, `ask`.
- Traps: `claim_run` accepted only the Run `claim_next` would return, to keep frontier order. Two sessions calling `claim_next` at once needed distinct Runs. `approve_production` is refused while a session Run holds the ticket, so an agent cannot approve its own work. `sessionId` was injected into every agent tool schema by a loop at the end of the file; a new tool outside that loop would miss it (inferred).
