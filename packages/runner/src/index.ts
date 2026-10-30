import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent, buildOptions, type AgentState } from './agent.js';
import { cloneRepo, commitAndPush, git } from './clone.js';
import { buildEvidence } from './evidence.js';
import { readGoal } from './goal.js';
import { DIFF_FILE, GOAL_FILE, PLAN_FILE, REVIEW_FILE, materialise } from './materialise.js';
import { startProxy } from './proxy.js';
import type { RunCtx, RunResult } from './types.js';

export type * from './types.js';
export { startProxy } from './proxy.js';
export { checkGoal } from './goal.js';
export { materialise } from './materialise.js';
export { egressGuard, writeScopeGuard } from './guards.js';
export { buildEvidence } from './evidence.js';

/** Only acceptance on staging closes a Ticket, so the MR references it and never uses a closing keyword. */
export const mrBody = (ticketUrl: string, evidence: string): string => `Refs ${ticketUrl}\n\n${evidence}\n`;

export const PLAN_MARKER = '<!-- bauherr:plan -->';
export const WORKLOG_MARKER = '<!-- bauherr:worklog -->';
/** Agent-verifiable Goal of a Plan Run; the Ticket's own Goal moves into the worklog. */
const PLAN_GOAL = [`\`${PLAN_FILE}\` exists with the sections \`## Goal\` and \`## Steps\``, 'every Ticket acceptance criterion is covered by a step under `## Steps`'];

/** Agent-verifiable Goal of a Review Run. */
const REVIEW_GOAL = [`\`${REVIEW_FILE}\` exists with a verdict, the findings and the review markdown`];

const worklogBody = (statements: { text: string; done?: boolean }[], instructions: string) =>
  `${WORKLOG_MARKER}\n## Worklog\n**Goal**\n${statements.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n')}\n\n**Current instructions**\n${instructions}\n`;

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
      ...(ctx.existingPr && ctx.run.stage !== 'plan' ? { checkout: ctx.existingPr.branch } : {}),
    });
    if (ctx.run.stage === 'review') {
      if (!ctx.existingPr) return finish('failed', 'review run without an MR');
      await git(clone.dir, clone.env, 'fetch', '--depth', '200', 'origin', `${ctx.product.defaultBranch}:refs/remotes/origin/${ctx.product.defaultBranch}`);
      artifacts.reviewedSha = await git(clone.dir, clone.env, 'rev-parse', 'HEAD');
    }
    const fixedGoal = ctx.run.stage === 'plan' ? PLAN_GOAL : ctx.run.stage === 'review' ? REVIEW_GOAL : null;
    const agentCtx: RunCtx = fixedGoal ? { ...ctx, run: { ...ctx.run, goal: { statements: fixedGoal } } } : ctx;
    const agentsMd = materialise(clone.dir, agentCtx);
    if (ctx.run.stage === 'review') {
      const base = `origin/${ctx.product.defaultBranch}`;
      await git(clone.dir, clone.env, 'diff', `--output=${DIFF_FILE}`, `${base}...HEAD`).catch(() => git(clone!.dir, clone!.env, 'diff', `--output=${DIFF_FILE}`, base, 'HEAD'));
    }
    proxy = await startProxy({ gatewayUrl: ctx.connection.gatewayUrl, gatewayKey: ctx.connection.gatewayKey, runId: ctx.run.id, stage: ctx.run.stage,
      ...(ctx.product.id ? { product: ctx.product.id } : {}), ...(ctx.ticket.id ? { ticket: ctx.ticket.id } : {}),
      onBudgetExceeded: () => { state.budgetExhausted = true; state.abort.abort(); },
    });
    mkdirSync(join(clone.home, 'agent'), { recursive: true });
    await runAgent(agentCtx, buildOptions(agentCtx, { cwd: clone.dir, home: join(clone.home, 'agent'), proxyUrl: proxy.url, agentsMd }, state), state);

    if (state.budgetExhausted) return finish('budget_exhausted', 'gateway budget exceeded');
    const r = state.result;
    if (!r) return finish('failed', 'agent ended without a result');
    if (r.subtype !== 'success') return finish('failed', r.subtype);
    if (state.verdict?.kind === 'needs_human') return finish('needs_human', state.verdict.reason);

    const goal = readGoal(join(clone.dir, GOAL_FILE));
    if (ctx.run.stage === 'review') {
      const file = join(clone.dir, REVIEW_FILE);
      if (!existsSync(file)) return finish('failed', `review run wrote no ${REVIEW_FILE}`);
      try {
        artifacts.review = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return finish('failed', `${REVIEW_FILE} is not valid JSON`);
      }
      return finish('succeeded');
    }
    if (ctx.run.stage === 'plan') {
      const planFile = join(clone.dir, PLAN_FILE);
      const plan = existsSync(planFile) ? readFileSync(planFile, 'utf8').replace(PLAN_MARKER, '').trim() : '';
      if (!/^##\s+Goal\s*$/m.test(plan) || !/^##\s+Steps\s*$/m.test(plan)) return finish('failed', `plan run wrote no ${PLAN_FILE} with sections Goal and Steps`);
      await ctx.forge.comment(ctx.ticket.number, `${PLAN_MARKER}\n${plan}\n`);
      await ctx.forge.upsertWorklog(ctx.ticket.number, worklogBody(ctx.run.goal.statements.map((text) => ({ text })), 'Plan posted; waiting for the label `bauherr:approved:plan`.'));
      artifacts.commentUrl = ctx.ticket.url;
      return finish('succeeded');
    }

    if (!(await commitAndPush(clone, clone.env, `bauherr: ticket #${ctx.ticket.number} (run ${ctx.run.id})`))) {
      return finish('failed', 'build run produced no commits');
    }
    artifacts.evidence = buildEvidence(goal, state.toolCalls);
    if (ctx.existingPr) {
      artifacts.prUrl = ctx.existingPr.url;
      await ctx.forge.comment(ctx.ticket.number, `Evidence of run ${ctx.run.id}, pushed to ${ctx.existingPr.url}:\n\n${artifacts.evidence}\n`);
      await ctx.forge.upsertWorklog(ctx.ticket.number, worklogBody(goal.map((g) => ({ text: g.text, done: g.status === 'verified' })), `Pushed to ${ctx.existingPr.url}. Waiting for review.`));
      await ctx.forge.setStage(ctx.ticket.number, 'review');
      return finish('succeeded');
    }
    const pr = await ctx.forge.openPullRequest({
      repo: ctx.product.repo, head: clone.branch, base: ctx.product.defaultBranch,
      title: `${ctx.ticket.title} (#${ctx.ticket.number})`,
      body: mrBody(ctx.ticket.url, artifacts.evidence),
    });
    artifacts.prUrl = pr.url;
    await ctx.forge.comment(ctx.ticket.number, `Link: ${pr.url}`);
    await ctx.forge.upsertWorklog(ctx.ticket.number, worklogBody(goal.map((g) => ({ text: g.text, done: g.status === 'verified' })), `MR opened: ${pr.url}. Waiting for review.`));
    await ctx.forge.setStage(ctx.ticket.number, 'review');
    return finish('succeeded');
  } catch (e) {
    ctx.recorder.log(`run ${ctx.run.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return finish('failed', e instanceof Error ? e.message : String(e));
  } finally {
    await proxy?.close();
    await clone?.cleanup();
  }
}
