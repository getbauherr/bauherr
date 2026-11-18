# Session mode

In session mode a stage waits as `awaiting_session` until your own Claude Code session claims it over the factory MCP server at `/mcp`. You work in your local worktree with your own credentials. The factory keeps the record. The default is `autonomous`, where the Runner spawns an agent.

## Choose the mode

The first match wins:

1. `Workspace.modeByStage`, for example `{"plan":"session","build":"session"}`.
2. `Workspace.defaultMode`.
3. The environment variable `BAUHERR_DEFAULT_MODE`.
4. `mode:` on the stage in `pack/factory.yaml`.
5. `autonomous`.

## Connect

Create an agent key in the user menu under **API key** (`/settings/api-key`) and give it a label. It is shown once as a ready-made `claude mcp add` line. Set `githubLogin` on your user so the Ticket is assigned to you on claim. Without it the factory uses `BAUHERR_BOT_LOGIN`.

```bash
claude mcp add --transport http bauherr http://localhost:3000/mcp --header "Authorization: Bearer $(cat ~/.config/bauherr/mcp-key)"
```

The key acts as you, inside your Workspaces only.

For a headless setup, `pnpm seed` with `BAUHERR_MCP_KEY_FILE` set mints an agent key `seed` for the Admin. It writes the key with mode 0600 to that file and never prints it. Each seed run mints a new key, so revoke old ones in the UI. See [gateway smoke](https://github.com/getbauherr/bauherr/blob/main/docs/gateway-smoke.md).

### Agent identity

`/mcp` knows two kinds of caller. An agent key starts with `bha_`, and you can revoke each one alone. A personal key is a human credential, off by default. Never give it to an agent. An unknown token gets a 401.

Gate tools are human-only. An agent key gets `forbidden: <tool> needs a human` for `approve`, `accept_staging`, `grant_review_round`, `stop_review`, `request_changes`, `send_back` and `approve_production`. Gates stay in the UI, or in the forge for the plan label. The Run and every tool call record which key was used.

To replace an old personal key, mint an agent key and add the server again:

```bash
claude mcp remove bauherr && <the line shown once on /settings/api-key>
```

## Route your session through the gateway

The gateway budgets, logs and measures your session like the factory does. It bills your own Claude login. The legal line is in [legal](legal.md#owner-session-passthrough).

The easy way is the generated block under Settings, AI usage, Measure session cost, or on the Agent team page. It also sets the session name that `connect` receives. See [gateway](gateway.md).

To set it up by hand:

```bash
pnpm --filter server session:activate
pnpm --filter server session:deactivate
```

Activate merges the gateway settings into `~/.claude/settings.json` and backs up the old file. Deactivate restores the backup. Restart Claude Code afterwards. The cost then shows as "Unnamed gateway session", so prefer the generated block.

The session key has its own budget of `SESSION_BUDGET_USD` per rolling 30 days, default 100. It is audit only, so going over it logs a warning and never blocks you.

## Connect as a role

A session can join the factory's team. The factory file declares the roles under `team.roles`, and a role receives the Runs of the stages that name it. Start a Claude Code session with the MCP line above and give it this prompt, with a role id from your factory file:

```text
Connect to the factory as engineer and work until told to stop.
```

The server instructions tell the session the rest.

1. `connect {role, session?, label?}` registers the session and returns `sessionId`, the role's profile and stages, and `pollAfterSeconds`. An unknown role is refused with the valid ones. Connecting again with the same `session` name revives the session.
2. Loop `next_work {sessionId}`. It claims the next Run for your role, or answers `{work: null, reason}` with the reason nothing is queued.
3. Pass `sessionId` on every call so the Run is attributed to the session.
4. Call `disconnect {sessionId}` when you stop. Runs you hold go back to the queue.

The `/team` page shows roles, connected sessions and what each works on. See [UI](ui.md#agent-team).

An exceptions role, the Orchestrator by default, also receives stuck Tickets. `next_work` then answers with `exception {ticket, problem, since, allowed}`. The one repair an agent may make is `return_to_build {ticket, reason}`, when the MR is missing or its checks are red.

A session with no running Run and no call for `BAUHERR_SESSION_TIMEOUT_S`, default 600, ends as `timeout`.

## Work a Run

1. `claim_next` takes the top claimable Run in the owner's order, right to left from Release to Triage. `claim_run` then returns the `leaseToken`, once. Pass it on every later call on the Run. Run `load_skill run-contract` and `read_worklog` first.
2. Work in a local worktree. Use `update_worklog`, `report_step`, `attach_evidence` and `attach_artifact` as you go.
3. Write `Refs #N` in the MR body and commits, never `Closes` or `Fixes`. Only acceptance on staging closes a Ticket.
4. Call `request_review`, then `finish_run {runId, status, reason?, prUrl?}`. A `succeeded` Run needs its MR. Otherwise end it `failed` or `needs_human` with a reason.
5. A Review Run ends with `submit_review {runId, leaseToken, verdict, findings, checked, markdown}`. A review never edits code.
6. A custom `agent` stage ends with `finish_run` and an `outcome` from the claim payload.

The full rules are in the `run-contract` skill and the tool descriptions. To switch away, `release_run {runId, leaseToken}` returns the Run to the queue. Adding `takeover:'autonomous'` hands it to the Runner.

## Report usage

`heartbeat`, `finish_run`, `submit_review` and `submit_triage` accept an optional `usage` with token counts and cost. Repeats never double count. With the usage hook installed it is automatic. See [cost](cost.md).

## Heartbeat rule

Call `heartbeat` at least every 10 minutes. A running Run without one for 30 minutes is `abandoned` and another session can take it. A second abandonment in a row is `needs_human`. An `awaiting_session` Run nobody claims goes `needs_human` after 30 minutes. A person can release the lock on the Run page.
