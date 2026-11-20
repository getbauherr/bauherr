import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GithubBackend, patAuth } from '../src/index.js';
import { json, urlOf } from './helpers.js';

void describe('github listChecks', () => {
  void it('maps commit statuses to checks next to the check runs', async () => {
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u) =>
        json(
          urlOf(u).includes('/status')
            ? {
                statuses: [
                  { context: 'ci/a', state: 'failure', created_at: 'T2' },
                  { context: 'ci/b', state: 'pending', created_at: 'T3' },
                  { context: 'ci/c', state: 'success', created_at: 'T4' },
                ],
              }
            : {
                check_runs: [
                  {
                    id: 1,
                    name: 'build',
                    status: 'completed',
                    conclusion: 'success',
                    started_at: 'T1',
                    html_url: 'https://gh/run/1',
                  },
                ],
              },
        ),
    });
    assert.deepEqual(await b.forge.listChecks('o/r', 'h'), [
      { id: 1, name: 'build', status: 'completed', conclusion: 'success', startedAt: 'T1', url: 'https://gh/run/1' },
      { name: 'ci/a', status: 'completed', conclusion: 'failure', startedAt: 'T2' },
      { name: 'ci/b', status: 'in_progress', conclusion: null, startedAt: 'T3' },
      { name: 'ci/c', status: 'completed', conclusion: 'success', startedAt: 'T4' },
    ]);
  });
  void it('takes the check output from output.text', async () => {
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u) =>
        json(
          urlOf(u).includes('/status')
            ? { statuses: [] }
            : {
                check_runs: [
                  {
                    id: 1,
                    name: 'e2e-flaky (shard 1)',
                    status: 'completed',
                    conclusion: 'neutral',
                    output: { title: 'x', summary: 'not this', text: '[{"file":"a.spec.ts"}]' },
                  },
                ],
              },
        ),
    });
    assert.equal((await b.forge.listChecks('o/r', 'h'))[0]?.output, '[{"file":"a.spec.ts"}]');
  });
});

void describe('github rerunFailed', () => {
  void it('re-runs the failed jobs of each Actions run once; checks without a run id re-run nothing', async () => {
    const calls: string[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) =>
        json(
          init?.method === 'POST'
            ? (calls.push(new URL(urlOf(u)).pathname), {})
            : urlOf(u).includes('/status')
              ? { statuses: [] }
              : {
                  check_runs: [
                    {
                      id: 1,
                      name: 'a',
                      status: 'completed',
                      conclusion: 'failure',
                      html_url: 'https://github.com/o/r/actions/runs/77/job/1',
                    },
                    {
                      id: 2,
                      name: 'b',
                      status: 'completed',
                      conclusion: 'failure',
                      html_url: 'https://github.com/o/r/actions/runs/77/job/2',
                    },
                  ],
                },
        ),
    });
    const checks = await b.forge.listChecks('o/r', 'h');
    assert.deepEqual(
      checks.map((c) => c.runId),
      [77, 77],
    );
    assert.equal(await b.forge.rerunFailed('o/r', checks), true);
    assert.deepEqual(calls, ['/repos/o/r/actions/runs/77/rerun-failed-jobs']);
    assert.equal(
      await b.forge.rerunFailed('o/r', [{ name: 'ci/a', status: 'completed', conclusion: 'failure' }]),
      false,
    );
    assert.equal(calls.length, 1);
  });
});
