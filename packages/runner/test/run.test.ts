import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStage } from '../src/index.js';
import { makeBareRepo, makeCtx, startStubGateway, type StubTool } from './helpers.js';

// Drives the real bundled Claude Code binary against a stub gateway (no LLM). The stub never edits
// goal.json, so the Stop hook must block once and then end the Run needs_human.
test('runStage via proxy: key injected upstream, Stop hook blocks once then needs_human', { timeout: 120_000 }, async () => {
  const gw = await startStubGateway('I am done.');
  const ctx = makeCtx({ gatewayUrl: gw.url, gitBaseUrl: makeBareRepo(), stage: 'plan' });
  const steps: string[] = [];
  ctx.recorder.step = async (s) => { steps.push(s.messageId); };
  try {
    const res = await runStage(ctx);
    assert.equal(res.status, 'needs_human', JSON.stringify({ res, logs: ctx.logs }));
    assert.match(res.reason ?? '', /plan\.md/);
    assert.ok(gw.seen.length >= 2, 'second request is the Stop-hook re-prompt');
    for (const s of gw.seen) {
      assert.equal(s.headers.authorization, 'Bearer REAL-GATEWAY-KEY');
      assert.equal(s.headers['x-bauherr-run'], 'r1');
      assert.equal(s.headers['x-bauherr-stage'], 'plan');
    }
    assert.ok(steps.length >= 2);
    assert.equal(new Set(steps).size, steps.length, 'one Step per message.id');
    assert.equal(ctx.comments.length, 0);
    assert.ok(res.usage.inputTokens > 0);
  } finally {
    await gw.close();
  }
});

test('runStage ends budget_exhausted when the gateway answers 429 budget_exceeded', { timeout: 120_000 }, async () => {
  const gw = await startStubGateway('x', 0, true);
  const ctx = makeCtx({ gatewayUrl: gw.url, gitBaseUrl: makeBareRepo(), stage: 'plan' });
  try {
    const res = await runStage(ctx);
    assert.equal(res.status, 'budget_exhausted', JSON.stringify({ res, logs: ctx.logs }));
    assert.equal(res.reason, 'gateway budget exceeded');
    assert.equal(ctx.comments.length, 0);
  } finally {
    await gw.close();
  }
});

test('runStage build with mergeBase: a clean merge of main is pushed with no agent turn', { timeout: 60_000 }, async () => {
  const base = makeBareRepo();
  const bare = base.replace('file://', '') + '/o/n.git';
  const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim();
  const w = mkdtempSync(join(tmpdir(), 'mb-'));
  sh(w, 'clone', '-q', bare, '.');
  sh(w, 'switch', '-qc', 'bauherr/7-r0');
  writeFileSync(join(w, 'mr.txt'), 'mr\n');
  sh(w, 'add', '-A');
  sh(w, 'commit', '-qm', 'mr');
  sh(w, 'push', '-q', 'origin', 'bauherr/7-r0');
  sh(w, 'switch', '-q', 'main');
  writeFileSync(join(w, 'main.txt'), 'main\n');
  sh(w, 'add', '-A');
  sh(w, 'commit', '-qm', 'main moves');
  sh(w, 'push', '-q', 'origin', 'main');
  const ctx = makeCtx({ gatewayUrl: 'http://127.0.0.1:1', gitBaseUrl: base, stage: 'build' });
  ctx.mergeBase = true;
  ctx.existingPr = { number: 1, url: 'https://example.invalid/pr/1', branch: 'bauherr/7-r0', title: 't', body: 'b' };
  const res = await runStage(ctx);
  assert.equal(res.status, 'succeeded', JSON.stringify({ res, logs: ctx.logs }));
  assert.match(res.artifacts.patchId ?? '', /^[0-9a-f]{40}$/);
  assert.equal(res.usage.inputTokens, 0);
  assert.deepEqual(ctx.stages, ['review']);
  assert.equal(sh(bare, 'ls-tree', '-r', '--name-only', 'bauherr/7-r0'), 'README.md\nmain.txt\nmr.txt');
});

const bare = (ctx: { connection: { gitBaseUrl?: string } }) => `${ctx.connection.gitBaseUrl!.replace('file://', '')}/o/n.git`;

/** A build whose scripted agent writes `lines` lines to src/a.ts; the self-review pass reports `findings`; a fix pass writes src/fixed.ts. */
const buildRun = async (lines: number, findings: object[], reviewChecks?: object, onBuild?: () => void) => {
  const writes = (path: string, content: string): StubTool => ({ name: 'Write', input: { file_path: path, content } });
  const gw = await startStubGateway('done', 0, false, (model, prompt, cwd) =>
    model === 'cheap-m' ? (prompt.includes('Self-review of your own') ? writes(`${cwd}/.bauherr/self-review.json`, JSON.stringify({ findings })) : undefined)
    : prompt.includes('Fix pass') ? writes(`${cwd}/src/fixed.ts`, 'export const fixed = 1;\n')
    : prompt.includes('Build Run') ? (onBuild?.(), writes(`${cwd}/src/a.ts`, 'x\n'.repeat(lines)))
    : undefined);
  const ctx = makeCtx({ gatewayUrl: gw.url, gitBaseUrl: makeBareRepo(), stage: 'build' });
  ctx.run.goal.statements = [];
  ctx.run.tier = 'standard';
  ctx.connection.modelByTier = { cheap: 'cheap-m', standard: 'std-m' };
  ctx.ticket.plan = '## Steps\n1. do it';
  if (reviewChecks) ctx.product.reviewChecks = reviewChecks;
  return { gw, ctx };
};

test('runStage build: 29 changed lines skip the self-review', { timeout: 120_000 }, async () => {
  const { gw, ctx } = await buildRun(29, []);
  try {
    const res = await runStage(ctx);
    assert.equal(res.status, 'succeeded', JSON.stringify({ res, logs: ctx.logs }));
    assert.ok(gw.seen.every((s) => JSON.parse(s.body).model === 'std-m'));
    assert.doesNotMatch(res.artifacts.evidence ?? '', /Self-review/);
    assert.match(res.artifacts.evidence ?? '', /\| 1 \| done \|/);
    assert.equal(ctx.prs.length, 1);
  } finally {
    await gw.close();
  }
});

test('runStage build: 30 changed lines run the self-review on the cheap tier and one fix pass', { timeout: 120_000 }, async () => {
  const { gw, ctx } = await buildRun(30, [{ severity: 'high', file: 'src/a.ts', line: 1, msg: 'bad', scenario: 's' }, { severity: 'low', file: 'src/a.ts', line: 2, msg: 'nit', scenario: 's' }]);
  try {
    const res = await runStage(ctx);
    assert.equal(res.status, 'succeeded', JSON.stringify({ res, logs: ctx.logs }));
    const bodies = gw.seen.map((s) => s.body);
    assert.ok(bodies.some((b) => b.includes('"model":"cheap-m"') && b.includes('Self-review of your own')));
    assert.equal(bodies.filter((b) => b.includes('Fix pass for Ticket')).length >= 1, true);
    assert.match(res.artifacts.evidence ?? '', /\*\*Self-review\*\*: 2 findings, 1 fixed/);
    assert.match(res.artifacts.evidence ?? '', /- low src\/a\.ts:2 nit/);
    assert.equal(ctx.prs.length, 1);
  } finally {
    await gw.close();
  }
});

test('runStage build: checks still failing after the fix pass push the branch and end needs_human with no MR', { timeout: 120_000 }, async () => {
  const { gw, ctx } = await buildRun(30, [], { tests: [{ src: ['src/**'], tests: ['tests/**'] }] });
  try {
    const res = await runStage(ctx);
    assert.equal(res.status, 'needs_human', JSON.stringify({ res, logs: ctx.logs }));
    assert.match(res.reason ?? '', /Pre-review checks failed:\n- src\/a\.ts changed but no file matching tests\/\*\*/);
    assert.equal(ctx.prs.length, 0);
    assert.equal(gw.seen.filter((s) => s.body.includes('Fix pass for Ticket')).length >= 1, true);
    assert.equal(execFileSync('git', ['ls-tree', '-r', '--name-only', 'bauherr/7-r1'], { cwd: bare(ctx), encoding: 'utf8' }).includes('src/a.ts'), true);
    assert.match(res.artifacts.pushedSha ?? '', /^[0-9a-f]{40}$/);
  } finally {
    await gw.close();
  }
});

test('runStage build: a base that moved past the shallow fetch still diffs against the merge base', { timeout: 120_000 }, async () => {
  let ctxRef: { connection: { gitBaseUrl?: string } } | undefined;
  const { gw, ctx } = await buildRun(30, [], { tests: [{ src: ['src/**'], tests: ['tests/**'] }] }, () => {
    const w = mkdtempSync(join(tmpdir(), 'mv-'));
    const sh = (...a: string[]) => execFileSync('git', a, { cwd: w, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    sh('clone', '-q', bare(ctxRef!), '.');
    mkdirSync(join(w, 'tests'));
    writeFileSync(join(w, 'tests/main.test.ts'), 'm\n');
    sh('add', '-A');
    sh('commit', '-qm', 'main test');
    for (let i = 0; i < 205; i++) sh('commit', '-q', '--allow-empty', '-m', `m${i}`);
    sh('push', '-q', 'origin', 'main');
  });
  ctxRef = ctx;
  try {
    const res = await runStage(ctx);
    assert.equal(res.status, 'needs_human', JSON.stringify({ res, logs: ctx.logs }));
    assert.match(res.reason ?? '', /src\/a\.ts changed but no file matching tests\/\*\*/);
  } finally {
    await gw.close();
  }
});

/** An investigation Plan Run whose scripted agent runs `command` in the clone (the Stop hook needs the Goal verified, so each script writes goal.json too). */
const investigationRun = async (files: { investigation?: string; plan?: string }) => {
  const goal = `printf '%s' '[{"text":"g","status":"verified","evidence":"e"}]' > .bauherr/goal.json`;
  const put = (name: string, body: string) => `printf '%s' '${body}' > ${name}`;
  const command = [goal, ...(files.investigation === undefined ? [] : [put('.bauherr/investigation.json', files.investigation)]), ...(files.plan === undefined ? [] : [put('.bauherr/plan.md', files.plan)])].join(' && ');
  const gw = await startStubGateway('done', 0, false, () => ({ name: 'Bash', input: { command, description: 'write the investigation files' } }));
  const ctx = makeCtx({ gatewayUrl: gw.url, gitBaseUrl: makeBareRepo(), stage: 'plan' });
  ctx.ticket.investigation = '<!-- bauherr:investigation -->\nFailed build Runs: #1, #2';
  try {
    return { res: await runStage(ctx), ctx };
  } finally {
    await gw.close();
  }
};

test('runStage investigation: no investigation.json fails the Run', { timeout: 120_000 }, async () => {
  const { res, ctx } = await investigationRun({});
  assert.equal(res.status, 'failed', JSON.stringify({ res, logs: ctx.logs }));
  assert.match(res.reason ?? '', /wrote no \.bauherr\/investigation\.json/);
  assert.equal(ctx.comments.length, 0);
});

test('runStage investigation: invalid JSON fails the Run', { timeout: 120_000 }, async () => {
  const { res, ctx } = await investigationRun({ investigation: 'not json' });
  assert.equal(res.status, 'failed', JSON.stringify({ res, logs: ctx.logs }));
  assert.match(res.reason ?? '', /is not valid JSON/);
});

test('runStage investigation: a fix-ticket file needs no plan.md and ends succeeded with the decision as an artifact', { timeout: 120_000 }, async () => {
  const investigation = { cause: 'cap too low', decision: 'fix-ticket', fix: { title: 'Raise the cap', body: 'b' } };
  const { res, ctx } = await investigationRun({ investigation: JSON.stringify(investigation) });
  assert.equal(res.status, 'succeeded', JSON.stringify({ res, logs: ctx.logs }));
  assert.deepEqual(res.artifacts.investigation, investigation);
  assert.equal(ctx.comments.length, 0, 'no plan Comment is posted');
});
