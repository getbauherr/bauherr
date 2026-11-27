import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  backoffMs,
  budgetOf,
  ForgeRateLimited,
  GitlabBackend,
  gitlabPat,
  Http,
  isForgeOutage,
  patAuth,
} from '../src/index.js';
import { json } from './helpers.js';

const answers = (...responses: (Response | Error)[]) => {
  const calls: string[] = [];
  const fetch = async (_u: unknown, init?: RequestInit) => {
    calls.push(String(init?.method));
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
};

const github = (fetch: typeof globalThis.fetch, sleeps: number[] = [], extra = {}) =>
  new Http({ auth: patAuth('t'), fetch, sleep: async (ms) => void sleeps.push(ms), random: () => 1, ...extra });

const unreachable = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

void describe('forge retries', () => {
  void it('502 then success on a read', async () => {
    const sleeps: number[] = [];
    const { fetch, calls } = answers(new Response('bad gateway', { status: 502 }), json({ ok: true }));
    assert.deepEqual(await github(fetch, sleeps).json('GET', '/x'), { ok: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [500]);
  });

  void it('backoff doubles with jitter and is capped', () => {
    assert.deepEqual([0, 1, 2].map((n) => backoffMs(n, () => 1)), [500, 1000, 2000]);
    assert.equal(backoffMs(0, () => 0), 250);
    assert.equal(backoffMs(20, () => 1), 30_000);
  });

  void it('a 503 honours Retry-After', async () => {
    const sleeps: number[] = [];
    const { fetch } = answers(new Response('', { status: 503, headers: { 'retry-after': '7' } }), json({}));
    await github(fetch, sleeps).json('GET', '/x');
    assert.deepEqual(sleeps, [7000]);
  });

  void it('retries a network error on a read, bounded by maxRetries', async () => {
    const { fetch, calls } = answers(unreachable, unreachable, unreachable);
    await assert.rejects(github(fetch, [], { maxRetries: 2 }).json('GET', '/x'), /fetch failed/);
    assert.equal(calls.length, 3);
  });

  void it('does not retry a 5xx or a network error of a write that is not idempotent', async () => {
    const down = answers(new Response('boom', { status: 502 }), json({}));
    await assert.rejects(github(down.fetch).json('POST', '/x', {}), /502/);
    assert.equal(down.calls.length, 1);
    const reset = answers(unreachable, json({}));
    await assert.rejects(github(reset.fetch).json('POST', '/x', {}), /fetch failed/);
    assert.equal(reset.calls.length, 1);
  });

  void it('retries a write declared idempotent', async () => {
    const { fetch, calls } = answers(new Response('boom', { status: 504 }), unreachable, json({ done: true }));
    assert.deepEqual(await github(fetch).json('PATCH', '/x', {}, { idempotent: true }), { done: true });
    assert.deepEqual(calls, ['PATCH', 'PATCH', 'PATCH']);
  });

  void it('retries a rate-limited write of any kind: the forge refused it', async () => {
    const sleeps: number[] = [];
    const { fetch } = answers(new Response('slow', { status: 429, headers: { 'retry-after': '3' } }), json({ ok: 1 }));
    assert.deepEqual(await github(fetch, sleeps).json('POST', '/x', {}), { ok: 1 });
    assert.deepEqual(sleeps, [3000]);
  });

  void it('a used-up primary limit with a far reset throws ForgeRateLimited carrying the reset time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const limited = new Response('limit', {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    });
    const { fetch, calls } = answers(limited);
    const error = await github(fetch).json('GET', '/x').catch((e: unknown) => e);
    assert.ok(error instanceof ForgeRateLimited);
    assert.ok(Math.abs(error.resetAt.getTime() - (reset * 1000 + 1000)) < 5000);
    assert.equal(calls.length, 1);
  });

  void it('tracks the remaining budget per key from the headers', async () => {
    const headers = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '812', 'x-ratelimit-reset': '1900000000' };
    const { fetch } = answers(json({}, { headers }));
    await github(fetch, [], { budgetKey: 'conn-1' }).json('GET', '/x');
    const budget = budgetOf('conn-1');
    assert.equal(budget?.limit, 5000);
    assert.equal(budget?.remaining, 812);
    assert.equal(budget?.resetAt?.getTime(), 1_900_000_000_000);
  });

  void it('GitLab retries a 503 on a read and a 429 on a write', async () => {
    const sleeps: number[] = [];
    const { fetch, calls } = answers(
      new Response('x', { status: 503 }),
      json({ ok: true }),
      new Response('x', { status: 429, headers: { 'retry-after': '2' } }),
      json({ ok: true }),
    );
    const b = new GitlabBackend({
      auth: gitlabPat('t'),
      fetch,
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 1,
    });
    await b.forge.getRepository('g/p').catch(() => undefined);
    await b.tickets('g/p').comment('1', 'hi').catch(() => undefined);
    assert.deepEqual(calls, ['GET', 'GET', 'POST', 'POST']);
    assert.deepEqual(sleeps, [500, 2000]);
  });

  void it('names an outage: 5xx, no answer, git transport failure; not a 404', () => {
    assert.ok(isForgeOutage(Object.assign(new Error('GitHub GET /x -> 502: bad'), { status: 502 })));
    assert.ok(isForgeOutage(unreachable));
    assert.ok(isForgeOutage(new Error('fatal: unable to access https://x/: The requested URL returned error: 503')));
    assert.ok(!isForgeOutage(Object.assign(new Error('GitHub GET /x -> 404'), { status: 404 })));
    assert.ok(!isForgeOutage(new Error('the agent left no change')));
  });
});
