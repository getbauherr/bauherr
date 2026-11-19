# @bauherr/runner

Primitives for running a coding agent on a repository. Private; dependency: `@anthropic-ai/claude-agent-sdk` 0.3.312 (pinned).

- `cloneRepo`, `commitAndPush`, `mergeBase`, `patchId`, `git` (`src/clone.ts`): shallow clone into a temp dir; the Git token travels only via `GIT_CONFIG_*` on the Runner's own git commands.
- `startProxy` (`src/proxy.ts`): localhost proxy that injects `Authorization: Bearer <gateway key>` and the `X-Bauherr-*` headers. The agent env (`agentEnv`) is `PATH`, `HOME`, `ANTHROPIC_BASE_URL` and a dummy key.
- `buildOptions`, `runAgent` (`src/agent.ts`): Agent SDK options with the write-scope and egress guards (`src/guards.ts`), tool-call and Step records, and spin detection.

## Develop
```sh
pnpm --filter @bauherr/runner test   # tsc + node:test; runs the real SDK binary against a stub gateway
```
