import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Conflict } from '../src/index.js';
import { list } from '../src/wire.js';
import { fx, setup, P } from './gitlab-setup.js';

void describe('gitlab forge: repositories, files and merge requests', () => {
  void it('files: listFiles / getFile / putFile with expectSha', async () => {
    let blob = 'b1';
    const { forge, calls } = setup((m, path) => {
      if (path.includes('/repository/commits/')) return { id: 'c1' };
      if (path.includes('/repository/tree?'))
        return [
          { type: 'tree', path: 'd' },
          { type: 'blob', path: 'd/a.md' },
        ];
      if (path.includes('/missing.md?')) return new Response('{}', { status: 404 });
      if (m === 'GET' && path.includes('/repository/files/'))
        return { content: Buffer.from('héllo').toString('base64'), blob_id: blob, last_commit_id: 'lc1' };
      blob = 'b2';
      return { file_path: 'x', branch: 'b' };
    });
    assert.deepEqual(await forge.listFiles('g/p', 'main'), { commit: 'c1', paths: ['d/a.md'] });
    assert.ok(calls[1]!.path.includes('ref=c1&recursive=true'));
    assert.deepEqual(await forge.getFile('g/p', 'd x/a.md', 'c1'), { content: 'héllo', sha: 'b1' });
    assert.equal(calls.at(-1)!.path, `${P}/repository/files/d%20x%2Fa.md?ref=c1`);
    await assert.rejects(
      forge.putFile('g/p', { branch: 'b', path: 'd/a.md', content: 'x', message: 'm', expectSha: '' }),
      Conflict,
    );
    await assert.rejects(
      forge.putFile('g/p', { branch: 'b', path: 'd/a.md', content: 'x', message: 'm', expectSha: 'old' }),
      Conflict,
    );
    assert.deepEqual(
      await forge.putFile('g/p', { branch: 'b', path: 'd/a.md', content: 'x', message: 'm', expectSha: 'b1' }),
      { sha: 'b2' },
    );
    assert.deepEqual(calls.find((c) => c.method === 'PUT')!.body, {
      branch: 'b',
      content: 'x',
      commit_message: 'm',
      last_commit_id: 'lc1',
    });
    await forge
      .putFile('g/p', { branch: 'b', path: 'missing.md', content: 'x', message: 'm', expectSha: '' })
      .catch(() => {});
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  });

  void it('repositories and branches', async () => {
    const { forge, calls } = setup((m, path) => {
      if (path.startsWith('/projects?')) return fx('projects');
      if (m === 'POST') return { name: 'bauherr/7-1', commit: { id: 'sha1' } };
      if (path.endsWith('/repository/branches?per_page=100')) return [{ name: 'main', commit: { id: 'sha0' } }];
      return list(fx('projects'))[0];
    });
    const repo = { fullName: 'g/p', defaultBranch: 'main', private: true, url: 'https://gitlab.test/g/p' };
    assert.deepEqual(await forge.listRepositories(), [repo]);
    assert.deepEqual(await forge.getRepository('g/p'), repo);
    assert.deepEqual(await forge.listBranches('g/p'), [{ name: 'main', sha: 'sha0' }]);
    assert.deepEqual(await forge.createBranch('g/p', 'bauherr/7-1'), { name: 'bauherr/7-1', sha: 'sha1' });
    assert.equal(calls.at(-1)!.path, `${P}/repository/branches?branch=bauherr%2F7-1&ref=main`);
    assert.ok(calls[0]!.path.includes('membership=true'));
  });

  void it('merge requests: open / get / list / comment', async () => {
    const { forge, calls } = setup((_m, path) => {
      if (path === '/projects/99') return { path_with_namespace: 'fork/p' };
      if (path.includes('merge_requests?')) return [fx('mr'), fx('mr_merged'), fx('mr_fork')];
      if (path.endsWith('/notes'))
        return { id: 1, body: 'c', author: { username: 'bot' }, created_at: '2026-10-30T09:00:00.000Z' };
      if (path.endsWith('/197')) return fx('mr_fork');
      return fx('mr');
    });
    const pr = await forge.openPullRequest('g/p', {
      title: 'feat: x',
      body: 'Refs #7',
      head: 'bauherr/7-1',
      base: 'main',
    });
    assert.deepEqual(calls[0]!.body, {
      title: 'feat: x',
      description: 'Refs #7',
      source_branch: 'bauherr/7-1',
      target_branch: 'main',
    });
    assert.deepEqual(pr, {
      number: 196,
      url: 'https://gitlab.test/g/p/-/merge_requests/196',
      title: 'feat: x',
      body: 'Refs #7',
      state: 'open',
      head: 'bauherr/7-1',
      base: 'main',
      headSha: 'abc123',
      headRepo: 'g/p',
      baseRepo: 'g/p',
      draft: true,
      author: '',
      authorTrusted: false,
      authorIsBot: false,
      createdAt: '2026-10-30T08:00:00Z',
      updatedAt: '2026-10-30T08:30:00Z',
      labels: [],
      assignees: [],
      closes: [],
    });
    const fork = await forge.getPullRequest('g/p', 197);
    assert.deepEqual([fork.state, fork.headRepo, fork.baseRepo], ['closed', 'fork/p', 'g/p']);
    const all = await forge.listPullRequests('g/p', 'all');
    assert.deepEqual(
      all.map((p) => [p.number, p.state, p.mergeSha]),
      [
        [196, 'open', undefined],
        [196, 'merged', 'def456'],
        [197, 'closed', undefined],
      ],
    );
    assert.deepEqual(
      (await forge.listPullRequests('g/p', 'closed')).map((p) => p.state),
      ['merged', 'closed'],
    );
    assert.equal(calls.filter((c) => c.path === '/projects/99').length, 1, 'fork path cached');
    assert.equal((await forge.commentOnPullRequest('g/p', 196, 'c')).author, 'bot');
    assert.equal(calls.at(-1)!.path, `${P}/merge_requests/196/notes`);
  });

  void it(
    'reviewPullRequest opens one positioned discussion per line on the head ' + 'diff_refs, then the summary note',
    async () => {
      const { forge, calls } = setup((_m, path) => {
        if (path.endsWith('/merge_requests/196'))
          return { diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'h' } };
        if (path.endsWith('/notes'))
          return { id: 1, body: 'sum', author: { username: 'bot' }, created_at: '2026-10-30T09:00:00.000Z' };
        return {};
      });
      const c = await forge.reviewPullRequest('g/p', 196, {
        body: 'sum',
        comments: [{ path: 'a.ts', line: 3, body: 'x' }],
      });
      assert.deepEqual(
        calls.map((x) => [x.method, x.path]),
        [
          ['GET', `${P}/merge_requests/196`],
          ['POST', `${P}/merge_requests/196/discussions`],
          ['POST', `${P}/merge_requests/196/notes`],
        ],
      );
      assert.deepEqual(calls[1]!.body, {
        body: 'x',
        position: {
          position_type: 'text',
          base_sha: 'b',
          start_sha: 's',
          head_sha: 'h',
          new_path: 'a.ts',
          new_line: 3,
        },
      });
      assert.equal(c.body, 'sum');
    },
  );

  void it('listReviewThreads keeps positioned discussions and resolveReviewThread resolves one', async () => {
    const { forge, calls } = setup(() => [
      { id: 'd1', notes: [{ body: 'x', position: {}, resolvable: true, resolved: false }] },
      { id: 'd2', notes: [{ body: 'plain', resolvable: false }] },
    ]);
    assert.deepEqual(await forge.listReviewThreads('g/p', 196), [{ id: 'd1', body: 'x', resolved: false }]);
    await forge.resolveReviewThread('g/p', 196, 'd1');
    assert.deepEqual(
      [calls.at(-1)!.method, calls.at(-1)!.path],
      ['PUT', `${P}/merge_requests/196/discussions/d1?resolved=true`],
    );
  });

  void it('listPullRequestComments lists MR notes without system notes', async () => {
    const { forge, calls } = setup(() => fx('notes'));
    assert.deepEqual(
      (await forge.listPullRequestComments('g/p', 196)).map((c) => [c.id, c.author]),
      [
        ['12', 'bauherr-bot'],
        ['13', 'sebastian'],
      ],
    );
    assert.equal(calls[0]!.path, `${P}/merge_requests/196/notes?sort=asc&order_by=created_at&per_page=100`);
  });

  void it('listPullRequestFiles counts diff lines and maps status', async () => {
    const { forge } = setup(() => fx('diffs'));
    assert.deepEqual(await forge.listPullRequestFiles('g/p', 196), [
      { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1 },
      { filename: 'b.ts', status: 'added', additions: 1, deletions: 0 },
      { filename: 'd.ts', status: 'renamed', additions: 0, deletions: 0 },
    ]);
  });

  void it('compare joins the diffs of the compared range', async () => {
    const { forge, calls } = setup(() => ({
      diffs: [{ old_path: 'a.ts', new_path: 'b.ts', diff: '@@ -1 +1 @@\n-x\n+y\n' }],
    }));
    assert.equal(await forge.compare('g/p', 'abc', 'def'), '--- a/a.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-x\n+y\n');
    assert.equal(calls[0]!.path, `${P}/repository/compare?from=abc&to=def`);
  });
});
