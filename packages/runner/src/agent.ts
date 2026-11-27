import { query, type Options, type SDKAssistantMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildHooks } from './hooks.js';
import { runIdentity, spawnAsRunUser } from './identity.js';
import type { StepRecord, ToolCallRecord } from './types.js';

export { SPIN_LIMIT, trackSpin } from './hooks.js';

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

const DISALLOWED = [
  'WebFetch',
  'WebSearch',
  'Bash(git push:*)',
  'Bash(curl:*)',
  'Bash(wget:*)',
  'Bash(ssh:*)',
  'Bash(printenv:*)',
  'Bash(env)',
  'Bash(env:*)',
];

export function agentEnv(home: string, proxyUrl: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    TMPDIR: home,
    LANG: process.env.LANG ?? 'C.UTF-8',
    ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_API_KEY: 'proxy',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

export function buildOptions(o: AgentOptions, state: AgentState): Options {
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
      : [
          'Read',
          'Grep',
          'Glob',
          'Edit',
          'Write',
          'Bash(git status:*)',
          'Bash(git diff:*)',
          'Bash(git add:*)',
          'Bash(git commit:*)',
          'Bash(npm test:*)',
          'Bash(npm run:*)',
        ],
    disallowedTools: DISALLOWED,
    maxTurns: o.maxTurns,
    maxBudgetUsd: o.maxBudgetUsd,
    persistSession: false,
    abortController: state.abort,
    env: agentEnv(o.home, o.proxyUrl),
    hooks: buildHooks(o, state),
    ...(runIdentity(o.cwd) && { spawnClaudeCodeProcess: spawnAsRunUser }),
  };
}

const recordStep = (runId: string, m: SDKAssistantMessage, state: AgentState) => {
  const u = m.message.usage;
  state.steps.push({
    runId,
    messageId: m.message.id,
    model: m.message.model,
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  });
};

export async function runAgent(runId: string, options: Options, prompt: string, state: AgentState): Promise<void> {
  const seen = new Set<string>();
  try {
    for await (const m of query({ prompt, options })) {
      if (m.type === 'assistant' && m.parent_tool_use_id === null && !seen.has(m.message.id)) {
        seen.add(m.message.id);
        recordStep(runId, m, state);
      } else if (m.type === 'result') {
        state.result = m;
        state.results.push(m);
      }
    }
  } catch (e) {
    if (!state.budgetExhausted && !state.stuck) throw e;
  }
}
