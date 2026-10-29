# Runner execution model

Ticket: getbauherr/bauherr#8. Researched 2026-10-29 against `@anthropic-ai/claude-agent-sdk` 0.3.312
(bundles Claude Code 2.1.312, `npm view` latest), `payload` 3.92.1.
Tags: **[verified]** = ran against a local stub HTTP server (fake key, no real API call); **[docs]** = official
docs; **[types]** = `sdk.d.ts` only; **[unverified]** = inference.

## 1. Option set for a Run

```ts
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: runPrompt,                         // built by Runner from Ticket + Knowledge
  options: {
    cwd: workDir,                            // fresh clone, see 3
    model: product.model,                    // from Workspace/Product config
    systemPrompt: { type: "preset", preset: "claude_code", append: bauherrContext },
    settingSources: [], strictMcpConfig: true,   // ignore repo/user .claude/* and .mcp.json, see below
    mcpServers: { forge: createSdkMcpServer({ name: "forge", tools: [/* adapter tools */] }) },

    permissionMode: "dontAsk",               // deny unless pre-approved; no prompts in headless
    permissionPrompts: "none",               // [types] nobody answers prompts
    tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],   // removes all other tools from the model's schema
    allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "mcp__forge__*",
      "Bash(npm test:*)", "Bash(npm run:*)", "Bash(git status:*)", "Bash(git diff:*)",
      "Bash(git add:*)", "Bash(git commit:*)"],
    disallowedTools: [                       // scoped rules are denied in every mode [docs]
      "WebFetch", "WebSearch", "Bash(git push:*)", "Bash(curl:*)", "Bash(wget:*)",
      "Bash(ssh:*)", "Bash(printenv:*)", "Bash(env)", "Read(/proc/**)", "Read(/etc/**)"],
    maxTurns: run.maxTurns,                  // e.g. 60; result.subtype "error_max_turns"
    maxBudgetUsd: run.maxBudgetUsd,          // client estimate, can overshoot; hard cap = gateway key budget
    abortController: runAbort,               // wall-clock timeout owned by Runner
    persistSession: false,                   // v0.1: Ticket is the state, not the transcript
    env: {                                   // REPLACES the child env [docs+verified]; never spread process.env
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: perRunTmpDir,                    // [verified] works; keeps ~/.claude out of the picture
      ANTHROPIC_BASE_URL: gateway.url,
      ANTHROPIC_API_KEY: workspaceConsumerKey,
      ANTHROPIC_CUSTOM_HEADERS: `X-Bauherr-Run: ${run.id}`,   // [verified] forwarded; gateway attribution
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1", // needs bwrap + socat; fails closed if missing [verified]
    },
    sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false },
    hooks: {
      PreToolUse:  [{ hooks: [recordStepStart, enforceWrites] }],
      PostToolUse: [{ hooks: [recordStepEnd] }],
      PostToolUseFailure: [{ hooks: [recordStepError] }],
      SubagentStart: [{ hooks: [recordSubagent] }], SubagentStop: [{ hooks: [recordSubagent] }],
    },
  },
});
```

- `allowedTools` only auto-approves; it does not restrict [docs; verified: `Bash` stayed in the model's tool
  list]. Restriction = `tools: [...]` [verified: `tools:['Read','Grep','Glob','Edit','Write']` removed `Bash`
  from both the init message and the request].
- `permissionMode`: `default | acceptEdits | bypassPermissions | plan | dontAsk | auto` [types]. `dontAsk`
  [verified]: a non-allowed `Bash` (`curl -o x ...`) was denied, `PreToolUse` still fired, denial listed in
  `result.permission_denials`.
- **Read-only Bash is auto-approved under `dontAsk`** [verified: `echo hi` ran with no Bash allow rule]. The
  allow list is therefore not a boundary for Bash; the `PreToolUse` hook, env scrub and OS isolation (4) are.
- `maxBudgetUsd` stops on a client-side estimate and "can overshoot" [docs]; it uses a bundled list-price table
  (`modelUsage[m].costBasis: "list"` [verified]). Subtype on hit: `error_max_budget_usd`. The gateway per-key
  budget is the enforced cap.
- `settingSources: []` = SDK isolation mode; CLAUDE.md loads only with `'project'` [types]. Repo
  `.claude/settings.json` can carry command hooks that "run outside" the sandbox [docs/sandboxing], so a Product
  repo is untrusted input. The Runner reads `CLAUDE.md` / skills itself and injects them via `systemPrompt.append`.
- `PreToolUse` deny: `{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
  permissionDecisionReason } }`; deny > defer > ask > allow; a hook timeout blocks the call [docs/agent-sdk/hooks].
- Hooks may not fire when `maxTurns` ends the session [docs]; finalize from the `result` message / `finally`.

### `enforceWrites` (writes only via adapters)

`PreToolUse`, no matcher; deny when any of:

1. `Write|Edit|NotebookEdit`, or `Read|Glob|Grep` with a path whose `realpath` is outside `cwd` or inside `cwd/.git/`.
2. `Bash` command matches `\b(git\s+(push|remote|config|credential)|gh|glab|curl|wget|ssh|scp|nc)\b`
   or touches `.git/hooks`.
3. Any `mcp__*` tool not in the allow set.

Forge-visible writes (push, MR, Ticket Comment, Label, Claim) are done only by (a) the Runner after the agent exits
(push + MR) or (b) in-process MCP tools from `createSdkMcpServer` ([types], sdk.d.ts:639) that call the Forge
adapter in the Runner process. The agent process never holds a forge credential. Regexes on Bash are best-effort
(an agent can obfuscate); the real guarantee is "no forge credential and no route to the forge for the agent" (4).

## 2. Process model

**Recommendation: separate worker process/container running `payload jobs:run`, one Run per Payload job, Run
state in Bauherr's own `runs` / `steps` collections (the job is only the trigger). No container per Run in v0.1.**

Evidence (payload 3.92.1 source `dist/queues/operations/runJobs/index.js`; docs payloadcms.com/docs/jobs-queue/queues):

- Default is `autoRun` cron inside the Next server (docs: not for serverless).
- Claim = update `processing: true` where runnable (line ~125-170), then `Promise.all` over up to `limit` jobs
  (default 10; `sequential` opt-out; line ~392-398). No SKIP LOCKED.
- **No reaper for stale `processing: true`**: docs only say "Worker may have crashed". A restart/deploy of the Next
  server mid-Run leaves the job `processing` forever.
- Agent Runs last minutes to an hour, cost money, are not idempotent; in-process they die on every Next deploy.
- Documented production runner: `payload jobs:run --cron ... --queue runs --limit N` (also `--handle-schedules`,
  `--all-queues`); scaling via `ENABLE_JOB_WORKERS=true`.

Design:

- Queue `runs`; worker `payload jobs:run --cron "* * * * *" --queue runs --limit <N>`; no `autoRun` on the web app.
- One active Run per Ticket: `jobs.enableConcurrencyControl: true` and workflow
  `concurrency: { key: ({ input }) => "ticket:" + input.ticketId }` (exclusive defaults true; adds indexed
  `concurrencyKey`, needs a migration) [docs/workflows].
- `retries: 0` on the run task. A failed Run is terminal; retry = new Run row (explicit, visible, billed once).
  Pure infra steps before the first agent turn (clone) may retry inside the task.
- Heartbeat: Runner writes `runs.heartbeatAt` every ~15 s; a startup/cron sweeper marks Runs with a stale heartbeat
  `failed(worker-lost)` and clears the job's `processing`. Required because Payload has no reaper.
- `deleteJobOnComplete`: default `true` (config/defaults.js:64; deletes only successfully completed jobs, runJobs
  line 400). **Set `false`** for v0.1: audit and cost live in `runs`/`steps`, but job rows are the only record of
  Payload-level attempts (`totalTried`, `hasError`, `log`, `taskStatus`) and of a stuck `processing`. Add a
  retention prune for completed jobs (e.g. 30 d); never auto-prune `runs`/`steps`.
- Container-per-Run (`spawnClaudeCodeProcess` [types, sdk.d.ts:2522] into `docker run`) needs a Docker socket in
  the worker (root-equivalent) or a remote scheduler. Defer; the uid split in 4 gets most of the value.

## 3. Clone / worktree lifecycle

**Recommendation v0.1: fresh shallow clone per Run into `$RUNS_DIR/<runId>`, deleted in `finally`; no cached bare
repo.** Worktrees share `.git` (objects, config, hooks), so an agent could poison later Runs of the same
Repository; a fresh clone avoids lock/gc/prune logic at the cost of clone time. Later optimisation: read-only bare
mirror plus `git clone --reference <mirror> --dissociate` (independent `.git`), not `git worktree`.

- Clone: `git clone --depth 50 --no-tags <url-without-userinfo> $dir`, then `git switch -c bauherr/<ticket>-<run>`.
- Cleanup: `rm -rf` in `finally`; startup sweeper deletes dirs without a live Run.
- **Git credential never on disk, never in the agent env.** Runner spawns `git` with
  `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraheader GIT_CONFIG_VALUE_0="Authorization: ..."` (host-scoped key
  `http.<url>.extraheader` preferred), or `GIT_ASKPASS` pointing at a script echoing a var set only on that spawn.
  [verified locally] with `GIT_CONFIG_*` the value shows as origin `command line` and is not written to
  `.git/config`. Do not use `git clone -c http.extraheader=...`: `-c` on clone persists into the new repo's config.
- Publishing: Runner, after the agent exits, same env-only credential, explicit refspec
  `HEAD:refs/heads/bauherr/<ticket>-<run>`, `-c core.hooksPath=/dev/null`, then the MR via the Forge adapter;
  pre-publish gates (diff size, protected paths such as CI config) run Runner-side.
- The SDK env scrub "leaves GitHub tokens and proxy settings in place" [docs/env-vars]: never put a forge token in
  `options.env`.

## 4. Sandboxing

SDK offers (`Options.sandbox`, sdk.d.ts:3554; docs code.claude.com/docs/en/sandboxing):

- Linux: `bubblewrap` + `socat`; wraps **Bash/Monitor subprocesses only**. "Claude's file tools, MCP servers, and
  hooks run outside it." Writes default to cwd + temp; **reads default to most of the machine** (narrow with
  `filesystem.denyRead`/`allowRead`); network via allow-list proxy (`network.allowedDomains`, empty by default).
- `failIfUnavailable` defaults to false: missing deps silently mean unsandboxed Bash. Set `true`.
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips credentials from Bash/hook/stdio-MCP child envs (by variable name or
  value). [verified] fail-closed: bwrap present, `socat` missing: Bash returned "Sandbox is required but failed to
  initialize ... socat not installed" and did not run. [unverified] that custom-named secrets are stripped once
  socat is installed.
- **[verified] leak without scrub**: Bash `env` inside the SDK child printed `ANTHROPIC_API_KEY`,
  `ANTHROPIC_BASE_URL` and an arbitrary `BAUH_SECRET` passed through `options.env`. Everything in `options.env` is
  agent-readable. Only the gateway consumer key goes in.
- In an unprivileged container bwrap cannot mount `/proc`; it needs `enableWeakerNestedSandbox: true` (exposes
  container process info). In Docker, the container is the real boundary.
- Not covered: file-tool path scope beyond permission rules (hence `enforceWrites`), same-uid
  `/proc/<pid>/environ`, kernel isolation, resource limits.

**Minimal viable v0.1 (Postgres-only, one worker image):**

1. Worker container hardened per code.claude.com/docs/en/agent-sdk/secure-deployment: `--cap-drop ALL` (add
   `SETUID`,`SETGID` for item 2), `no-new-privileges`, `--read-only` root, size-capped tmpfs `$RUNS_DIR`, `--memory`,
   `--pids-limit`.
2. **uid split**: Payload worker runs as uid A (holds `DATABASE_URL`, forge tokens); the agent `claude` process is
   spawned as uid B via `spawnClaudeCodeProcess` (`child_process.spawn(command, args, { uid, gid, cwd, env })`), so
   `/proc/<worker>/environ` and worker files are unreadable to it. `$RUNS_DIR/<runId>` is chowned to B.
   [unverified: needs a root-started container.]
3. Egress: uid B may reach only the gateway (plus registries a Product needs) via container network policy or
   proxy; no route to Postgres or the forge. Without this, assume the agent can exfiltrate whatever it can read.
4. `sandbox.enabled` + `failIfUnavailable` + `ENV_SCRUB` where bwrap and socat work; else rely on 1-3.
5. Gateway consumer key per Workspace, spend/token-capped at the gateway (agentgateway "Cap LLM spend per API key
   in dollars or tokens"); prefer short-lived per-Run keys if the gateway can mint them.

## 5. Auth through the gateway

[verified] stub server on 127.0.0.1, bundled native binary (`@anthropic-ai/claude-agent-sdk-linux-x64`), temp
`HOME`, `settingSources: []`:

| env | wire |
|---|---|
| `ANTHROPIC_BASE_URL=http://stub` | `POST /v1/messages?beta=true`, `stream: true` |
| `ANTHROPIC_API_KEY=k` | `x-api-key: k`; init `apiKeySource: "ANTHROPIC_API_KEY"` |
| `ANTHROPIC_AUTH_TOKEN=t` | `Authorization: Bearer t`; `apiKeySource: "none"` |
| `ANTHROPIC_CUSTOM_HEADERS="X-Bauherr-Run: id"` | forwarded on every request |

Also sent: `user-agent: claude-cli/2.1.312 (external, sdk-ts, agent-sdk/0.3.312)`, `anthropic-version`,
`x-claude-code-session-id`, `anthropic-beta: claude-code-20250219,interleaved-thinking-2025-05-14,
context-management-2025-06-27,per-turn-control-2026-07-01,... (9 values)`.
The gateway must pass `anthropic-beta` and `anthropic-version` through and speak Messages-API SSE on
`/v1/messages`; the beta list changes per SDK release, so pin the SDK. With
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` only `/v1/messages` was requested. Docs: `ANTHROPIC_BASE_URL` routes
"through a proxy or gateway"; `ANTHROPIC_API_KEY` overrides a logged-in subscription in non-interactive mode
(code.claude.com/docs/en/env-vars).

Subscription (OAuth): mechanically possible (`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`), **not
recommended**. Legal page: developers "including those using the Agent SDK, should use API key authentication through
Claude Console or a supported cloud provider"; no routing through "Free, Pro, or Max plan credentials on behalf of
their users"; no collecting or intermediating Claude.ai credentials (code.claude.com/docs/en/legal-and-compliance).
So the LLM-gateway Connection is an API key (or a Bedrock/Vertex/Foundry credential held by the gateway), never a
stored OAuth token, and a Workspace's consumer key must map to a provider key its operator owns.

## 6. Usage / cost per Step

From SDK messages [docs/cost-tracking; field names verified on stub]:

- Step = one `SDKAssistantMessage`, key `message.message.id`; parallel tool calls share an `id` and usage: count
  once. Skip `parent_tool_use_id != null` (subagents) for main-loop sums.
- `message.message.usage`: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` are accurate per
  step; **per-step `output_tokens` is a placeholder** (the `message_start` value). Exact per-step output needs
  `includePartialMessages: true` and `message_delta` usage, or the gateway's per-request log.
- Tool calls: `tool_use` blocks (`id`, `name`, `input`); correlate with hooks by `tool_use_id`. Denials:
  `result.permission_denials[]` (`tool_name`, `tool_use_id`, `tool_input`) [verified].
- Result message (`type: "result"`) [types sdk.d.ts:5948,6015]: `subtype` (`success | error_during_execution |
  error_max_turns | error_max_budget_usd | error_max_structured_output_retries`), `num_turns`, `duration_ms`,
  `duration_api_ms`, `total_cost_usd`, `usage` (main loop only, excludes subagents), `modelUsage[model]` =
  `{inputTokens, outputTokens, thinkingTokens?, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests,
  costUSD, contextWindow, maxOutputTokens, costBasis}` (+5m/1h cache-write splits). Use `modelUsage` / `total_cost_usd` for whole-tree accounting
  (they include subagents). Read them on error results too; after a crash they may be zeroed; on
  `error_max_budget_usd`, `usage` omits the last response but `total_cost_usd` includes it.
- All client-side list-price estimates, "not authoritative billing data" [docs].

What agentgateway adds (docs agentgateway.dev/docs/standalone/latest/documentation/llm/{cost-controls,observability}):

- Authoritative token metric `agentgateway_gen_ai_client_token_usage` (histogram; labels `gen_ai_token_type`
  input|output, `gen_ai_request_model`, `gen_ai_response_model`, `gen_ai_system`, `gen_ai_operation_name`).
- Log/CEL fields `gen_ai.usage.input_tokens|output_tokens`, `llm.cachedInputTokens`,
  `llm.cacheCreationInputTokens`, `llm.providerInputTokens`, and realized cost `agw.ai.usage.cost.total` from a
  model cost catalog. Anthropic reports input excluding cached tokens; the gateway normalizes it
  (`llm.inputTokens` includes cache): do not add the cache fields on top.
- Per-key budgets in $ or tokens (enforced). Not stated in the pages read: native `/v1/messages` streaming-usage
  parsing; per-Run labels (`X-Bauherr-Run` is a join key if request headers can be logged) [unverified].
- Plan: Step rows from the SDK; Run cost reconciled from the gateway via `X-Bauherr-Run` when available, else the
  SDK estimate flagged `sdk-estimate`.

## 7. Multi-agent (later)

Primitive: `Options.agents: Record<string, AgentDefinition>` (`description`, `prompt` required;
`tools`, `model`, `maxTurns`, ... optional) via the built-in `Agent` tool; hooks `SubagentStart`/`SubagentStop`
(inputs carry `agent_id`); `modelUsage` and `total_cost_usd` include subagents, `usage` does not; depth/concurrency/
spend caps in code.claude.com/docs/en/agent-sdk/subagents. Subagents live inside a Run; more Runs are for Sub-tickets.

## Open risks
1. Same-uid secret exposure (worker env, `/proc`) until the uid split (4.2) is built and tested as root.
2. `dontAsk` still auto-approves read-only Bash; `enforceWrites` regexes are bypassable; no egress control yet.
3. Payload has no stale-`processing` reaper (Bauherr owns heartbeat + sweeper); `jobs:run` read from source/docs,
   not run end to end.
4. SDK is 0.x and its bundled CLI's `anthropic-beta` set changes per release: pin it, keep a gateway contract test.
5. `maxBudgetUsd` / `total_cost_usd` are list-price estimates; real spend control = gateway key budget.
6. Env-scrub efficacy for custom-named secrets and `permissionPrompts: "none"` not run; OAuth path is policy-blocked.
