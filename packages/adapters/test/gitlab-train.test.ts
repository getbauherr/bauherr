import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GitlabError, MergePendingError, NotQueueableError } from '../src/index.js';
import { type Call, fx, fxObject, setup, P } from './gitlab-setup.js';

void describe('gitlab merge trains', () => {
  void it('queueSupport needs merge trains and merged-results pipelines', async () => {
    for (const [p, want] of [
      [{ merge_trains_enabled: true, merge_pipelines_enabled: true }, true],
      [{ merge_trains_enabled: true, merge_pipelines_enabled: false }, false],
      [{}, false],
    ] as const) {
      assert.equal(await setup(() => p).forge.queueSupport('g/p'), want);
    }
  });
  void it(
    'enqueue POSTs the train entry pinned to the reviewed head; 400 and 405 are ' +
      'NotQueueableError, 409 stays an error',
    async () => {
      const { forge, calls } = setup((m) => (m === 'POST' ? fx('merge_train') : fx('mr')));
      assert.deepEqual(await forge.enqueuePullRequest('g/p', 196, { expectSha: 'abc123' }), { state: 'queued' });
      assert.deepEqual(calls.at(-1), {
        method: 'POST',
        path: `${P}/merge_trains/merge_requests/196`,
        body: { sha: 'abc123', auto_merge: true, squash: true },
        token: 'tok',
      });
      for (const status of [400, 405]) {
        await assert.rejects(
          setup((m) => (m === 'POST' ? new Response('not mergeable', { status }) : fx('mr'))).forge.enqueuePullRequest(
            'g/p',
            196,
            { expectSha: 'abc123' },
          ),
          NotQueueableError,
        );
      }
      await assert.rejects(
        setup((m) => (m === 'POST' ? new Response('sha', { status: 409 }) : fx('mr'))).forge.enqueuePullRequest(
          'g/p',
          196,
          { expectSha: 'old' },
        ),
        (e) => e instanceof GitlabError && e.status === 409,
      );
    },
  );
  void it('enqueue of a merged MR reports merged with its sha and sends nothing', async () => {
    const { forge, calls } = setup(() => fx('mr_merged'));
    assert.deepEqual(await forge.enqueuePullRequest('g/p', 196, { expectSha: 'abc123' }), {
      state: 'merged',
      mergeSha: 'def456',
    });
    assert.ok(!calls.some((c) => c.method === 'POST'));
  });
  void it('isQueued is true for a train car, false for 404 and merged cars', async () => {
    assert.equal(await setup(() => fx('merge_train')).forge.isQueued('g/p', 196), true);
    assert.equal(
      await setup(() => ({ ...fxObject('merge_train'), status: 'merged' })).forge.isQueued('g/p', 196),
      false,
    );
    assert.equal(await setup(() => new Response('{}', { status: 404 })).forge.isQueued('g/p', 196), false);
  });
  void it('dequeue cancels the auto-merge and ignores an MR with nothing to cancel', async () => {
    const { forge, calls } = setup(() => fx('mr'));
    await forge.dequeuePullRequest('g/p', 196);
    assert.equal(calls[0]!.path, `${P}/merge_requests/196/cancel_merge_when_pipeline_succeeds`);
    await setup(() => new Response('', { status: 405 })).forge.dequeuePullRequest('g/p', 196);
  });
});

void describe('gitlab train branch', () => {
  const mr = {
    ...fxObject('mr'),
    iid: 300,
    state: 'opened',
    draft: false,
    source_branch: 'bauherr/train-merge-abcdef123456',
    target_branch: 'bauherr/train',
  };
  void it('resetBranch deletes the branch (a missing one is fine) and creates it at the sha', async () => {
    const { forge, calls } = setup((m) => (m === 'DELETE' ? new Response('', { status: 404 }) : {}));
    await forge.resetBranch('g/p', 'bauherr/train', 's1');
    assert.deepEqual(
      calls.map((c) => [c.method, c.path]),
      [
        ['DELETE', `${P}/repository/branches/bauherr%2Ftrain`],
        ['POST', `${P}/repository/branches?branch=bauherr%2Ftrain&ref=s1`],
      ],
    );
  });
  void it('deleteBranch deletes the branch; a missing one is fine', async () => {
    const { forge, calls } = setup((m) => (m === 'DELETE' ? new Response('', { status: 404 }) : {}));
    await forge.deleteBranch('g/p', 'bauherr/9-epic');
    assert.deepEqual(
      calls.map((c) => [c.method, c.path]),
      [['DELETE', `${P}/repository/branches/bauherr%2F9-epic`]],
    );
  });
  void it('mergeIntoBranch merges a temporary MR without squash and returns its merge sha', async () => {
    const { forge, calls } = setup((m, path) => {
      if (is(m, path, 'GET', '/repository/branches/bauherr%2Ftrain'))
        return { name: 'bauherr/train', commit: { id: 'tip' } };
      if (path.includes('/repository/commits/')) return { id: 'abcdef1234567890' };
      if (path.includes('/repository/merge_base')) return { id: 'older' };
      if (is(m, path, 'POST', '/merge_requests')) return mr;
      if (m === 'GET' && path.endsWith('/merge_requests/300'))
        return { ...mr, state: 'merged', merge_commit_sha: 'm1' };
      return {};
    });
    assert.deepEqual(await forge.mergeIntoBranch('g/p', 'bauherr/train', 'abcdef1234567890'), { sha: 'm1' });
    const merge = calls.find((c) => c.method === 'PUT' && c.path.endsWith('/merge'))!;
    assert.deepEqual(merge.body, { squash: false, should_remove_source_branch: true, sha: 'abcdef1234567890' });
    assert.equal(
      calls.find((c) => c.method === 'POST' && c.path.endsWith('/merge_requests'))!.body?.target_branch,
      'bauherr/train',
    );
  });
  const is = (m: string, path: string, method: string, tail: string) => m === method && path.endsWith(tail);
  const train = (statuses: object[], mergeResponse: () => Response | object = () => ({})) => {
    let polls = 0;
    const sleeps: number[] = [];
    const r = setup((m, path) => {
      if (is(m, path, 'GET', '/repository/branches/bauherr%2Ftrain'))
        return { name: 'bauherr/train', commit: { id: 'tip' } };
      if (path.includes('/repository/commits/')) return { id: 'abcdef1234567890' };
      if (path.includes('/repository/merge_base')) return { id: 'older' };
      if (is(m, path, 'POST', '/merge_requests')) return mr;
      if (is(m, path, 'PUT', '/merge')) return mergeResponse();
      if (is(m, path, 'GET', '/merge_requests/300')) {
        const st = statuses[Math.min(polls++, statuses.length - 1)]!;
        return { ...mr, ...st };
      }
      return mr;
    }, sleeps);
    return { ...r, sleeps };
  };
  const cleaned = (calls: Call[]) => {
    assert.ok(
      calls.some((c) => c.method === 'PUT' && c.path === `${P}/merge_requests/300` && c.body?.state_event === 'close'),
    );
    assert.ok(calls.filter((c) => c.method === 'DELETE').length >= 2);
  };
  void it('waits while merge_status is checking, then merges the temporary MR', async () => {
    const { forge, calls, sleeps } = train([
      { detailed_merge_status: 'checking' },
      { detailed_merge_status: 'mergeable' },
      { state: 'merged', detailed_merge_status: 'not_open', merge_commit_sha: 'm1' },
    ]);
    assert.deepEqual(await forge.mergeIntoBranch('g/p', 'bauherr/train', 'abcdef1234567890'), { sha: 'm1' });
    assert.deepEqual(sleeps, [500]);
    assert.ok(calls.some((c) => c.method === 'PUT' && c.path.endsWith('/merge')));
  });
  void it(
    'real conflicts (has_conflicts, conflict) are reported as a conflict ' +
      'without merging; the temp MR and branch are cleaned up',
    async () => {
      for (const st of [
        { has_conflicts: true, merge_status: 'cannot_be_merged' },
        { detailed_merge_status: 'conflict' },
      ]) {
        const { forge, calls } = train([st]);
        assert.deepEqual(await forge.mergeIntoBranch('g/p', 'bauherr/train', 'abcdef1234567890'), { conflict: true });
        assert.ok(!calls.some((c) => c.method === 'PUT' && c.path.endsWith('/merge')));
        cleaned(calls);
      }
    },
  );
  void it(
    'a 405 without a conflict (pipelines must succeed) is an error naming the ' + 'setting, not a conflict; cleaned up',
    async () => {
      const { forge, calls } = train(
        [{ detailed_merge_status: 'ci_must_pass' }],
        () => new Response('pipeline must succeed', { status: 405 }),
      );
      await assert.rejects(
        forge.mergeIntoBranch('g/p', 'bauherr/train', 'abcdef1234567890'),
        (e) =>
          e instanceof GitlabError &&
          e.status === 405 &&
          /ci_must_pass/.test(e.message) &&
          /merge settings/.test(e.message),
      );
      cleaned(calls);
    },
  );
  void it('a merge status that never settles is a retryable error, not a conflict; cleaned up', async () => {
    const { forge, calls } = train([{ detailed_merge_status: 'checking' }]);
    await assert.rejects(forge.mergeIntoBranch('g/p', 'bauherr/train', 'abcdef1234567890'), MergePendingError);
    cleaned(calls);
  });
});
