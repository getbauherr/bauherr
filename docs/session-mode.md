# Session mode

A stage can run in **session** mode: the Run waits as `awaiting_session` until your own Claude Code session claims it over the factory MCP server (`/mcp`). You work in your local worktree with your own credentials; the factory only keeps the record. Default is `autonomous` (the Runner spawns an agent).

## Choose the mode

First match wins: `Workspace.modeByStage` (JSON, e.g. `{"plan":"session","build":"session"}`) · `Workspace.defaultMode` · env `BAUHERR_DEFAULT_MODE` · `mode:` on the stage in `pack/workflow.yaml` · `autonomous`.

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

The seed also creates the Workspace's second consumer key `workspace-<slug>-session` (`kind: owner-session`, `sub/*` plus `ws-<slug>/*` for the Workspace API key) and, with `BAUHERR_SESSION_KEY_FILE=/run/bauherr/session-key`, writes it 0600.

```bash
pnpm --filter server session:activate     # merges env into ~/.claude/settings.json, backup settings.json.bauherr-bak
pnpm --filter server session:deactivate   # restores the backup
```

Activate sets `ANTHROPIC_BASE_URL=http://127.0.0.1:4000`, `ANTHROPIC_CUSTOM_HEADERS="x-agw-key: <session key>"` and maps the model tiers to `sub/claude-{haiku,sonnet,opus}-5-5`. Restart Claude Code afterwards. Claude Code keeps sending your own `Authorization`; the gateway forwards it to Anthropic and strips `x-agw-key`.

## Loop

1. `claim_next {product?}` takes the top claimable Run in the owner's order (right to left: Release, Review, Build, Plan, Triage, then the Board rank; blocked and leased Tickets are skipped) and returns the `claim_run` payload, or `null`. Several sessions calling at once get different Runs. `list_frontier` shows the same order. Then `load_skill run-contract`, `read_worklog`.
2. `claim_run {runId}` (not needed after `claim_next`; refused with "take Run N (#T, column) first" unless it is the Run `claim_next` would return) → returns `leaseToken` (once), Ticket, body and Goal statements. Status `running`, Ticket assigned. Pass `leaseToken` on every later call on the Run (see the Lease section of [run-contract](../pack/skills/run-contract/SKILL.md)).
3. Work in a local worktree. Meanwhile: `update_worklog` (full markdown), `report_step`, `attach_evidence` (commands with exit codes, test summary), `heartbeat`.
4. Write `Refs #N` in the MR body and commit messages, never `Closes/Fixes/Resolves`: only acceptance on staging closes a Ticket (a merge that closes it is reopened). `request_review` (moves the Ticket to the review stage), then `finish_run {runId, status, reason?, prUrl?}`. `succeeded` needs the MR/stage output; otherwise `failed` or `needs_human` with a reason.
5. Review Runs (`stage: review`): `get_ticket` shows the open MR as `pr`; `load_skill review`, read the diff in your worktree, never edit code, then `submit_review {runId, leaseToken, verdict, findings:[{severity, file, line, msg, scenario}], checked:[{area, note}], markdown}`. It ends the Run `succeeded` in the same write and runs the conclusion (MR comment, back to Build, or merge gate). Build Runs on a Ticket whose `get_ticket` has a `pr`: check out `pr.branch` and push there; open no new MR.
6. Plan gate: an agent cannot approve. `approve {ticket, gate:'plan'}` works only with a human (personal) key; sessions ask the owner to approve in the UI.
7. Round cap: `grant_review_round {ticket}` and `stop_review {ticket, note?}` are human-only (see Agent identity), so a session cannot lift its own cap.

Switch away: `release_run {runId, leaseToken}` puts the Run back to `awaiting_session`; `release_run {runId, leaseToken, takeover:'autonomous'}` hands it to the Runner.

## What the factory does meanwhile

Polls the Ticket source, keeps Ticket state and labels current, records every tool call (argument names and hash, never payloads) in `tool_calls`, shows Steps, evidence and the worklog on the Run page. It queues no agent for a session Run.

## Heartbeat rule

Call `heartbeat` at least every 10 minutes; only that tool counts. A running session Run without a heartbeat for 30 minutes is `abandoned` and a new claimable Run takes over (a second one in a row: `needs_human`); an `awaiting_session` Run nobody claims goes `needs_human` 30 minutes after it was created or released. Migration `20261030_170000_ticket_lease` moves session Runs that were `running` without a lease back to `awaiting_session` (claimable again). A person can release the lock on the Run page.
