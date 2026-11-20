import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GitlabError, MergePendingError } from '../src/index.js';
import { fx, fxObject, setup, P } from './gitlab-setup.js';
import { json } from './helpers.js';

void describe('gitlab forge: checks and merging', () => {
  void it('listChecks maps the latest pipeline jobs; no pipeline gives []', async () => {
    const { forge, calls } = setup((_m, path) =>
      path.includes('/jobs') ? fx('jobs') : path.includes('/bridges') ? [] : fx('pipelines'),
    );
    const checks = await forge.listChecks('g/p', 'abc123');
    assert.deepEqual(
      checks.map((c) => [c.name, c.status, c.conclusion]),
      [
        ['test', 'completed', 'success'],
        ['lint', 'completed', 'failure'],
        ['optional', 'completed', 'neutral'],
        ['deploy', 'completed', 'skipped'],
        ['e2e', 'in_progress', null],
        ['old', 'completed', 'cancelled'],
        ['skipme', 'completed', 'skipped'],
      ],
    );
    assert.equal(calls[0]!.path, `${P}/pipelines?sha=abc123&per_page=1`);
    assert.equal(calls[1]!.path, `${P}/pipelines/2994845015/jobs?per_page=100`);
    assert.equal(calls[2]!.path, `${P}/pipelines/2994845015/bridges?per_page=100`);
    assert.deepEqual(await setup(() => []).forge.listChecks('g/p', 'none'), []);
  });

  void it('getCommitDate', async () => {
    const { forge, calls } = setup(() => ({ committed_date: '2026-10-30T09:00:00.000+00:00' }));
    assert.equal(await forge.getCommitDate('g/p', 'abc'), '2026-10-30T09:00:00.000+00:00');
    assert.equal(calls[0]!.path, `${P}/repository/commits/abc`);
  });

  void it('mergePullRequest squashes pinned to expectSha, returns the squash sha and deletes the branch', async () => {
    let merged = false;
    const { forge, calls } = setup((m, path) => {
      if (m === 'PUT') merged = true;
      if (path === P) return { squash_option: 'default_on' };
      if (path.startsWith(`${P}/merge_requests?`)) return [{ iid: 197 }];
      if (m === 'PUT' && path === `${P}/merge_requests/197`) return {};
      return m === 'DELETE' ? new Response(null, { status: 204 }) : merged ? fx('mr_merged') : fx('mr');
    });
    const r = await forge.mergePullRequest('g/p', 196, { method: 'squash', deleteBranch: true, expectSha: 'abc123' });
    assert.deepEqual(r, { mergeSha: 'def456' });
    assert.deepEqual(
      calls.map((c) => [c.method, c.path]),
      [
        ['GET', `${P}/merge_requests/196`],
        ['GET', P],
        ['PUT', `${P}/merge_requests/196/merge`],
        ['GET', `${P}/merge_requests/196`],
        ['GET', `${P}/merge_requests?state=opened&target_branch=bauherr%2F7-1&per_page=100`],
        ['PUT', `${P}/merge_requests/197`],
        ['DELETE', `${P}/repository/branches/bauherr%2F7-1`],
      ],
    );
    assert.deepEqual(calls[2]!.body, { squash: true, sha: 'abc123' });
    assert.deepEqual(calls[5]!.body, { target_branch: 'main' });
  });

  void it(
    'merge: a moved head (409) and a not-mergeable MR (405) surface as ' + 'GitlabError; delete failure is reported',
    async () => {
      for (const status of [409, 405]) {
        const { forge } = setup((m, path) =>
          m === 'PUT' ? new Response('nope', { status }) : path === P ? {} : fx('mr'),
        );
        await assert.rejects(
          forge.mergePullRequest('g/p', 196, { method: 'squash', expectSha: 'old' }),
          (e) => e instanceof GitlabError && e.status === status,
        );
      }
      let merged = false;
      const { forge } = setup((m, path) => {
        if (m === 'PUT') merged = true;
        if (path === P) return {};
        if (path.startsWith(`${P}/merge_requests?`)) return [];
        return m === 'DELETE' ? new Response('boom', { status: 403 }) : merged ? fx('mr_merged') : fx('mr');
      });
      const r = await forge.mergePullRequest('g/p', 196, { method: 'squash', deleteBranch: true });
      assert.equal(r.mergeSha, 'def456');
      assert.match(r.branchDeleteError ?? '', /403/);
    },
  );

  void it('merge: polls until an asynchronous merge completes', async () => {
    let gets = 0;
    const sleeps: number[] = [];
    const { forge } = setup((m, path) => {
      if (path === P) return {};
      if (m === 'GET') return ++gets > 4 ? fx('mr_merged') : fx('mr');
      return {};
    }, sleeps);
    assert.equal((await forge.mergePullRequest('g/p', 196, { method: 'squash' })).mergeSha, 'def456');
    assert.deepEqual(sleeps, [500, 1000, 2000]);
  });

  void it('merge: a fast-forward merge without merge/squash sha falls back to the MR head sha', async () => {
    const ff = { ...fxObject('mr_merged'), squash_commit_sha: null, merge_commit_sha: null };
    const { forge } = setup(() => ff);
    assert.equal((await forge.mergePullRequest('g/p', 196, { method: 'squash' })).mergeSha, 'abc123');
  });

  void it(
    'merge: a merge that never completes is a MergePendingError; an already ' + 'merged MR is not re-PUT',
    async () => {
      const { forge, calls } = setup((_m, path) => (path === P ? {} : fx('mr')));
      await assert.rejects(forge.mergePullRequest('g/p', 196, { method: 'squash' }), MergePendingError);
      const merged = setup(() => fx('mr_merged'));
      assert.equal((await merged.forge.mergePullRequest('g/p', 196, { method: 'squash' })).mergeSha, 'def456');
      assert.ok(!merged.calls.some((c) => c.method === 'PUT'));
      assert.ok(calls.some((c) => c.method === 'PUT'));
    },
  );

  void it('merge: squash follows the project squash_option never', async () => {
    let merged = false;
    const { forge, calls } = setup((m, path) => {
      if (m === 'PUT') merged = true;
      return path === P ? { squash_option: 'never' } : merged ? fx('mr_merged') : fx('mr');
    });
    await forge.mergePullRequest('g/p', 196, { method: 'squash' });
    assert.deepEqual(calls.find((c) => c.method === 'PUT')!.body, { squash: false });
  });

  void it(
    'rerunFailed retries the pipeline of the failed jobs once; checks without a ' + 'pipeline re-run nothing',
    async () => {
      const { forge, calls } = setup((_m, path) =>
        path.includes('/jobs')
          ? fx('jobs')
          : path.includes('/bridges')
            ? []
            : path.endsWith('/retry')
              ? {}
              : fx('pipelines'),
      );
      const failed = (await forge.listChecks('g/p', 'abc123')).filter((c) => c.conclusion === 'failure');
      assert.equal(await forge.rerunFailed('g/p', [...failed, ...failed]), true);
      assert.deepEqual(
        calls.filter((c) => c.method === 'POST').map((c) => c.path),
        [`${P}/pipelines/2994845015/retry`],
      );
      assert.equal(
        await forge.rerunFailed('g/p', [{ name: 'child', status: 'completed', conclusion: 'failure' }]),
        false,
      );
    },
  );

  void it(
    'listChecks: failed pipeline without jobs is red, failed bridge is red, ' +
      'running pipeline without jobs is pending',
    async () => {
      const run = (status: string, bridges: unknown[] = []) =>
        setup((_m, path) =>
          path.includes('/jobs') ? [] : path.includes('/bridges') ? bridges : [{ id: 5, status }],
        ).forge.listChecks('g/p', 's');
      assert.deepEqual(
        (await run('failed')).map((c) => [c.name, c.status, c.conclusion]),
        [['pipeline', 'completed', 'failure']],
      );
      assert.deepEqual(
        (await run('canceled')).map((c) => [c.status, c.conclusion]),
        [['completed', 'cancelled']],
      );
      assert.deepEqual(
        (await run('running')).map((c) => [c.status, c.conclusion]),
        [['in_progress', null]],
      );
      assert.deepEqual(await run('success'), []);
      assert.deepEqual(
        (await run('failed', [{ id: 9, name: 'child', status: 'failed' }])).map((c) => [c.name, c.conclusion]),
        [['child', 'failure']],
      );
    },
  );

  void it('pagination refuses a Link to another origin and sends no token there', async () => {
    const { ts, calls } = setup(() => json([], { headers: { link: '<https://evil.test/x?page=2>; rel="next"' } }));
    await assert.rejects(ts.list(), /another origin/);
    assert.equal(calls.length, 1);
  });

  void it('a null source_project_id (deleted fork) is an unknown head repo, not an error', async () => {
    const { forge } = setup(() => [{ ...fxObject('mr_fork'), source_project_id: null }]);
    const [pr] = await forge.listPullRequests('g/p', 'all');
    assert.equal(pr!.headRepo, '');
  });
});
