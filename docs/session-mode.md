# Session mode

A stage can run in **session** mode: the Run waits as `awaiting_session` until your own Claude Code session claims it over the factory MCP server (`/mcp`). You work in your local worktree with your own credentials; the factory only keeps the record. Default is `autonomous` (the Runner spawns an agent).

## Choose the mode

First match wins: `Workspace.modeByStage` (JSON, e.g. `{"plan":"session","build":"session"}`) · `Workspace.defaultMode` · env `BAUHERR_DEFAULT_MODE` · `mode:` on the stage in `pack/workflow.yaml` · `autonomous`.

## Connect

`pnpm seed` (compose: `docker compose run … app pnpm seed`, see [gateway-smoke](gateway-smoke.md)) ensures the Admin user has an API key and, with `BAUHERR_MCP_KEY_FILE` set, writes it 0600 to a file; never printed. Mount `~/.config/bauherr` at `/run/bauherr` and set `BAUHERR_MCP_KEY_FILE=/run/bauherr/mcp-key`. Set `githubLogin` on the user (assigned to the Ticket on claim; else `BAUHERR_BOT_LOGIN`).

```bash
claude mcp add --transport http bauherr http://localhost:3000/mcp --header "Authorization: Bearer $(cat ~/.config/bauherr/mcp-key)"
```

The token acts as you, inside your Workspaces only.

## Route your own session through the gateway

Budgeted, logged and attributed like the factory, billed to your own Claude login. Legal line: [legal.md](legal.md#owner-session-passthrough).

The seed also creates the Workspace's second consumer key `workspace-<slug>-session` (`kind: owner-session`, only `sub/*`) and, with `BAUHERR_SESSION_KEY_FILE=/run/bauherr/session-key`, writes it 0600.

```bash
pnpm --filter server session:activate     # merges env into ~/.claude/settings.json, backup settings.json.bauherr-bak
pnpm --filter server session:deactivate   # restores the backup
```

Activate sets `ANTHROPIC_BASE_URL=http://127.0.0.1:4000`, `ANTHROPIC_CUSTOM_HEADERS="x-agw-key: <session key>"` and maps the model tiers to `sub/claude-{haiku,sonnet,opus}-5-5`. Restart Claude Code afterwards. Claude Code keeps sending your own `Authorization`; the gateway forwards it to Anthropic and strips `x-agw-key`.

## Loop

1. `list_frontier` → pick a Ticket whose run is `awaiting_session`. `load_skill run-contract`, `read_worklog`.
2. `claim_run {runId}` → returns Ticket, body and Goal statements. Status `running`, Ticket assigned.
3. Work in a local worktree. Meanwhile: `update_worklog` (full markdown), `report_step`, `attach_evidence` (commands with exit codes, test summary), `heartbeat`.
4. `request_review` (moves the Ticket to the review stage), then `finish_run {runId, status, reason?, prUrl?}`. `succeeded` needs the MR/stage output; otherwise `failed` or `needs_human` with a reason.
5. Plan gate: `approve {ticket, gate:'plan'}` is the only way to approve through MCP.

Switch away: `release_run {runId}` puts the Run back to `awaiting_session`; `release_run {runId, takeover:'autonomous'}` hands it to the Runner.

## What the factory does meanwhile

Polls the Ticket source, keeps Ticket state and labels current, records every tool call (argument names and hash, never payloads) in `tool_calls`, shows Steps, evidence and the worklog on the Run page. It queues no agent for a session Run.

## Heartbeat rule

Call `heartbeat` at least every 10 minutes; only that tool counts. A session Run without a heartbeat for 30 minutes (unclaimed `awaiting_session` Runs: since creation) goes `needs_human`.
