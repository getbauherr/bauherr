# Session mode

A stage can run in **session** mode: the Run waits as `awaiting_session` until your own Claude Code session claims it over the factory MCP server (`/mcp`). You work in your local worktree with your own credentials; the factory only keeps the record. Default is `autonomous` (the Runner spawns an agent).

## Choose the mode

First match wins: `Workspace.modeByStage` (JSON, e.g. `{"plan":"session","build":"session"}`) · `Workspace.defaultMode` · env `BAUHERR_DEFAULT_MODE` · `mode:` on the stage in `pack/workflow.yaml` · `autonomous`.

## Connect

1. Admin UI → Bauherren → your user → enable API key → save, copy the key. Set `githubLogin` (assigned to the Ticket on claim; else `BAUHERR_BOT_LOGIN`).
2. Export `BAUHERR_TOKEN=<key>` and add to the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "bauherr": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${BAUHERR_TOKEN}" }
    }
  }
}
```

The token acts as you, inside your Workspaces only.

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
