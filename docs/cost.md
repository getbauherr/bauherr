# Tokens and cost

Insights › Cost & tokens (`/insights#cost`) shows these numbers. The Team page shows them per session and role, the Run page per Run, and the chat gets them as `cost_summary`.

## One table

`usage_entries` answers "tokens and cost of X". Its columns are `workspace`, `run?`, `session?`, `ticket?`, `stage?`, `role?`, `model`, `provider`, `tokensIn`, `tokensOut`, `cacheRead?`, `cacheWrite?`, `costUsd`, `source` and `at`. A null `costUsd` means tokens without a price. Rows are unique per `run`, `source` and `model`.

| `source` | Written by | Idempotency |
|---|---|---|
| `gateway` | `reconcile-costs` for Runner and CI Runs, one row per model, summed from the gateway `request_logs`. `watch-gateway` every minute for sessions; see [gateway.md](gateway.md#how-a-session-is-measured). | The Run row is replaced. Run-less rows of the last two days are replaced in one transaction. |
| `session-reported` | A session's `usage` on `heartbeat`, `finish_run`, `submit_review` or `submit_triage`, or the usage hook | `usage`: the maximum of the cumulative reports. Hook: a cursor per Claude session. |
| `chat` | Not stored. Read at query time from `chat_messages.answer`. | n/a |

The gateway is the primary source. The usage hook and the `usage` argument are the fallback for tools that cannot go through it. A Run priced by the gateway ignores its `session-reported` rows. So does every row of a session from its first gateway row on.

A session report copies its sum into `runs.costUsd` with `costSource: session-reported`, unless the gateway already priced the Run. Settings › AI usage keeps the budget and the cost per Product.

## Set up the gateway for sessions

Settings › AI usage › Measure session cost and the Agent team page generate the lines per coding tool. Which tools work, and how: [gateway.md](gateway.md). Calls without a session name show under "Unnamed gateway session".

## The usage hook

Without the gateway, a `Stop` hook reads the Claude Code transcript. It needs no collector and sees exact per-message usage per model.

`pack/hooks/report-usage.ts` runs after each turn (`Stop`) and when a subagent ends (`SubagentStop`). A subagent's transcript uses the session key `<session_id>:<agent_id>`, and most Run work happens there. The hook sums the transcript per model and posts cumulative totals to `POST /api/usage` with the agent key.

The server stores only the delta since the last report of that Claude session. It books the delta on the Run the session holds, or on a Run-less row between Runs. Tokens are priced at list price from `deploy/gateway/catalogs`. History from before `connect` is the baseline and not counted. A Claude session counts as earlier when it began more than 15 minutes before `connect`.

Install once per machine. `--project` writes `.claude/settings.json` of the current project instead of `~/.claude/settings.json`. Running it again changes nothing.

```bash
npx bauherr hook install
```

It copies the script next to the settings file and merges the `Stop` and `SubagentStop` entries. It writes no secrets. Set these in the shell that starts Claude Code:

```bash
export BAUHERR_URL=https://bauherr.example.com
export BAUHERR_AGENT_KEY=<the bha_ key of the MCP connection>
export BAUHERR_SESSION=<the session key you pass to connect>
```

`BAUHERR_URL` is the `PUBLIC_URL` of the factory. `BAUHERR_SESSION` is needed only with several sessions on one key.

`connect` adds a `notice` when the key's previous session finished Runs without ever reporting. The Ticket page's Cost block shows "N session Runs did not report usage" for those Runs instead of pricing them at $0. It labels a total "estimated" unless the gateway priced it.

The hook never fails the session and never prints the key. Once it has reported, the server ignores that session's `usage` arguments.

## Without the hook

`connect` tells the session to pass `usage {tokensIn, tokensOut, cacheRead, cacheWrite, costUsd, model}` on `heartbeat`, `finish_run`, `submit_review` and `submit_triage`. The values are cumulative for the Run so far. A model has to remember it, so coverage depends on the session.

## Other Claude Code sources

Not used, for these reasons:

- The [status line](https://code.claude.com/docs/en/statusline) gives `cost.total_cost_usd` but only context-window tokens, not session totals.
- [OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage) gives `claude_code.token.usage` and `claude_code.cost.usage` per `session.id`. It needs `CLAUDE_CODE_ENABLE_TELEMETRY=1` and an OTLP collector the factory does not run.

## Coverage and limits

Every breakdown table adds up to the total. Usage without a role is its own row: "Runner, no role", "CI, no role", "Session, no role" or "Chat". Usage without a stage is "Chat" or "No stage". A missing model is "Not recorded". `cost_summary` uses the same labels.

- Every number shows how many finished Runs have usage, such as "82 % of session Runs". A Run without usage counts as 0, not as unknown cost.
- Tokens without a catalog price add to the "unpriced" count, not to the cost. The count drops once the daily refresh knows the model; see [gateway.md](gateway.md#prices-and-models-update-themselves).
- When session Runs have little or no usage, the page says "Session cost is not measured" and links to the setup.
- Chat cost covers answers stored with `answer.costUsd`.
- Runs from before this table are backfilled only when the gateway priced them.
