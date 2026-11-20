import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  linkLabel,
  FakeBackend,
  GithubBackend,
  GitlabBackend,
  gitlabPat,
  NotQueueableError,
  patAuth,
} from '../src/index.js';
import { type Wire, text } from '../src/wire.js';
import { bodyOf, json, urlOf } from './helpers.js';

void describe('github merge queue', () => {
  const run = <T>(
    handler: (method: string, path: string, body: Wire | undefined) => Response,
    call: (f: GithubBackend['forge']) => Promise<T>,
  ) => {
    const calls: { method: string; path: string; body: Wire | undefined }[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        const call = {
          method: String(init?.method),
          path: new URL(urlOf(u)).pathname,
          body: bodyOf(init),
        };
        calls.push(call);
        return handler(call.method, call.path, call.body);
      },
    });
    return call(b.forge).then((res) => ({ res, calls }));
  };
  const pull = (state: Record<string, unknown> = {}) => ({
    number: 7,
    html_url: 'u',
    title: 't',
    body: '',
    state: 'open',
    head: { ref: 'bauherr/7', sha: 'h', repo: { full_name: 'o/r' } },
    base: { ref: 'main', repo: { full_name: 'o/r' } },
    node_id: 'PR_1',
    ...state,
  });
  const gql = (data: unknown) => json({ data });

  void it('queueSupport is true when the default branch has a merge queue', async () => {
    for (const [mergeQueue, want] of [
      [{ id: 'MQ' }, true],
      [null, false],
    ] as const) {
      const { res, calls } = await run(
        (_m, path) =>
          path === '/graphql'
            ? gql({ repository: { mergeQueue } })
            : json({ full_name: 'o/r', default_branch: 'trunk' }),
        (f) => f.queueSupport('o/r'),
      );
      assert.equal(res, want);
      assert.deepEqual(calls[1]!.body?.variables, { o: 'o', n: 'r', b: 'trunk' });
    }
  });
  void it('queueSupport surfaces GraphQL errors instead of reporting no queue', async () => {
    await assert.rejects(
      run(
        (_m, path) =>
          path === '/graphql'
            ? json({ errors: [{ message: 'Resource not accessible' }] })
            : json({ default_branch: 'main' }),
        (f) => f.queueSupport('o/r'),
      ),
      /Resource not accessible/,
    );
  });
  void it('requiredChecks lists the contexts of the required_status_checks rules', async () => {
    const rules = [
      { type: 'merge_queue', parameters: {} },
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'ci' }, { context: 'e2e (1)' }] },
      },
    ];
    const { res, calls } = await run(
      () => json(rules),
      (f) => f.requiredChecks('o/r', 'main'),
    );
    assert.deepEqual(res, ['ci', 'e2e (1)']);
    assert.equal(calls[0]!.path, '/repos/o/r/rules/branches/main');
  });
  void it(
    'enqueue PUTs merge-async with the pinned head; 409 means already queued; ' + '400 and 405 are NotQueueableError',
    async () => {
      const ok = await run(
        (m) => (m === 'PUT' ? json({}, { status: 202 }) : json(pull())),
        (f) => f.enqueuePullRequest('o/r', 7, { expectSha: 'h' }),
      );
      assert.deepEqual(ok.res, { state: 'queued' });
      assert.deepEqual(ok.calls.at(-1), {
        method: 'PUT',
        path: '/repos/o/r/pulls/7/merge-async',
        body: { merge_action: 'merge_queue', sha: 'h' },
      });
      assert.deepEqual(
        (
          await run(
            (m) => (m === 'PUT' ? new Response('pending', { status: 409 }) : json(pull())),
            (f) => f.enqueuePullRequest('o/r', 7, { expectSha: 'h' }),
          )
        ).res,
        { state: 'queued' },
      );
      for (const status of [400, 405]) {
        await assert.rejects(
          run(
            (m) =>
              m === 'PUT' ? new Response('Changes must be made through the merge queue', { status }) : json(pull()),
            (f) => f.enqueuePullRequest('o/r', 7, { expectSha: 'h' }),
          ),
          (e) => e instanceof NotQueueableError && /merge queue/.test(e.message),
        );
      }
      await assert.rejects(
        run(
          (m) => (m === 'PUT' ? new Response('boom', { status: 500 }) : json(pull())),
          (f) => f.enqueuePullRequest('o/r', 7, { expectSha: 'h' }),
        ),
        /500/,
      );
    },
  );
  void it('enqueue of a merged PR reports merged with its sha and sends nothing', async () => {
    const { res, calls } = await run(
      () => json(pull({ merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: 'm9' })),
      (f) => f.enqueuePullRequest('o/r', 7, { expectSha: 'h' }),
    );
    assert.deepEqual(res, { state: 'merged', mergeSha: 'm9' });
    assert.ok(!calls.some((c) => c.method === 'PUT'));
  });
  void it('isQueued reads mergeQueueEntry; dequeue mutates only a queued PR', async () => {
    const entry = (e: unknown) => (_m: string, path: string) =>
      path === '/graphql' ? gql({ repository: { pullRequest: { mergeQueueEntry: e } } }) : json(pull());
    assert.equal((await run(entry({ id: 'E' }), (f) => f.isQueued('o/r', 7))).res, true);
    assert.equal((await run(entry(null), (f) => f.isQueued('o/r', 7))).res, false);
    const idle = await run(entry(null), (f) => f.dequeuePullRequest('o/r', 7));
    assert.equal(idle.calls.length, 1);
    const queued = await run(entry({ id: 'E' }), (f) => f.dequeuePullRequest('o/r', 7));
    assert.match(text(queued.calls.at(-1)!.body?.query), /dequeuePullRequest/);
    assert.deepEqual(queued.calls.at(-1)!.body?.variables, { id: 'PR_1' });
  });
  void it('resetBranch force-patches the ref and creates it when the ref does not exist', async () => {
    const patched = await run(
      () => json({}),
      (f) => f.resetBranch('o/r', 'bauherr/train', 's1'),
    );
    assert.deepEqual(patched.calls, [
      { method: 'PATCH', path: '/repos/o/r/git/refs/heads/bauherr/train', body: { sha: 's1', force: true } },
    ]);
    const created = await run(
      (m) => (m === 'PATCH' ? new Response('nf', { status: 422 }) : json({})),
      (f) => f.resetBranch('o/r', 'bauherr/train', 's1'),
    );
    assert.deepEqual(created.calls.at(-1), {
      method: 'POST',
      path: '/repos/o/r/git/refs',
      body: { ref: 'refs/heads/bauherr/train', sha: 's1' },
    });
    await assert.rejects(
      run(
        () => new Response('boom', { status: 500 }),
        (f) => f.resetBranch('o/r', 'bauherr/train', 's1'),
      ),
      /500/,
    );
  });
  void it('deleteBranch deletes the ref; a missing ref is fine, other errors surface', async () => {
    const del = await run(
      () => new Response(null, { status: 204 }),
      (f) => f.deleteBranch('o/r', 'bauherr/9-epic'),
    );
    assert.deepEqual(del.calls, [
      { method: 'DELETE', path: '/repos/o/r/git/refs/heads/bauherr/9-epic', body: undefined },
    ]);
    await run(
      () => new Response('nf', { status: 422 }),
      (f) => f.deleteBranch('o/r', 'bauherr/9-epic'),
    );
    await assert.rejects(
      run(
        () => new Response('boom', { status: 500 }),
        (f) => f.deleteBranch('o/r', 'bauherr/9-epic'),
      ),
      /500/,
    );
  });
  void it(
    'mergeIntoBranch POSTs /merges with the head sha; 201 gives the merge sha, ' + '204 the branch tip, 409 a conflict',
    async () => {
      const ok = await run(
        () => json({ sha: 'm1' }, { status: 201 }),
        (f) => f.mergeIntoBranch('o/r', 'bauherr/train', 'h1'),
      );
      assert.deepEqual(ok.res, { sha: 'm1' });
      assert.deepEqual(ok.calls[0], {
        method: 'POST',
        path: '/repos/o/r/merges',
        body: { base: 'bauherr/train', head: 'h1', commit_message: 'bauherr train: merge h1' },
      });
      const same = await run(
        (m) => (m === 'POST' ? new Response(null, { status: 204 }) : json({ object: { sha: 'tip' } })),
        (f) => f.mergeIntoBranch('o/r', 'bauherr/train', 'h1'),
      );
      assert.deepEqual(same.res, { sha: 'tip' });
      assert.deepEqual(
        (
          await run(
            () => new Response('conflict', { status: 409 }),
            (f) => f.mergeIntoBranch('o/r', 'bauherr/train', 'h1'),
          )
        ).res,
        { conflict: true },
      );
      await assert.rejects(
        run(
          () => new Response('boom', { status: 500 }),
          (f) => f.mergeIntoBranch('o/r', 'bauherr/train', 'h1'),
        ),
        /500/,
      );
    },
  );
});

void describe('forge link label', () => {
  void it('names the PR of each forge in plain words', () => {
    assert.equal(
      new GithubBackend({ auth: patAuth('t') }).forge.linkLabel({ number: 88 }),
      'Open pull request #88 on GitHub',
    );
    assert.equal(
      new GitlabBackend({ auth: gitlabPat('t'), baseUrl: 'https://gitlab.test' }).forge.linkLabel({ number: 88 }),
      'Open merge request !88 on GitLab',
    );
    assert.equal(new FakeBackend().forge.linkLabel({ number: 88 }), 'Open pull request #88 on GitHub');
    assert.equal(linkLabel('github', 88), 'Open pull request #88 on GitHub');
    assert.equal(linkLabel('gitlab', 88), 'Open merge request !88 on GitLab');
    assert.equal(linkLabel(null, 88), 'Open merge request');
  });
});
