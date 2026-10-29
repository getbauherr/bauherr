import { query, type HookCallbackMatcher, type Options, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { egressGuard, writeScopeGuard, type Decision } from './guards.js';
import { checkGoal, readGoal, type GoalVerdict } from './goal.js';
import { GOAL_FILE } from './materialise.js';
import type { RunCtx, StepRecord, ToolCallRecord } from './types.js';

export type AgentState = {
  blockedOnce: boolean;
  verdict?: GoalVerdict;
  toolCalls: ToolCallRecord[];
  steps: StepRecord[];
  result?: SDKResultMessage;
  abort: AbortController;
  budgetExhausted?: boolean;
};

const DISALLOWED = [
  'WebFetch', 'WebSearch', 'Bash(git push:*)', 'Bash(curl:*)', 'Bash(wget:*)',
  'Bash(ssh:*)', 'Bash(printenv:*)', 'Bash(env)', 'Bash(env:*)',
];

const preToolUse = (d: Decision) => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse' as const,
    permissionDecision: d.allow ? ('allow' as const) : ('deny' as const),
    permissionDecisionReason: d.allow ? 'in scope' : d.reason,
  },
});

/** The env object handed to the SDK child: replaces, never extends, the process env. */
export function agentEnv(home: string, proxyUrl: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_API_KEY: 'proxy',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

export function buildOptions(ctx: RunCtx, o: { cwd: string; home: string; proxyUrl: string; agentsMd: string }, state: AgentState): Options {
  const model = ctx.connection.modelByTier[ctx.run.tier];
  if (!model) throw new Error(`no model configured for tier ${ctx.run.tier}`);
  const gatewayHost = new URL(o.proxyUrl).host;
  const owned = (process.env.BAUHERR_LANE_OWNED_PATHS ?? '').split(':').filter(Boolean);
  const record = (r: Omit<ToolCallRecord, 'runId'>) => {
    const full = { runId: ctx.run.id, ...r };
    state.toolCalls.push(full);
    return ctx.recorder.toolCall(full);
  };

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
          await record({ toolUseId: i.tool_use_id, tool: i.tool_name, input: i.tool_input, ok: true, durationMs: i.duration_ms, ...(i.tool_name === 'Bash' ? { exitCode: 0 } : {}) });
        }
        return {};
      }],
    }],
    PostToolUseFailure: [{
      hooks: [async (i) => {
        if (i.hook_event_name === 'PostToolUseFailure') {
          const code = /Exit code (\d+)/.exec(i.error)?.[1];
          await record({ toolUseId: i.tool_use_id, tool: i.tool_name, input: i.tool_input, ok: false, durationMs: i.duration_ms, ...(i.tool_name === 'Bash' ? { exitCode: code ? Number(code) : 1 } : {}) });
        }
        return {};
      }],
    }],
    Stop: [{
      hooks: [async () => {
        const verdict = checkGoal(readGoal(`${o.cwd}/${GOAL_FILE}`), state.blockedOnce);
        state.verdict = verdict;
        if (verdict.kind === 'block') {
          state.blockedOnce = true;
          return { decision: 'block' as const, reason: verdict.reason };
        }
        return {};
      }],
    }],
  };

  return {
    cwd: o.cwd,
    model,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: o.agentsMd },
    settingSources: [],
    strictMcpConfig: true,
    skills: 'all',
    permissionMode: 'dontAsk',
    tools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(npm test:*)', 'Bash(npm run:*)'],
    disallowedTools: DISALLOWED,
    maxTurns: ctx.run.maxTurns,
    maxBudgetUsd: ctx.run.maxBudgetUsd,
    persistSession: false,
    abortController: state.abort,
    env: agentEnv(o.home, o.proxyUrl),
    hooks,
  };
}

export async function runAgent(ctx: RunCtx, options: Options, state: AgentState): Promise<void> {
  const prompt = ctx.run.stage === 'plan'
    ? `Plan Run for Ticket #${ctx.ticket.number}. Follow the run-contract and worklog skills. Write the plan to .bauherr/plan.md with the sections "## Goal" and "## Steps" (the Runner posts it and updates the worklog); set each statement in .bauherr/goal.json to verified (with evidence) or blocked (with reason). Do not implement.`
    : `Build Run for Ticket #${ctx.ticket.number}. Follow the run-contract skill. Implement the Goal in the working tree, run the checks, record the result of each Goal statement in .bauherr/goal.json (verified or blocked), and update .bauherr/worklog.md last. Commit your work with git commit; do not push.`;
  const seen = new Set<string>();
  try {
    for await (const m of query({ prompt, options })) {
      if (m.type === 'assistant' && m.parent_tool_use_id === null && !seen.has(m.message.id)) {
        seen.add(m.message.id);
        const u = m.message.usage;
        const step: StepRecord = {
          runId: ctx.run.id, messageId: m.message.id, model: m.message.model,
          inputTokens: u.input_tokens, outputTokens: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
        };
        state.steps.push(step);
        await ctx.recorder.step(step);
      } else if (m.type === 'result') {
        state.result = m;
      }
    }
  } catch (e) {
    if (!state.budgetExhausted) throw e;
  }
}
