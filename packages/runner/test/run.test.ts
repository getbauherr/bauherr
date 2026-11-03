import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStage } from '../src/index.js';
import { makeBareRepo, makeCtx, startStubGateway } from './helpers.js';

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
