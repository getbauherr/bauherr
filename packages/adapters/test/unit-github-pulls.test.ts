import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GithubBackend, patAuth } from '../src/index.js';
import { type Wire } from '../src/wire.js';
import { bodyOf, json, urlOf } from './helpers.js';

void describe('github reviewPullRequest', () => {
  void it('posts one COMMENT review with RIGHT-side line comments and lists its body with the comments', async () => {
    const calls: { method: string; url: string; body: Wire | undefined }[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        const url = new URL(urlOf(u));
        calls.push({
          method: init?.method ?? 'GET',
          url: url.pathname,
          body: bodyOf(init),
        });
        if (init?.method === 'POST') return json({ id: 9, user: { login: 'bot' }, body: 'sum', submitted_at: 't' });
        return json(
          url.pathname.endsWith('/reviews')
            ? [
                { id: 9, user: { login: 'bot' }, body: 'sum', submitted_at: 't' },
                { id: 10, user: { login: 'bot' }, body: '' },
              ]
            : [],
        );
      },
    });
    const c = await b.forge.reviewPullRequest('o/r', 5, {
      body: 'sum',
      comments: [{ path: 'a.ts', line: 3, body: 'x' }],
    });
    assert.deepEqual(calls[0], {
      method: 'POST',
      url: '/repos/o/r/pulls/5/reviews',
      body: { event: 'COMMENT', body: 'sum', comments: [{ path: 'a.ts', line: 3, side: 'RIGHT', body: 'x' }] },
    });
    assert.deepEqual([c.id, c.author, c.body], ['9', 'bot', 'sum']);
    assert.deepEqual(
      (await b.forge.listPullRequestComments('o/r', 5)).map((x) => x.body),
      ['sum'],
    );
  });
});

void describe('github review threads', () => {
  void it('lists threads over GraphQL and resolves one by id', async () => {
    const calls: { url: string; body: Wire | undefined }[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        calls.push({ url: new URL(urlOf(u)).pathname, body: bodyOf(init) });
        return json({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: { nodes: [{ id: 'T1', isResolved: false, comments: { nodes: [{ body: 'x' }] } }] },
              },
            },
          },
        });
      },
    });
    assert.deepEqual(await b.forge.listReviewThreads('o/r', 5), [{ id: 'T1', body: 'x', resolved: false }]);
    await b.forge.resolveReviewThread('o/r', 5, 'T1');
    assert.equal(calls[1]!.url, '/graphql');
    assert.deepEqual(calls[1]!.body?.variables, { id: 'T1' });
  });
});

void describe('github mergePullRequest', () => {
  const run = async (
    headRepo: string,
    del: Response = new Response(null, { status: 204 }),
    stacked: number[] = [],
    patch: Response | null = null,
  ) => {
    const calls: { method: string; url: string; body: Wire | undefined }[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        const method = String(init?.method);
        calls.push({
          method,
          url: new URL(urlOf(u)).pathname,
          body: bodyOf(init),
        });
        if (method === 'PUT') return json({ sha: 'm1', merged: true });
        if (method === 'DELETE') return del;
        if (method === 'PATCH') return patch ?? json({});
        if (method === 'GET' && new URL(urlOf(u)).pathname === '/repos/o/r/pulls')
          return json(stacked.map((number) => ({ number })));
        return json({
          number: 7,
          html_url: 'u',
          title: 't',
          body: '',
          state: 'open',
          head: { ref: 'bauherr/7', sha: 'h', repo: { full_name: headRepo } },
          base: { ref: 'main', repo: { full_name: 'o/r' } },
        });
      },
    });
    const res = await b.forge.mergePullRequest('o/r', 7, { method: 'squash', deleteBranch: true, expectSha: 'h' });
    return { calls, res };
  };
  void it('PUTs a squash merge pinned to the head sha, then deletes a same-repo branch', async () => {
    const { calls, res } = await run('o/r');
    assert.deepEqual(res, { mergeSha: 'm1' });
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url}`),
      [
        'GET /repos/o/r/pulls/7',
        'PUT /repos/o/r/pulls/7/merge',
        'GET /repos/o/r/pulls',
        'DELETE /repos/o/r/git/refs/heads/bauherr/7',
      ],
    );
    assert.deepEqual(calls[1]!.body, { merge_method: 'squash', sha: 'h' });
  });
  void it(
    'retargets the PRs stacked on the head branch to the merged PR base before ' + 'it deletes the branch',
    async () => {
      const { calls, res } = await run('o/r', undefined, [8, 9]);
      assert.deepEqual(res, { mergeSha: 'm1' });
      assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`).slice(2), [
        'GET /repos/o/r/pulls',
        'PATCH /repos/o/r/pulls/8',
        'PATCH /repos/o/r/pulls/9',
        'DELETE /repos/o/r/git/refs/heads/bauherr/7',
      ]);
      assert.deepEqual(calls.find((c) => c.method === 'PATCH')!.body, { base: 'main' });
    },
  );
  void it('keeps the branch and reports it when a stacked PR cannot be retargeted', async () => {
    const { calls, res } = await run('o/r', undefined, [8], new Response('no', { status: 422 }));
    assert.equal(res.mergeSha, 'm1');
    assert.match(res.branchDeleteError ?? '', /kept bauherr\/7.*retargeting/);
    assert.ok(!calls.some((c) => c.method === 'DELETE'));
  });
  void it('never deletes a fork head branch', async () => {
    const { calls } = await run('evil/r');
    assert.ok(!calls.some((c) => c.method === 'DELETE'));
  });
  void it('reports a failed delete without failing the merge, and ignores 404', async () => {
    assert.match((await run('o/r', new Response('boom', { status: 500 }))).res.branchDeleteError ?? '', /500/);
    assert.equal((await run('o/r', new Response('gone', { status: 404 }))).res.branchDeleteError, undefined);
  });
});

void describe('github pull request mergeable', () => {
  const get = async (extra: object) => {
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async () =>
        json({
          number: 7,
          html_url: 'u',
          title: 't',
          body: '',
          state: 'open',
          head: { ref: 'f', sha: 'h', repo: { full_name: 'o/r' } },
          base: { ref: 'main', repo: { full_name: 'o/r' } },
          ...extra,
        }),
    });
    return (await b.forge.getPullRequest('o/r', 7)).mergeable;
  };
  void it('maps mergeable false, mergeable_state dirty, true and null', async () => {
    assert.equal(await get({ mergeable: false }), false);
    assert.equal(await get({ mergeable: null, mergeable_state: 'dirty' }), false);
    assert.equal(await get({ mergeable: true, mergeable_state: 'clean' }), true);
    assert.equal(await get({ mergeable: null }), undefined);
  });
});
