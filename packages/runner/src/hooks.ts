import { createHash } from 'node:crypto';
import type { HookCallbackMatcher, Options } from '@anthropic-ai/claude-agent-sdk';
import type { AgentOptions, AgentState } from './agent.js';
import { egressGuard, writeScopeGuard, type Decision } from './guards.js';
import type { ToolCallRecord } from './types.js';

export const SPIN_LIMIT = 3;

export function trackSpin(
  state: AgentState,
  tool: string,
  input: unknown,
  exitCode: number,
  output: unknown,
): string | undefined {
  if (tool !== 'Bash') {
    state.spin = undefined;
    return undefined;
  }
  const command = String((input as { command?: string }).command ?? '');
  const outputHash = createHash('sha256')
    .update(JSON.stringify(output) ?? '')
    .digest('hex');
  const key = `${command}\0${exitCode}\0${outputHash}`;
  state.spin = { key, n: state.spin?.key === key ? state.spin.n + 1 : 1 };
  const ran = `ran ${SPIN_LIMIT} times in a row with exit code ${exitCode} and identical output`;
  return state.spin.n >= SPIN_LIMIT ? `Spinning: \`${command.slice(0, 200)}\` ${ran}` : undefined;
}

const stopIfSpinning = (state: AgentState, reason: string | undefined) => {
  if (!reason) return;
  state.stuck = reason;
  state.abort.abort();
};

const preToolUse = (d: Decision) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse' as const,
    permissionDecision: d.allow ? ('allow' as const) : ('deny' as const),
    permissionDecisionReason: d.allow ? 'in scope' : d.reason,
  },
});

const guardHooks = (o: AgentOptions): HookCallbackMatcher[] => {
  const gatewayHost = new URL(o.proxyUrl).host;
  const owned = o.writablePaths ?? [];
  return [
    {
      matcher: 'Edit|Write',
      hooks: [
        async (i) =>
          preToolUse(
            i.hook_event_name === 'PreToolUse'
              ? writeScopeGuard(o.cwd, (i.tool_input as { file_path?: string }).file_path, owned)
              : { allow: true },
          ),
      ],
    },
    {
      matcher: 'Bash|WebFetch|WebSearch',
      hooks: [
        async (i) =>
          preToolUse(
            i.hook_event_name === 'PreToolUse'
              ? egressGuard(i.tool_name, i.tool_input as { command?: string; url?: string }, gatewayHost)
              : { allow: true },
          ),
      ],
    },
  ];
};

const resultHooks = (
  o: AgentOptions,
  state: AgentState,
): Pick<NonNullable<Options['hooks']>, 'PostToolUse' | 'PostToolUseFailure'> => {
  const record = (r: Omit<ToolCallRecord, 'runId'>) => state.toolCalls.push({ runId: o.runId, ...r });
  return {
    PostToolUse: [
      {
        hooks: [
          async (i) => {
            if (i.hook_event_name === 'PostToolUse') {
              record({
                toolUseId: i.tool_use_id,
                tool: i.tool_name,
                input: i.tool_input,
                ok: true,
                durationMs: i.duration_ms,
                ...(i.tool_name === 'Bash' ? { exitCode: 0 } : {}),
              });
              stopIfSpinning(state, trackSpin(state, i.tool_name, i.tool_input, 0, i.tool_response));
            }
            return {};
          },
        ],
      },
    ],
    PostToolUseFailure: [
      {
        hooks: [
          async (i) => {
            if (i.hook_event_name === 'PostToolUseFailure') {
              const code = /Exit code (\d+)/.exec(i.error)?.[1];
              record({
                toolUseId: i.tool_use_id,
                tool: i.tool_name,
                input: i.tool_input,
                ok: false,
                durationMs: i.duration_ms,
                ...(i.tool_name === 'Bash' ? { exitCode: code ? Number(code) : 1 } : {}),
              });
              stopIfSpinning(state, trackSpin(state, i.tool_name, i.tool_input, code ? Number(code) : 1, i.error));
            }
            return {};
          },
        ],
      },
    ],
  };
};

export const buildHooks = (o: AgentOptions, state: AgentState): Options['hooks'] => ({
  PreToolUse: guardHooks(o),
  ...resultHooks(o, state),
});
