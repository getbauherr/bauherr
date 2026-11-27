import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { execute } from '../src/execute.js';
import { handOver, startStubGateway } from './helpers.js';

const TIMEOUT = { timeout: 120_000 };

const options = () => {
  const cwd = handOver(mkdtempSync(join(tmpdir(), 'exec-')));
  return {
    runId: 'r2',
    stage: 'build',
    model: 'stub-model',
    cwd,
    home: cwd,
    maxTurns: 5,
    maxBudgetUsd: 1,
    readOnly: true,
    prompt: 'Say done.',
    timeoutMs: 60_000,
  };
};

void test('execute reports the cost of a finished agent', TIMEOUT, async () => {
  const gw = await startStubGateway('I am done.');
  const done = await execute({ ...options(), gatewayUrl: gw.url, gatewayKey: 'K' });
  await gw.close();
  assert.equal(done.ok, true);
  assert.ok(done.ok && done.costUsd >= 0);
});

void test('execute turns a budget stop into a failure with a reason', TIMEOUT, async () => {
  const gw = await startStubGateway('x', 0, true);
  const stopped = await execute({ ...options(), gatewayUrl: gw.url, gatewayKey: 'K' });
  await gw.close();
  assert.deepEqual(stopped, { ok: false, reason: 'the Workspace budget is exhausted' });
});

void test('execute turns a timeout into a failure with a reason', TIMEOUT, async () => {
  const gw = await startStubGateway('I am done.');
  const slow = await execute({ ...options(), gatewayUrl: gw.url, gatewayKey: 'K', timeoutMs: 1 });
  await gw.close();
  assert.equal(slow.ok, false);
  assert.match(slow.ok ? '' : slow.reason, /timed out/);
});
