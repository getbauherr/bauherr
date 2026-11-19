import { createHash } from 'node:crypto';
import { query, type HookCallbackMatcher, type Options, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { egressGuard, writeScopeGuard, type Decision } from './guards.js';
import type { StepRecord, ToolCallRecord } from './types.js';

export type AgentState = {
  toolCalls: ToolCallRecord[];
  steps: StepRecord[];
  result?: SDKResultMessage;
  results: SDKResultMessage[];
  abort: AbortController;
  budgetExhausted?: boolean;
  stuck?: string;
  spin?: { key: string; n: number };
};

export type AgentOptions = {
  runId: string;
  model: string;
  cwd: string;
  home: string;
  proxyUrl: string;
  instructions: string;
  maxTurns: number;
  maxBudgetUsd: number;
  readOnly?: boolean;
  writablePaths?: string[];
};

export const SPIN_LIMIT = 3;

export function trackSpin(state: AgentState, tool: string, input: unknown, exitCode: number, output: unknown): string | undefined {
  if (tool !== 'Bash') {
    state.spin = undefined;
    return undefined;
  }
  const command = String((input as { command?: string }).command ?? '');
  const key = `${command}\0${exitCode}\0${createHash('sha256').update(JSON.stringify(output) ?? '').digest('hex')}`;
  state.spin = { key, n: state.spin?.key === key ? state.spin.n + 1 : 1 };
  return state.spin.n >= SPIN_LIMIT ? `Spinning: \`${command.slice(0, 200)}\` ran ${SPIN_LIMIT} times in a row with exit code ${exitCode} and identical output` : undefined;
}

const DISALLOWED = [
  'WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(curl:*)', 'Bash(wget:*)',
  'Bash(ssh:*)', 'Bash(printenv:*)', 'Bash(env)', 'Bash(env:*)',
];

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

export function agentEnv(home: string, proxyUrl: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_API_KEY: 'proxy',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

export function buildOptions(o: AgentOptions, state: AgentState): Options {
  const gatewayHost = new URL(o.proxyUrl).host;
  const owned = o.writablePaths ?? [];
  const record = (r: Omit<ToolCallRecord, 'runId'>) => state.toolCalls.push({ runId: o.runId, ...r });

  const hooks: Options['hooks'] = {
    PreToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [async (i) => preToolUse(i.hook_event_name === 'PreToolUse'
          ? writeScopeGuard(o.cwd, (i.tool_input as { file_path?: string }).file_path, owned)
          : { allow: true })],
      },
      {
        matcher: 'Bash|WebFetch|WebSearch',
        hooks: [async (i) => preToolUse(i.hook_event_name === 'PreToolUse'
          ? egressGuard(i.tool_name, i.tool_input as { command?: string; url?: string }, gatewayHost)
          : { allow: true })],
      },
    ] satisfies HookCallbackMatcher[],
    PostToolUse: [{
      hooks: [async (i) => {
        if (i.hook_event_name === 'PostToolUse') {
          record({ toolUseId: i.tool_use_id, tool: i.tool_name, input: i.tool_input, ok: true, durationMs: i.duration_ms, ...(i.tool_name === 'Bash' ? { exitCode: 0 } : {}) });
          stopIfSpinning(state, trackSpin(state, i.tool_name, i.tool_input, 0, i.tool_response));
        }
        return {};
      }],
    }],
    PostToolUseFailure: [{
      hooks: [async (i) => {
        if (i.hook_event_name === 'PostToolUseFailure') {
          const code = /Exit code (\d+)/.exec(i.error)?.[1];
          record({ toolUseId: i.tool_use_id, tool: i.tool_name, input: i.tool_input, ok: false, durationMs: i.duration_ms, ...(i.tool_name === 'Bash' ? { exitCode: code ? Number(code) : 1 } : {}) });
          stopIfSpinning(state, trackSpin(state, i.tool_name, i.tool_input, code ? Number(code) : 1, i.error));
        }
        return {};
      }],
    }],
  };

  return {
    cwd: o.cwd,
    model: o.model,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: o.instructions },
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: 'dontAsk',
    tools: o.readOnly ? ['Read', 'Grep', 'Glob', 'Write'] : ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    allowedTools: o.readOnly
      ? ['Read', 'Grep', 'Glob', 'Write']
      : ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(npm test:*)', 'Bash(npm run:*)'],
    disallowedTools: DISALLOWED,
    maxTurns: o.maxTurns,
    maxBudgetUsd: o.maxBudgetUsd,
    persistSession: false,
    abortController: state.abort,
    env: agentEnv(o.home, o.proxyUrl),
    hooks,
  };
}

export async function runAgent(runId: string, options: Options, prompt: string, state: AgentState): Promise<void> {
  const seen = new Set<string>();
  try {
    for await (const m of query({ prompt, options })) {
      if (m.type === 'assistant' && m.parent_tool_use_id === null && !seen.has(m.message.id)) {
        seen.add(m.message.id);
        const u = m.message.usage;
        state.steps.push({
          runId, messageId: m.message.id, model: m.message.model,
          inputTokens: u.input_tokens, outputTokens: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
        });
      } else if (m.type === 'result') {
        state.result = m;
        state.results.push(m);
      }
    }
  } catch (e) {
    if (!state.budgetExhausted && !state.stuck) throw e;
  }
}
