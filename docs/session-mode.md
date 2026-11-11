# Session mode

A stage can run in **session** mode: the Run waits as `awaiting_session` until your own Claude Code session claims it over the factory MCP server (`/mcp`). You work in your local worktree with your own credentials; the factory only keeps the record. Default is `autonomous` (the Runner spawns an agent).

## Choose the mode

First match wins: `Workspace.modeByStage` (JSON, e.g. `{"plan":"session","build":"session"}`) · `Workspace.defaultMode` · env `BAUHERR_DEFAULT_MODE` · `mode:` on the stage in `pack/factory.yaml` · `autonomous`.

## Connect

Create an **agent key** in the UI: user menu, **API key** (`/settings/api-key`), label it (e.g. `laptop`). It is shown once as the ready-made `claude mcp add` line; list and revoke keys there. Set `githubLogin` on your user (assigned to the Ticket on claim; else `BAUHERR_BOT_LOGIN`).

For headless setups `pnpm seed`, with `BAUHERR_MCP_KEY_FILE` set (compose: mount `~/.config/bauherr` at `/run/bauherr`, `BAUHERR_MCP_KEY_FILE=/run/bauherr/mcp-key`), mints an agent key `seed` for the Admin and writes it 0600 to that file; never printed. Each seed run mints a new one; revoke old ones in the UI. See [gateway-smoke](gateway-smoke.md).

```bash
claude mcp add --transport http bauherr http://localhost:3000/mcp --header "Authorization: Bearer $(cat ~/.config/bauherr/mcp-key)"
```

The token acts as you, inside your Workspaces only.

### Agent identity

`/mcp` knows two kinds of caller. An **agent key** (`bha_...`, stored as a hash in `agent_keys`, many per user, revocable one by one) is what a session uses. The Bauherr's **personal key** (`enableAPIKey`, the old single key) is a *human* credential, opt-in, never minted by default: never give it to an agent. An unknown token is a 401.

Gate tools are refused for an agent key with `forbidden: <tool> needs a human`: `approve`, `accept_staging`, `grant_review_round`, `stop_review`, `request_changes` (and `approve_production` once it lands). Fail-closed: every tool declares `access: 'agent' | 'human'` (required); an agent key may call only `'agent'` tools. Gates stay in the UI, or in the forge for the plan label. Every `human_touches` row names a person (`actor` is a user email). The key used is recorded on the Run (`runs.agentKey`, shown as "Claimed by" on the Run page) and on every `tool_calls` row.

Upgrading: migration `20261102_150166_agent_keys` disables every existing personal key (they were handed to agents under the old setup). Mint an agent key and re-add the server:

```bash
claude mcp remove bauherr && <the line shown once on /settings/api-key>
```

Rolling the migration back drops `agent_keys` but does not restore the disabled personal keys; create a new one on `/settings/api-key`.

## Route your own session through the gateway

Budgeted, logged and attributed like the factory, billed to your own Claude login. Legal line: [legal.md](legal.md#owner-session-passthrough).

The seed also creates the Workspace's second consumer key `workspace-<slug>-session` (`kind: owner-session`, `sub/*` plus `ws-<slug>/*` for the Workspace API key) and, with `BAUHERR_SESSION_KEY_FILE=/run/bauherr/session-key`, writes it 0600. The key has its own budget, `SESSION_BUDGET_USD` (default 100) USD per rolling 30 days, independent of the Workspace budget; it is Audit only, so going over it logs a warning and never blocks your session.

```bash
pnpm --filter server session:activate     # merges env into ~/.claude/settings.json, backup settings.json.bauherr-bak
pnpm --filter server session:deactivate   # restores the backup
```

Activate sets `ANTHROPIC_BASE_URL=http://127.0.0.1:4000`, `ANTHROPIC_CUSTOM_HEADERS="x-agw-key: <session key>"` and maps the model tiers to `sub/claude-{haiku,sonnet,opus}-5-5`. Restart Claude Code afterwards. Claude Code keeps sending your own `Authorization`; the gateway forwards it to Anthropic and strips `x-agw-key`.

## Connect as a role

A session can join the factory's team instead of claiming by hand. The Workspace's factory file declares the roles (`team.roles`: title, profile, model tier or provider and model, optional `agents` cap, one optional `exceptions` role); the factory rules assign work: a role receives the Runs of the stages that name it. Start a Claude Code session with the MCP line above and give it this prompt (replace `engineer` with a role id of your factory file):

```text
Connect to the factory as engineer and work until told to stop.
```

The server instructions tell the session the rest:

1. `connect {role, session?, label?, workspace?, client?, model?, provider?}` registers an agent session and returns `sessionId`, the role's `profile` and `stages` (name, kind, skill, outcomes), the model the role runs on (`role.model`, plus a one-sentence `modelHint` when the role names a model and you report another), and `pollAfterSeconds`. An unknown role is refused with the list of valid roles. `session` is your stable key (max 64 chars): connecting again with it revives the same session and puts back any Run the old process still held. `label` is the name the Team view shows.
2. Loop `next_work {sessionId}`. It checks in and claims through the same path as `claim_next`, limited to the stages of your role: you get `{work: {...claim_next payload, skill, outcomes, roleReminder}}` or `{work: null, reason, pollAfterSeconds}` ("Nothing queued for Reviewer", "Reviewer is at its limit of 2 agents", "plan is at its WIP limit", "You still hold Run N"). Work the Run as in the Loop below (`load_skill`, `heartbeat`, `finish_run` ...).
3. Pass `sessionId` on every call (every agent tool takes it, optional): it keeps the session present and attributes the Run to it. Without it nothing changes: `claim_next`, `claim_run` and `heartbeat` work as before and the Run has no session.
4. `disconnect {sessionId}` when you stop; Runs you still hold go back to the queue.

A role that does not run on your model: do each Run's work in one subagent on the role's model if your client can, otherwise continue; the Run records the model you reported (`runs.model`, `runs.provider`, `runs.role`, `runs.session`).

The **exceptions role** (`exceptions: true`, the Orchestrator in the default file) also receives stuck Tickets: when nothing normal is claimable `next_work` (reading the sweep's stored findings, no forge call) answers `{work: null, exception: {ticket, problem, since, allowed}}`. `allowed` lists the repairs an agent may do today: `return_to_build {ticket, reason}` when the Ticket is dead for a mechanical cause (its MR is missing or its checks are red); for every other cause it is empty and the Ticket is the owner's decision or the factory repairs it itself. Human gate tools are never offered.

The **Team page** (`/team`, see [UI](ui.md#team)) shows the roles, who is connected and what each session works on; it carries the same three connect steps (add the server, the prompt, the session appears as Idle).

Presence: each call refreshes `lastSeenAt` (written at most every 15 s). A session with no running Run and no call for `BAUHERR_SESSION_TIMEOUT_S` (default 600) is ended as `timeout` by the 5-minute sweep; a session whose Run lease expired is handled by the lease expiry first. The lease rules below are unchanged (heartbeat at least every 10 minutes). Active time is the sum of the session's spans (one per Run it holds, from the claim to its last call); `loadTeam` (`lib/sessions.ts`) reads sessions and active time for the Team page, `sessionTime` per session and role for Insights.

## Loop

1. `claim_next {product?, session?}` takes the top claimable Run in the owner's order (right to left: Release, Review, Build, Plan, Triage, then the Board rank; blocked and leased Tickets are skipped) and returns the `claim_run` payload, or `null`. Several sessions calling at once get different Runs. `list_frontier` shows the same order. Pass a stable `session` name (max 64 chars) to `claim_next`, `claim_run` and `list_frontier`: a Review of a build with the same name is skipped ("your own build"); without a name nothing is skipped. Then `load_skill run-contract`, `read_worklog`.
2. `claim_run {runId, session?}` (not needed after `claim_next`; refused with "take Run N (#T, column) first" unless it is the Run `claim_next` would return; the check is workspace-wide, `claim_next {product}` is product-scoped; a Run whose claim failed in the last 5 minutes does not hold others back) → returns `leaseToken` (once), Ticket, body and Goal statements. Status `running`, Ticket assigned. Pass `leaseToken` on every later call on the Run (see the Lease section of [run-contract](../pack/skills/run-contract/SKILL.md)).
3. Work in a local worktree. Meanwhile: `update_worklog` (full markdown), `report_step`, `attach_evidence` (commands with exit codes, test summary), `heartbeat`.
4. Write `Refs #N` in the MR body and commit messages, never `Closes/Fixes/Resolves`: only acceptance on staging closes a Ticket (a merge that closes it is reopened). `request_review` (moves the Ticket to the review stage), then `finish_run {runId, status, reason?, prUrl?}`. `succeeded` needs the MR/stage output; otherwise `failed` or `needs_human` with a reason.
4b. Custom `agent` stages (declared in the Workspace's `factory.yaml`): the `claim_run` payload carries `agent: {stage, title, skill, role: {id, title, profile}, outcomes}`; `load_skill` the named skill and work as the role. You read the Ticket, the plan, the worklog and the open MR (`get_ticket`, `read_worklog`); you cannot push, open or merge an MR, create sub-tickets or touch approval labels, and `request_review`, `submit_plan`, `submit_review`, `submit_triage` and `relink_mr` are refused for such a Run. End it with `finish_run {runId, leaseToken, status:'succeeded', outcome, comment?}`: `outcome` is required and must be one of `outcomes`, `comment` (markdown) is posted once on the Ticket with the marker `<!-- bauherr:stage:<name> -->`, and the Ticket moves where the stage maps the outcome (for an outcome that leads back to Build the comment is the hand-back instruction, on the same MR, no review round). `human` stages have no Run: the owner decides in the UI or with `decide` (human key only, see Agent identity). A Build Run that cannot go on may end `succeeded` with `outcome: 'replan'` and no MR.
5. Review Runs (`stage: review`): `get_ticket` shows the open MR as `pr`; `load_skill review`, read the diff in your worktree, never edit code, then `submit_review {runId, leaseToken, verdict, findings:[{severity, file, line, msg, scenario}], checked:[{area, note}], markdown}`. It ends the Run `succeeded` in the same write and runs the conclusion (MR comment, back to Build, or merge gate). Build Runs on a Ticket whose `get_ticket` has a `pr`: check out `pr.branch` and push there; open no new MR.
6. Plan gate: an agent cannot approve. `approve {ticket, gate:'plan'}` works only with a human (personal) key; sessions ask the owner to approve in the UI.
7. Round cap: `grant_review_round {ticket}`, `stop_review {ticket, note?}` and the `decide {ticket, outcome, note?}` of a `human` stage are human-only (see Agent identity), so a session cannot lift its own cap.

Switch away: `release_run {runId, leaseToken}` puts the Run back to `awaiting_session`; `release_run {runId, leaseToken, takeover:'autonomous'}` hands it to the Runner.

## What the factory does meanwhile

Polls the Ticket source, keeps Ticket state and labels current, records every tool call (argument names and hash, never payloads) in `tool_calls`, shows Steps, evidence and the worklog on the Run page. It queues no agent for a session Run.

## Heartbeat rule

Call `heartbeat` at least every 10 minutes; only that tool counts. A running session Run without a heartbeat for 30 minutes is `abandoned` and a new claimable Run takes over (a second one in a row: `needs_human`); an `awaiting_session` Run nobody claims goes `needs_human` 30 minutes after it was created or released. Migration `20261030_170000_ticket_lease` moves session Runs that were `running` without a lease back to `awaiting_session` (claimable again). A person can release the lock on the Run page.
