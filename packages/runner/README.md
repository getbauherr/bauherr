# @bauherr/runner

Runs one Plan or Build stage of a Run (#8, #37). Standalone, private; deps: `@anthropic-ai/claude-agent-sdk` 0.3.312 (pinned).

```ts
import { runStage, type RunCtx, type RunResult } from '@bauherr/runner';
const result: RunResult = await runStage(ctx);
```

`runStage` never throws; infrastructure errors become `status: 'failed'`.

## Flow
1. Shallow clone into a temp dir, branch `bauherr/<ticket>-<run>`. Git token only via `GIT_CONFIG_*` on the Runner's own git commands.
2. Localhost proxy (`src/proxy.ts`) injects `x-api-key`, `X-Bauherr-Run`, `X-Bauherr-Stage`. The agent env is `PATH`, `HOME`, `ANTHROPIC_BASE_URL`, dummy key.
3. Materialise pack skills, `AGENTS.md`, `.bauherr/goal.json`, `.bauherr/worklog.md` (git-excluded).
4. `query()` with hooks: write-scope + egress guards (in-process ports of the pack hooks), Stop goal check, tool-call recording.
5. Plan: worklog is posted as a Ticket comment. Build: commit, push, PR with `## Evidence` from recorded Bash calls.

`ctx.connection.gitBaseUrl` (optional, default `https://github.com`) is the forge URL the repo path is appended to.

## Develop
```sh
npm install && npm test   # tsc + node:test; runs the real SDK binary against a stub gateway
```
Not covered: a real model run (see PR notes).
