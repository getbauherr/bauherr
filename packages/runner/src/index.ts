import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent, buildOptions, promptFor, type AgentKind, type AgentState } from './agent.js';
import { cloneRepo, commitAll, commitAndPush, git, interdiff, mergeBase, patchId } from './clone.js';
import { buildEvidence } from './evidence.js';
import { readGoal } from './goal.js';
import { DIFF_FILE, GOAL_FILE, INVESTIGATION_FILE, PLAN_FILE, REVIEW_FILE, SELF_REVIEW_FILE, TRIAGE_FILE, materialise } from './materialise.js';
import { SELF_REVIEW_MIN_LINES, changedLines, planStepCount, preReviewChecks } from './pre-review.js';
import { startProxy } from './proxy.js';
import type { RunCtx, RunResult } from './types.js';

export type * from './types.js';
export { startProxy } from './proxy.js';
export { checkGoal } from './goal.js';
export { materialise, untrustedBlock } from './materialise.js';
export { egressGuard, writeScopeGuard } from './guards.js';
export { buildEvidence } from './evidence.js';
export { SELF_REVIEW_MIN_LINES, changedLines, formatReviewChecks, parseReviewChecks, planStepCount, preReviewChecks, type ReviewChecks } from './pre-review.js';
export { cloneRepo, commitAndPush, git, mergeBase, patchId } from './clone.js';

/** Only acceptance on staging closes a Ticket, so the MR references it and never uses a closing keyword. */
export const mrBody = (ticketUrl: string, evidence: string): string => `Refs ${ticketUrl}\n\n${evidence}\n`;

export const PLAN_MARKER = '<!-- bauherr:plan -->';
export const WORKLOG_MARKER = '<!-- bauherr:worklog -->';
/** Agent-verifiable Goal of a Plan Run; the Ticket's own Goal moves into the worklog. */
const PLAN_GOAL = [`\`${PLAN_FILE}\` exists with the sections \`## Goal\` and \`## Steps\``, 'every Ticket acceptance criterion is covered by a step under `## Steps`'];

/** Agent-verifiable Goal of an investigation Plan Run. */
const INVESTIGATION_GOAL = [`\`${INVESTIGATION_FILE}\` exists with the cause and one decision (revise, fix-ticket or needs-human)`];

/** Agent-verifiable Goal of a Triage Run. */
const TRIAGE_GOAL = [`\`${TRIAGE_FILE}\` exists with an outcome (plan, refine or skip) and a reason`];

/** Agent-verifiable Goal of a Review Run. */
const REVIEW_GOAL = [`\`${REVIEW_FILE}\` exists with a verdict, the findings and the review markdown`];

const worklogBody = (statements: { text: string; done?: boolean }[], instructions: string) =>
  `${WORKLOG_MARKER}\n## Worklog\n**Goal**\n${statements.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`).join('\n')}\n\n**Current instructions**\n${instructions}\n`;

const ZERO = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costEstimateUsd: 0 };

function usageOf(state: AgentState): RunResult['usage'] {
  const cost = state.results.reduce((a, r) => a + r.total_cost_usd, 0);
  const mu = state.results.flatMap((r) => ('modelUsage' in r ? Object.values(r.modelUsage ?? {}) : []));
  if (mu.length > 0) {
    return {
      inputTokens: mu.reduce((a, m) => a + m.inputTokens, 0),
      outputTokens: mu.reduce((a, m) => a + m.outputTokens, 0),
      cacheRead: mu.reduce((a, m) => a + m.cacheReadInputTokens, 0),
      cacheWrite: mu.reduce((a, m) => a + m.cacheCreationInputTokens, 0),
      costEstimateUsd: cost,
    };
  }
  return state.steps.reduce(
    (a, s) => ({ ...a, inputTokens: a.inputTokens + s.inputTokens, outputTokens: a.outputTokens + s.outputTokens, cacheRead: a.cacheRead + s.cacheRead, cacheWrite: a.cacheWrite + s.cacheWrite }),
    { ...ZERO, costEstimateUsd: cost },
  );
}

/** Runs one Triage, Plan, Build or Review stage end to end. Never throws; infrastructure errors become `failed`. */
export async function runStage(ctx: RunCtx): Promise<RunResult> {
  const state: AgentState = { blockedOnce: false, toolCalls: [], steps: [], results: [], abort: new AbortController() };
  const artifacts: RunResult['artifacts'] = {};
  const finish = (status: RunResult['status'], reason?: string, reasonKind?: RunResult['reasonKind']): RunResult => ({ status, ...(reason ? { reason } : {}), ...(reasonKind ? { reasonKind } : {}), artifacts, usage: usageOf(state) });
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
  let clone: Awaited<ReturnType<typeof cloneRepo>> | undefined;
  try {
    clone = await cloneRepo({
      baseUrl: ctx.connection.gitBaseUrl ?? 'https://github.com',
      repo: ctx.product.repo,
      defaultBranch: ctx.product.defaultBranch,
      token: ctx.connection.gitToken,
      ...(ctx.connection.gitUser ? { user: ctx.connection.gitUser } : {}),
      branch: `bauherr/${ctx.ticket.number}-${ctx.run.id}`,
      ...(ctx.existingPr && ctx.run.stage !== 'plan' ? { checkout: ctx.existingPr.branch } : {}),
    });
    if (ctx.run.stage === 'review') {
      if (!ctx.existingPr) return finish('failed', 'review run without an MR');
      await git(clone.dir, clone.env, 'fetch', '--depth', '200', 'origin', `${ctx.product.defaultBranch}:refs/remotes/origin/${ctx.product.defaultBranch}`);
      artifacts.reviewedSha = await git(clone.dir, clone.env, 'rev-parse', 'HEAD');
    }
    const base = ctx.product.defaultBranch;
    let conflicted = false;
    if (ctx.mergeBase && ctx.existingPr && ctx.run.stage === 'build') {
      const merged = await mergeBase(clone, clone.env, base);
      conflicted = merged === 'conflict';
      if (!conflicted) {
        await commitAndPush(clone, clone.env, `bauherr: merge ${base} (run ${ctx.run.id})`);
        artifacts.patchId = await patchId(clone, clone.env, base);
        artifacts.pushedSha = await git(clone.dir, clone.env, 'rev-parse', 'HEAD');
        if (merged === 'uptodate') artifacts.uptodate = true;
        artifacts.prUrl = ctx.existingPr.url;
        artifacts.evidence = `Merged origin/${base} ${await git(clone.dir, clone.env, 'rev-parse', `origin/${base}`)} into the MR branch without an agent (${merged}).`;
        await ctx.forge.comment(ctx.ticket.number, `Evidence of run ${ctx.run.id}, pushed to ${ctx.existingPr.url}:\n\n${artifacts.evidence}\n`);
        await ctx.forge.setStage(ctx.ticket.number, 'review');
        return finish('succeeded');
      }
      artifacts.mergeConflict = true;
    }
    const fixedGoal = ctx.run.stage === 'plan' ? (ctx.ticket.investigation ? INVESTIGATION_GOAL : PLAN_GOAL) : ctx.run.stage === 'triage' ? TRIAGE_GOAL : ctx.run.stage === 'review' ? REVIEW_GOAL : null;
    const agentCtx: RunCtx = fixedGoal ? { ...ctx, run: { ...ctx.run, goal: { statements: fixedGoal } } } : ctx;
    const agentsMd = materialise(clone.dir, agentCtx);
    if (ctx.run.stage === 'review') {
      const remote = `origin/${base}`;
      artifacts.reviewedPatchId = await patchId(clone, clone.env, base).catch(() => '');
      if (ctx.conflictBase) await interdiff(clone, clone.env, base, ctx.conflictBase, join(clone.dir, DIFF_FILE));
      else await git(clone.dir, clone.env, 'diff', `--output=${DIFF_FILE}`, `${remote}...HEAD`).catch(() => git(clone!.dir, clone!.env, 'diff', `--output=${DIFF_FILE}`, remote, 'HEAD'));
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
    if (state.verdict?.kind === 'needs_human') return finish('needs_human', state.verdict.reason, state.verdict.reasonKind);

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
    if (ctx.run.stage === 'triage') {
      const file = join(clone.dir, TRIAGE_FILE);
      if (!existsSync(file)) return finish('failed', `triage run wrote no ${TRIAGE_FILE}`);
      try {
        artifacts.triage = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        return finish('failed', `${TRIAGE_FILE} is not valid JSON`);
      }
      return finish('succeeded');
    }
    if (ctx.run.stage === 'plan') {
      if (ctx.ticket.investigation) {
        const file = join(clone.dir, INVESTIGATION_FILE);
        if (!existsSync(file)) return finish('failed', `investigation run wrote no ${INVESTIGATION_FILE}`);
        try {
          artifacts.investigation = JSON.parse(readFileSync(file, 'utf8'));
        } catch {
          return finish('failed', `${INVESTIGATION_FILE} is not valid JSON`);
        }
        if ((artifacts.investigation as { decision?: string }).decision !== 'revise') return finish('succeeded');
      }
      const planFile = join(clone.dir, PLAN_FILE);
      const plan = existsSync(planFile) ? readFileSync(planFile, 'utf8').replace(PLAN_MARKER, '').trim() : '';
      if (!/^##\s+Goal\s*$/m.test(plan) || !/^##\s+Steps\s*$/m.test(plan)) return finish('failed', `plan run wrote no ${PLAN_FILE} with sections Goal and Steps`);
      await ctx.forge.comment(ctx.ticket.number, `${PLAN_MARKER}\n${plan}\n`);
      await ctx.forge.upsertWorklog(ctx.ticket.number, worklogBody(ctx.run.goal.statements.map((text) => ({ text })), 'Plan posted; waiting for the label `bauherr:approved:plan`.'));
      artifacts.commentUrl = ctx.ticket.url;
      return finish('succeeded');
    }

    const message = `bauherr: ticket #${ctx.ticket.number} (run ${ctx.run.id})`;
    if (!(await commitAll(clone, clone.env, message))) return finish('failed', 'build run produced no commits');
    const { dir, env } = { dir: clone.dir, env: clone.env };
    await git(dir, env, 'fetch', '--depth', '200', '--no-tags', 'origin', `+${base}:refs/remotes/origin/${base}`);
    const diff = (...a: string[]) => git(dir, env, 'diff', ...a, `origin/${base}...HEAD`).catch(async () => {
      await git(dir, env, 'fetch', '--unshallow', '--no-tags', 'origin', `${base}:refs/remotes/origin/${base}`);
      return git(dir, env, 'diff', ...a, `origin/${base}...HEAD`);
    });
    const extra: string[] = [];
    const pass = async (kind: AgentKind, fix?: string) => {
      const o = { cwd: dir, home: join(clone!.home, 'agent'), proxyUrl: proxy!.url, agentsMd, kind };
      await runAgent(agentCtx, buildOptions(agentCtx, o, state), state, promptFor(agentCtx, kind, fix));
      await commitAll(clone!, env, message);
    };
    if (changedLines(await diff('--numstat')) >= SELF_REVIEW_MIN_LINES) {
      await diff(`--output=${DIFF_FILE}`);
      await pass('self-review');
      const file = join(dir, SELF_REVIEW_FILE);
      const findings: { severity: string; file?: string; line?: number; msg: string }[] = (() => {
        try {
          return JSON.parse(readFileSync(file, 'utf8')).findings ?? [];
        } catch {
          return [];
        }
      })();
      const blocking = findings.filter((f) => f.severity !== 'low');
      if (blocking.length) await pass('fix', JSON.stringify(blocking));
      if (state.budgetExhausted) return finish('budget_exhausted', 'gateway budget exceeded');
      extra.push(`**Self-review**: ${findings.length} findings, ${blocking.length} fixed`, ...findings.filter((f) => f.severity === 'low').map((f) => `- low ${f.file ?? ''}:${f.line ?? 0} ${f.msg}`), '');
    }
    const evidence = () => buildEvidence(goal, state.toolCalls, ctx.ticket.plan, extra);
    const failures = async () => {
      const files = (await diff('--name-only')).split('\n').filter(Boolean);
      return preReviewChecks({ files, evidence: evidence(), planSteps: planStepCount(ctx.ticket.plan ?? ''), exists: (p) => existsSync(join(dir, p)), config: ctx.product.reviewChecks });
    };
    let failed = await failures();
    if (failed.length) {
      await pass('fix', failed.join('\n'));
      if (state.budgetExhausted) return finish('budget_exhausted', 'gateway budget exceeded');
      failed = await failures();
      if (failed.length) {
        await commitAndPush(clone, env, message);
        artifacts.pushedSha = await git(dir, env, 'rev-parse', 'HEAD');
        return finish('needs_human', `Pre-review checks failed:\n- ${failed.join('\n- ')}`, 'stuck');
      }
    }
    await commitAndPush(clone, env, message);
    artifacts.evidence = evidence();
    if (conflicted) artifacts.patchId = await patchId(clone, clone.env, base);
    artifacts.pushedSha = await git(clone.dir, clone.env, 'rev-parse', 'HEAD');
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
