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
