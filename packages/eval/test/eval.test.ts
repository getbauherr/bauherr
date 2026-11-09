import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { runEval, type EvalCase, type EvalOptions } from '../src/index.js';

type Call = { model: string; system?: string; user: string; judge: boolean; key?: string; run?: string };

/** A gateway stub: the subject answers `reply(input)`, the judge passes every criterion not named in `failCriteria`. */
async function stub(reply: (input: string, n: number) => string, failCriteria: string[] = [], usage = { input_tokens: 100, output_tokens: 50 }) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const server: Server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const b = JSON.parse(raw);
    const judge = !!b.tools;
    const user: string = b.messages[0].content;
    calls.push({ model: b.model, system: b.system, user, judge, key: req.headers['x-api-key'] as string, run: req.headers['x-bauherr-run'] as string });
    let content;
    if (judge) {
      const ids = [...user.matchAll(/^- (\S+): /gm)].map((m) => m[1]);
      content = [{ type: 'tool_use', name: 'verdict', input: { criteria: ids.map((id) => ({ id, pass: !failCriteria.includes(id!), reason: 'r' })) } }];
    } else {
      const n = (seen.get(user) ?? 0) + 1;
      seen.set(user, n);
      content = [{ type: 'text', text: reply(user, n) }];
    }
    res.setHeader('content-type', 'application/json').end(JSON.stringify({ content, usage }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { calls, url, close: () => server.close() };
}

const c = (over: Partial<EvalCase> = {}): EvalCase => ({ id: 'tdd', input: 'plan it', checks: { must_match: ['(?i)failing test'], must_not_match: ['skip'] }, rubric: [{ id: 'a', text: 'A', weight: 2 }, { id: 'b', text: 'B' }], ...over });
const opts = (url: string, over: Partial<EvalOptions> = {}): EvalOptions => ({
  skill: 'SKILL TEXT', cases: [c()], subject: { model: 'cheap' }, judge: { model: 'strong' }, gateway: { url, key: 'k' }, runLabel: 'ci-1', ...over,
});

test('passes: checks and rubric ok, one subject and one judge call with the skill as system prompt', async () => {
  const g = await stub(() => 'Write a Failing Test first');
  const r = await runEval(opts(g.url));
  g.close();
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => [x.id, x.pass, x.score, x.retried]), [['tdd', true, 1, false]]);
  assert.equal(g.calls.length, 2);
  assert.deepEqual(g.calls.map((x) => x.model), ['cheap', 'strong']);
  assert.match(g.calls[0]!.system!, /SKILL TEXT/);
  assert.equal(g.calls[0]!.key, 'k');
  assert.equal(g.calls[0]!.run, 'ci-1');
  assert.ok(r.costUsd > 0);
});

test('fails: a violated check skips the judge and fails the case and suite', async () => {
  const g = await stub(() => 'skip it');
  const r = await runEval(opts(g.url));
  g.close();
  assert.equal(r.ok, false);
  assert.equal(r.rows[0]!.pass, false);
  assert.deepEqual(r.rows[0]!.failedChecks, ['must_match (?i)failing test', 'must_not_match skip']);
  assert.equal(g.calls.filter((x) => x.judge).length, 0);
});

test('fails: weighted rubric score below the case threshold', async () => {
  const g = await stub(() => 'failing test', ['a']);
  const r = await runEval(opts(g.url));
  g.close();
  assert.ok(Math.abs(r.rows[0]!.score - 1 / 3) < 1e-9);
  assert.equal(r.rows[0]!.pass, false);
  assert.equal(r.rows[0]!.criteria.find((x) => x.id === 'a')!.pass, false);
});

test('a failing case is re-run once and the second attempt counts', async () => {
  const g = await stub((_, n) => (n === 1 ? 'nope' : 'failing test'));
  const r = await runEval(opts(g.url));
  g.close();
  assert.equal(r.rows[0]!.pass, true);
  assert.equal(r.rows[0]!.retried, true);
  assert.equal(g.calls.filter((x) => !x.judge).length, 2);
  const r2 = await stub(() => 'nope');
  const again = await runEval(opts(r2.url));
  r2.close();
  assert.equal(again.rows[0]!.pass, false);
  assert.equal(r2.calls.length, 2, 'exactly one retry, no further attempts');
});

test('max-usd aborts before the call that would exceed it', async () => {
  const g = await stub(() => 'failing test', [], { input_tokens: 1000, output_tokens: 1000 });
  const cases = [c({ id: 'one' }), c({ id: 'two' }), c({ id: 'three' })];
  // worst case per call is ~$0.0158; one case costs ~$0.036 actual
  const r = await runEval(opts(g.url, { cases, maxUsd: 0.05 }));
  g.close();
  assert.equal(r.aborted, true);
  assert.equal(r.ok, false);
  assert.ok(r.rows.length < cases.length);
  assert.ok(r.costUsd <= 0.05);
});

test('suite threshold: 1 of 2 cases passing is below 0.9, and passes with a lower threshold', async () => {
  const g = await stub((input) => (input === 'good' ? 'failing test' : 'bad'));
  const cases = [c({ id: 'good', input: 'good' }), c({ id: 'bad', input: 'bad' })];
  const r = await runEval(opts(g.url, { cases }));
  assert.equal(r.passRate, 0.5);
  assert.equal(r.ok, false);
  assert.equal((await runEval(opts(g.url, { cases, suiteThreshold: 0.5 }))).ok, true);
  g.close();
});

test('baseline: a case that passed on main and fails now is a regression even above the suite threshold', async () => {
  const g = await stub((input) => (input === 'bad' ? 'bad' : 'failing test'));
  const cases = [c({ id: 'bad', input: 'bad' }), ...Array.from({ length: 9 }, (_, i) => c({ id: `ok${i}`, input: `ok${i}` }))];
  const row = (id: string, pass: boolean) => ({ id, pass, score: 1, failedChecks: [], criteria: [], retried: false, costUsd: 0, output: '' });
  const base = await runEval(opts(g.url, { cases, baseline: [row('bad', false)] }));
  assert.equal(base.passRate, 0.9);
  assert.equal(base.ok, true, 'failing on main too: no regression');
  const reg = await runEval(opts(g.url, { cases, baseline: [row('bad', true)] }));
  g.close();
  assert.deepEqual(reg.regressions, ['bad']);
  assert.equal(reg.ok, false);
});

test('baseline run without a skill sends no skill text; too many cases is refused', async () => {
  const g = await stub(() => 'failing test');
  await runEval(opts(g.url, { skill: null }));
  g.close();
  assert.equal(g.calls[0]!.system, undefined);
  await assert.rejects(runEval(opts('http://x', { cases: [c(), c()], maxCases: 1 })), /max-cases/);
});
