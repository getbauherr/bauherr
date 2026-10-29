import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent, buildOptions, type AgentState } from './agent.js';
import { cloneRepo, commitAndPush } from './clone.js';
import { buildEvidence } from './evidence.js';
import { readGoal } from './goal.js';
import { GOAL_FILE, WORKLOG_FILE, materialise } from './materialise.js';
import { startProxy } from './proxy.js';
import type { RunCtx, RunResult } from './types.js';

export type * from './types.js';
export { startProxy } from './proxy.js';
export { checkGoal } from './goal.js';
export { materialise } from './materialise.js';
export { egressGuard, writeScopeGuard } from './guards.js';
export { buildEvidence } from './evidence.js';

const ZERO = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costEstimateUsd: 0 };

function usageOf(state: AgentState): RunResult['usage'] {
  const r = state.result;
  const mu = r && 'modelUsage' in r ? Object.values(r.modelUsage ?? {}) : [];
  if (r && mu.length > 0) {
    return {
      inputTokens: mu.reduce((a, m) => a + m.inputTokens, 0),
      outputTokens: mu.reduce((a, m) => a + m.outputTokens, 0),
      cacheRead: mu.reduce((a, m) => a + m.cacheReadInputTokens, 0),
      cacheWrite: mu.reduce((a, m) => a + m.cacheCreationInputTokens, 0),
      costEstimateUsd: r.total_cost_usd,
    };
  }
  return state.steps.reduce(
    (a, s) => ({ ...a, inputTokens: a.inputTokens + s.inputTokens, outputTokens: a.outputTokens + s.outputTokens, cacheRead: a.cacheRead + s.cacheRead, cacheWrite: a.cacheWrite + s.cacheWrite }),
    { ...ZERO, costEstimateUsd: r && 'total_cost_usd' in r ? r.total_cost_usd : 0 },
  );
}

/** Runs one Plan or Build stage end to end. Never throws; infrastructure errors become `failed`. */
export async function runStage(ctx: RunCtx): Promise<RunResult> {
  const state: AgentState = { blockedOnce: false, toolCalls: [], steps: [], abort: new AbortController() };
  const artifacts: RunResult['artifacts'] = {};
  const finish = (status: RunResult['status'], reason?: string): RunResult => ({ status, ...(reason ? { reason } : {}), artifacts, usage: usageOf(state) });
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
  let clone: Awaited<ReturnType<typeof cloneRepo>> | undefined;
  try {
    clone = await cloneRepo({
      baseUrl: ctx.connection.gitBaseUrl ?? 'https://github.com',
      repo: ctx.product.repo,
      defaultBranch: ctx.product.defaultBranch,
      token: ctx.connection.gitToken,
      branch: `bauherr/${ctx.ticket.number}-${ctx.run.id}`,
    });
    const agentsMd = materialise(clone.dir, ctx);
    proxy = await startProxy({ gatewayUrl: ctx.connection.gatewayUrl, gatewayKey: ctx.connection.gatewayKey, runId: ctx.run.id, stage: ctx.run.stage,
      ...(ctx.product.id ? { product: ctx.product.id } : {}), ...(ctx.ticket.id ? { ticket: ctx.ticket.id } : {}),
      onBudgetExceeded: () => { state.budgetExhausted = true; state.abort.abort(); },
    });
    mkdirSync(join(clone.home, 'agent'), { recursive: true });
    await runAgent(ctx, buildOptions(ctx, { cwd: clone.dir, home: join(clone.home, 'agent'), proxyUrl: proxy.url, agentsMd }, state), state);

    if (state.budgetExhausted) return finish('budget_exhausted', 'gateway budget exceeded');
    const r = state.result;
    if (!r) return finish('failed', 'agent ended without a result');
    if (r.subtype !== 'success') return finish('failed', r.subtype);
    if (state.verdict?.kind === 'needs_human') return finish('needs_human', state.verdict.reason);

    const goal = readGoal(join(clone.dir, GOAL_FILE));
    const worklog = readFileSync(join(clone.dir, WORKLOG_FILE), 'utf8').trim();
    if (ctx.run.stage === 'plan') {
      if (worklog === '' || worklog === (ctx.ticket.worklog ?? '').trim()) return finish('failed', 'plan run wrote no plan to the worklog');
      await ctx.forge.comment(ctx.ticket.number, worklog);
      artifacts.commentUrl = ctx.ticket.url;
      return finish('succeeded');
    }

    if (!(await commitAndPush(clone, clone.env, `bauherr: ticket #${ctx.ticket.number} (run ${ctx.run.id})`))) {
      return finish('failed', 'build run produced no commits');
    }
    artifacts.evidence = buildEvidence(goal, state.toolCalls);
    const pr = await ctx.forge.openPullRequest({
      repo: ctx.product.repo, head: clone.branch, base: ctx.product.defaultBranch,
      title: `${ctx.ticket.title} (#${ctx.ticket.number})`,
      body: `Closes ${ctx.ticket.url}\n\n${artifacts.evidence}\n`,
    });
    artifacts.prUrl = pr.url;
    return finish('succeeded');
  } catch (e) {
    ctx.recorder.log(`run ${ctx.run.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return finish('failed', e instanceof Error ? e.message : String(e));
  } finally {
    await proxy?.close();
    await clone?.cleanup();
  }
}
