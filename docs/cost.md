# Tokens and cost

Where the numbers come from, how a Claude Code session reports its own, and what they cover. They are shown on Insights › Cost & tokens (`/insights#cost`), per session and role on the Team page, per Run on the Run page, and to the chat as `cost_summary`.

## One table

`usage_entries` answers "tokens and cost of X": `workspace`, `run?`, `session?`, `ticket?`, `stage?`, `role?`, `model`, `provider`, `tokensIn`, `tokensOut`, `cacheRead?`, `cacheWrite?`, `costUsd` (null = tokens without a price), `source`, `at`. Unique per (`run`, `source`, `model`).

| `source` | Written by | Idempotency |
|---|---|---|
| `gateway` | `reconcile-costs`: one row per model of the Run, summed from the gateway `request_logs` (`attributes_json->>'run'`) | the row is replaced, a re-reconcile never adds |
| `session-reported` | a session: `usage` on `heartbeat`, `finish_run`, `submit_review`, `submit_triage` (cumulative for the Run), or the usage hook | `usage`: maximum of the cumulative reports; hook: cursor per Claude session |
| `chat` | not stored: `chat_messages.answer` (`model`, `tokensIn`, `tokensOut`, `costUsd`) is read at query time | n/a |

A Run priced by the gateway ignores its `session-reported` rows (the gateway is exact), so nothing counts twice. `runs.costUsd` and the token fields stay in sync: a session report copies its sum into the Run (`costSource: session-reported`) unless the gateway already priced it. Settings › AI usage keeps the budget and the cost per Product and links here.

## What a Claude Code session can report

From the Claude Code documentation:

- Status line ([statusline](https://code.claude.com/docs/en/statusline)): the command gets JSON on stdin with `cost.total_cost_usd` ("Estimated session cost in USD, computed client-side at list price"), `session_id` and `transcript_path`. Its token fields (`context_window.total_input_tokens`, `context_window.total_output_tokens`) are "currently in the context window", not cumulative, so it cannot give session totals.
- Hooks ([hooks](https://code.claude.com/docs/en/hooks)): every hook input has `session_id` and `transcript_path` ("Path to conversation JSON"). The transcript is a JSONL file; each assistant line carries `message.id`, `message.model` and `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`). A message is written on several lines with the same id and usage, so count one per id. The docs warn the transcript "may lag the in-memory conversation".
- OpenTelemetry ([monitoring](https://code.claude.com/docs/en/monitoring-usage)): `claude_code.token.usage` (attribute `type`: `input`, `output`, `cacheRead`, `cacheCreation`; `model`) and `claude_code.cost.usage`, both with the standard attribute `session.id`. Needs `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an OTLP collector the factory does not run.

Chosen: a `Stop` hook that reads the transcript. It needs no collector, sees exact per-message usage per model, and needs only the agent key the session already has. OpenTelemetry is the better source for a fleet but needs infrastructure; the status line has cost but no totals.

## The usage hook

`pack/hooks/report-usage.ts` runs after each turn (`Stop`). It sums the transcript per model and posts the cumulative totals to `POST /api/usage` with the agent key. The server stores only the delta since the last report of that Claude session (a repeat adds 0) on the Run the session holds now, or on a Run-less row of the session between Runs, and prices tokens at list price from the gateway catalogs (`deploy/gateway/catalogs`). History from before the factory session (the Claude session began more than 15 minutes before `connect`) is the baseline and not counted.

Install: copy the script somewhere stable, set two variables in the shell that starts Claude Code, and add the hook to `~/.claude/settings.json`:

```bash
export BAUHERR_URL=https://bauherr.example.com   # PUBLIC_URL of the factory
export BAUHERR_AGENT_KEY=<the bha_ key of the MCP connection>
export BAUHERR_SESSION=<the session key you pass to connect>   # only with several sessions on one key
```

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "node /path/to/report-usage.ts" }] }] } }
```

The hook never fails the session and never prints the key. Once it has reported, the server ignores `usage` arguments of that session (the hook is exact).

## Without the hook

`connect` tells the session to pass `usage {tokensIn, tokensOut, cacheRead, cacheWrite, costUsd, model}` on `heartbeat` and `finish_run` (and `submit_review`, `submit_triage`), cumulative for the Run so far. A model has to remember it, so coverage depends on the session.

## Gateway attribution of session calls

Claude Code on the owner's machine sends its calls through the bundled gateway with one consumer key per Workspace, so `request_logs` cannot tell sessions apart. The access log copies `x-bauherr-run`, `x-bauherr-stage`, `x-bauherr-product`, `x-bauherr-ticket` (`deploy/gateway/config.yaml.tmpl`), but `ANTHROPIC_CUSTOM_HEADERS` is fixed when Claude Code starts, so it cannot name the Run a session claims later. Not implemented: a per-session header would have to change per Run, which a fixed environment variable cannot do.

## Coverage and limits

Every breakdown table (model, role, session, stage) adds up to the total: usage without a role is its own row ("Runner, no role", "CI, no role", "Session, no role", "Chat"), usage without a stage is "Chat" or "No stage", and a missing model is "Not recorded" (Runs from before models were recorded). `cost_summary` uses the same labels.

Every number on the page shows how many finished Runs have usage ("82 % of session Runs (reported)"); a Run without usage counts as 0, not as unknown cost. Tokens without a catalog price add to the "unpriced" count and not to the cost. Subagent transcripts of Claude Code are separate files and are not summed by the hook. Chat cost covers answers stored with `answer.costUsd`. Runs from before this table are backfilled only when the gateway priced them.
