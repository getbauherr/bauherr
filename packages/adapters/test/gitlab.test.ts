import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { GitlabBackend, GitlabError, MergePendingError, gitlabPat } from '../src/index.js';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`../../test/fixtures/gitlab/${name}.json`, import.meta.url), 'utf8'));
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
const API = 'https://gitlab.test/api/v4';
const P = '/projects/g%2Fp';

type Call = { method: string; path: string; body: any; token: string | null };
/** Stub fetch: `handler(method, path, body)` returns a body or a Response; every call is recorded. */
const setup = (handler: (method: string, path: string, body: any) => unknown, sleeps: number[] = []) => {
  const calls: Call[] = [];
  const b = new GitlabBackend({
    auth: gitlabPat('tok'), baseUrl: 'https://gitlab.test/', sleep: async (ms) => void sleeps.push(ms),
    fetch: async (u, init) => {
      const path = String(u).slice(API.length);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: init?.method ?? 'GET', path, body, token: new Headers(init?.headers).get('private-token') });
      const r = handler(init?.method ?? 'GET', path, body);
      return r instanceof Response ? r : json(r);
    },
  });
  return { b, calls, ts: b.tickets('g/p'), forge: b.forge };
};

describe('gitlab tickets', () => {
  it('capabilities, get maps issue, relations and close reason', async () => {
    const { b, ts, calls } = setup(() => fx('issue'));
    assert.deepEqual(b.capabilities, { attachments: false, nativeSubTickets: false, nativeBlocking: false, webhooks: false });
    const t = await ts.get('7');
    assert.deepEqual(calls.map((c) => [c.method, c.path, c.token]), [['GET', `${P}/issues/7`, 'tok']]);
    assert.deepEqual(t, {
      id: '7', number: 7, url: 'https://gitlab.test/g/p/-/issues/7', title: 'Dark theme', state: 'closed',
      labels: ['bauherr:stage:build', 'bauherr:close-reason:not_planned'], assignee: 'bauherr-bot', assignees: ['bauherr-bot', 'sebastian'],
      updatedAt: '2026-10-30T10:00:00Z', body: 'Body text', parent: '1', blockedBy: ['3'], links: ['https://gitlab.test/g/p/-/merge_requests/2'],
      closeReason: 'not_planned',
    });
  });

  it('list sends state and labels, follows Link pagination', async () => {
    const { ts, calls } = setup((_m, path) => path.includes('page=2')
      ? fx('issues_page2')
      : json(fx('issues_page1'), { headers: { link: `<${API}${P}/issues?page=2>; rel="next"` } }));
    const l = await ts.list({ state: 'open', labels: ['a', 'b'] });
    assert.deepEqual(l.map((x) => [x.id, x.state]), [['1', 'open'], ['2', 'closed'], ['3', 'open']]);
    const q = new URL(API + calls[0]!.path).searchParams;
    assert.deepEqual([q.get('state'), q.get('labels'), q.get('per_page')], ['opened', 'a,b', '100']);
  });

  it('poll: updated_after only with a cursor, cursor = last updatedAt', async () => {
    const { ts, calls } = setup(() => fx('issues_page1'));
    const first = await ts.poll(null);
    const again = await ts.poll('2026-10-30T09:00:00.000+00:00');
    const q = (n: number) => new URL(API + calls[n]!.path).searchParams;
    assert.equal(q(0).has('updated_after'), false);
    assert.deepEqual([q(0).get('state'), q(0).get('order_by'), q(0).get('sort')], ['all', 'updated_at', 'asc']);
    assert.equal(q(1).get('updated_after'), '2026-10-30T09:00:00.000Z');
    assert.equal(first.next, '2026-10-30T09:30:00Z');
    assert.equal(again.changes.length, 2);
    assert.equal((await setup(() => []).ts.poll('2026-01-01T00:00:00Z')).next, '2026-01-01T00:00:00Z');
  });

  it('create posts title/description/labels then reads the issue back', async () => {
    const { ts, calls } = setup((m) => (m === 'POST' ? { iid: 7 } : fx('issue')));
    await ts.create({ title: 'T', body: 'B', labels: ['a', 'b'] });
    assert.deepEqual(calls.map((c) => [c.method, c.path]), [['POST', `${P}/issues`], ['GET', `${P}/issues/7`]]);
    assert.deepEqual(calls[0]!.body, { title: 'T', description: 'B', labels: 'a,b' });
  });

  it('comments: system notes dropped, since filters on updated_at, create/update shape', async () => {
    const { ts, calls } = setup((m, path) => (m === 'GET' ? fx('notes') : { id: 12, body: 'x', author: { username: 'bauherr-bot' }, created_at: '2026-10-30T09:10:00.000Z' }));
    assert.deepEqual((await ts.listComments('7')).map((c) => [c.id, c.author, c.createdAt]), [['12', 'bauherr-bot', '2026-10-30T09:10:00Z'], ['13', 'sebastian', '2026-10-30T09:20:00Z']]);
    assert.deepEqual((await ts.listComments('7', '2026-10-30T09:40:00Z')).map((c) => c.id), ['13']);
    await ts.comment('7', 'hi');
    await ts.updateComment('7', '12', 'edit');
    assert.deepEqual(calls.slice(2).map((c) => [c.method, c.path, c.body]), [
      ['POST', `${P}/issues/7/notes`, { body: 'hi' }], ['PUT', `${P}/issues/7/notes/12`, { body: 'edit' }],
    ]);
  });

  it('labels: add_labels / remove_labels (unknown labels are no error)', async () => {
    const { ts, calls } = setup(() => fx('issue'));
    await ts.addLabels('7', ['a', 'b']);
    await ts.removeLabels('7', ['gone', 'c']);
    assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [
      ['PUT', `${P}/issues/7`, { add_labels: 'a,b' }], ['PUT', `${P}/issues/7`, { remove_labels: 'gone,c' }],
    ]);
  });

  it('claim resolves the user id, keeps other assignees and verifies it stuck', async () => {
    const { ts, calls } = setup((m, path) => path.startsWith('/users') ? fx('users')
      : m === 'GET' ? { assignees: [{ id: 6, username: 'sebastian' }] } : { assignees: [{ id: 6, username: 'sebastian' }, { id: 5, username: 'Bauherr-Bot' }] });
    await ts.claim('7', 'bauherr-bot');
    assert.deepEqual(calls.map((c) => [c.method, c.path, c.body]), [
      ['GET', '/users?username=bauherr-bot', undefined], ['GET', `${P}/issues/7`, undefined], ['PUT', `${P}/issues/7`, { assignee_ids: [6, 5] }],
    ]);
  });

  it('claim throws when the user is unknown or the assignee did not stick', async () => {
    await assert.rejects(setup((_m, path) => (path.startsWith('/users') ? [] : {})).ts.claim('7', 'nobody'), { status: 422 });
    const notApplied = setup((m, path) => (path.startsWith('/users') ? fx('users') : { assignees: [] }));
    await assert.rejects(notApplied.ts.claim('7', 'bauherr-bot'), { status: 422 });
  });

  it('release, unassign, userExists', async () => {
    const { ts, calls } = setup((m, path) => (path.startsWith('/users') ? (path.endsWith('ghost') ? [] : fx('users')) : fx('issue')));
    await ts.release('7');
    await ts.unassign('7', ['Sebastian']);
    await ts.unassign('7', []);
    assert.equal(await ts.userExists('bauherr-bot'), true);
    assert.equal(await ts.userExists('ghost'), false);
    assert.deepEqual(calls.filter((c) => c.method === 'PUT').map((c) => c.body), [{ assignee_ids: [] }, { assignee_ids: [5] }]);
    assert.equal(calls.length, 5);
  });

  it('close adds the reason label; reopen drops it and only reopens a closed issue', async () => {
    const { ts, calls } = setup((m) => (m === 'GET' ? fx('issue') : {}));
    await ts.close('7', 'duplicate');
    await ts.reopen('7');
    const opened = setup((m) => (m === 'GET' ? { state: 'opened' } : {}));
    await opened.ts.reopen('7');
    assert.deepEqual(calls[0]!.body, { state_event: 'close', add_labels: 'bauherr:close-reason:duplicate' });
    assert.deepEqual(calls[2]!.body, { state_event: 'reopen', remove_labels: 'bauherr:close-reason:completed,bauherr:close-reason:not_planned,bauherr:close-reason:duplicate' });
    assert.equal('state_event' in opened.calls[1]!.body, false);
  });

  it('relations live in the description: addSubTicket, addBlockedBy, addLink', async () => {
    const issues: Record<string, string> = { 1: 'parent', 2: 'child', 3: 'blocker' };
    const { ts, calls } = setup((m, path, body) => {
      const id = /issues\/(\d)/.exec(path)![1]!;
      if (m === 'PUT') issues[id] = body.description;
      return { iid: Number(id), state: 'opened', description: issues[id] };
    });
    await ts.addSubTicket('1', '2');
    await ts.addBlockedBy('2', '3');
    await ts.addLink('2', 'https://x/y');
    assert.equal(issues[2], 'child\n\n<!-- bauherr:relations -->\nParent: #1\nBlocked by: #3\nLink: https://x/y\n<!-- /bauherr:relations -->');
    await assert.rejects(ts.addSubTicket('1', '2'), /one parent/);
    await assert.rejects(ts.addBlockedBy('2', '3'), /already blocked/);
    assert.ok(calls.every((c) => c.path.startsWith(`${P}/issues/`)));
  });

  it('listSubTickets searches the description then filters exactly; frontier drops blocked ones', async () => {
    const rel = (parent: string, blocked: string[] = []) => `x\n\n<!-- bauherr:relations -->\nParent: #${parent}\n${blocked.map((b) => `Blocked by: #${b}`).join('\n')}\n<!-- /bauherr:relations -->`;
    const issue = (iid: number, state: string, description: string) => ({ iid, state, description, labels: [], assignees: [], web_url: '', title: '', updated_at: '2026-10-30T09:00:00Z' });
    const all: Record<string, any> = {
      2: issue(2, 'opened', rel('1')), 3: issue(3, 'opened', rel('1', ['4'])), 4: issue(4, 'opened', ''), 5: issue(5, 'closed', rel('1')),
      6: issue(6, 'opened', rel('1', ['5'])), 10: issue(10, 'opened', rel('10')), 11: issue(11, 'opened', rel('11')),
    };
    const { ts, calls } = setup((_m, path) => {
      if (path.includes('/issues?')) return [all[2], all[3], all[5], all[6], issue(11, 'opened', rel('11'))];
      return all[/issues\/(\d+)/.exec(path)![1]!];
    });
    assert.deepEqual((await ts.listSubTickets('1')).map((s) => s.id), ['2', '3', '5', '6']);
    const q = new URL(API + calls[0]!.path).searchParams;
    assert.deepEqual([q.get('search'), q.get('in'), q.get('state')], ['Parent: #1', 'description', 'all']);
    assert.deepEqual((await ts.frontier('1')).map((s) => s.id), ['2', '6']);
  });

  it('429 is retried after Retry-After, then succeeds; exhausted retries throw GitlabError', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const { ts } = setup(() => (n++ < 2 ? new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }) : fx('issue')), sleeps);
    assert.equal((await ts.get('7')).id, '7');
    assert.deepEqual(sleeps, [7000, 7000]);
    const dead = setup(() => new Response('no', { status: 429, headers: { 'retry-after': '1' } }), []);
    await assert.rejects(dead.ts.get('7'), (e) => e instanceof GitlabError && e.status === 429);
    const huge = setup(() => new Response('no', { status: 429, headers: { 'retry-after': '99999' } }));
    await assert.rejects(huge.ts.get('7'), /rate limited for 99999000 ms/);
  });
});

describe('gitlab forge', () => {
  it('repositories and branches', async () => {
    const { forge, calls } = setup((m, path) => {
      if (path.startsWith('/projects?')) return fx('projects');
      if (m === 'POST') return { name: 'bauherr/7-1', commit: { id: 'sha1' } };
      if (path.endsWith('/repository/branches?per_page=100')) return [{ name: 'main', commit: { id: 'sha0' } }];
      return fx('projects')[0];
    });
    const repo = { fullName: 'g/p', defaultBranch: 'main', private: true, url: 'https://gitlab.test/g/p' };
    assert.deepEqual(await forge.listRepositories(), [repo]);
    assert.deepEqual(await forge.getRepository('g/p'), repo);
    assert.deepEqual(await forge.listBranches('g/p'), [{ name: 'main', sha: 'sha0' }]);
    assert.deepEqual(await forge.createBranch('g/p', 'bauherr/7-1'), { name: 'bauherr/7-1', sha: 'sha1' });
    assert.equal(calls.at(-1)!.path, `${P}/repository/branches?branch=bauherr%2F7-1&ref=main`);
    assert.ok(calls[0]!.path.includes('membership=true'));
  });

  it('merge requests: open / get / list / comment', async () => {
    const { forge, calls } = setup((m, path) => {
      if (path === '/projects/99') return { path_with_namespace: 'fork/p' };
      if (path.includes('merge_requests?')) return [fx('mr'), fx('mr_merged'), fx('mr_fork')];
      if (path.endsWith('/notes')) return { id: 1, body: 'c', author: { username: 'bot' }, created_at: '2026-10-30T09:00:00.000Z' };
      if (path.endsWith('/197')) return fx('mr_fork');
      return fx('mr');
    });
    const pr = await forge.openPullRequest('g/p', { title: 'feat: x', body: 'Refs #7', head: 'bauherr/7-1', base: 'main' });
    assert.deepEqual(calls[0]!.body, { title: 'feat: x', description: 'Refs #7', source_branch: 'bauherr/7-1', target_branch: 'main' });
    assert.deepEqual(pr, {
      number: 196, url: 'https://gitlab.test/g/p/-/merge_requests/196', title: 'feat: x', body: 'Refs #7', state: 'open', head: 'bauherr/7-1', base: 'main',
      headSha: 'abc123', headRepo: 'g/p', baseRepo: 'g/p', draft: true,
    });
    const fork = await forge.getPullRequest('g/p', 197);
    assert.deepEqual([fork.state, fork.headRepo, fork.baseRepo], ['closed', 'fork/p', 'g/p']);
    const all = await forge.listPullRequests('g/p', 'all');
    assert.deepEqual(all.map((p) => [p.number, p.state, p.mergeSha]), [[196, 'open', undefined], [196, 'merged', 'def456'], [197, 'closed', undefined]]);
    assert.deepEqual((await forge.listPullRequests('g/p', 'closed')).map((p) => p.state), ['merged', 'closed']);
    assert.equal(calls.filter((c) => c.path === '/projects/99').length, 1, 'fork path cached');
    assert.equal((await forge.commentOnPullRequest('g/p', 196, 'c')).author, 'bot');
    assert.equal(calls.at(-1)!.path, `${P}/merge_requests/196/notes`);
  });

  it('listPullRequestComments lists MR notes without system notes', async () => {
    const { forge, calls } = setup(() => fx('notes'));
    assert.deepEqual((await (forge as unknown as { listPullRequestComments(r: string, n: number): Promise<{ id: string; author: string }[]> }).listPullRequestComments('g/p', 196)).map((c) => [c.id, c.author]), [['12', 'bauherr-bot'], ['13', 'sebastian']]);
    assert.equal(calls[0]!.path, `${P}/merge_requests/196/notes?sort=asc&order_by=created_at&per_page=100`);
  });

  it('listPullRequestFiles counts diff lines and maps status', async () => {
    const { forge } = setup(() => fx('diffs'));
    assert.deepEqual(await forge.listPullRequestFiles('g/p', 196), [
      { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1 },
      { filename: 'b.ts', status: 'added', additions: 1, deletions: 0 },
      { filename: 'd.ts', status: 'renamed', additions: 0, deletions: 0 },
    ]);
  });

  it('listChecks maps the latest pipeline jobs; no pipeline gives []', async () => {
    const { forge, calls } = setup((_m, path) => (path.includes('/jobs') ? fx('jobs') : path.includes('/bridges') ? [] : fx('pipelines')));
    const checks = await forge.listChecks('g/p', 'abc123');
    assert.deepEqual(checks.map((c) => [c.name, c.status, c.conclusion]), [
      ['test', 'completed', 'success'], ['lint', 'completed', 'failure'], ['optional', 'completed', 'neutral'], ['deploy', 'completed', 'skipped'],
      ['e2e', 'in_progress', null], ['old', 'completed', 'cancelled'], ['skipme', 'completed', 'skipped'],
    ]);
    assert.equal(calls[0]!.path, `${P}/pipelines?sha=abc123&per_page=1`);
    assert.equal(calls[1]!.path, `${P}/pipelines/2994845015/jobs?per_page=100`);
    assert.equal(calls[2]!.path, `${P}/pipelines/2994845015/bridges?per_page=100`);
    assert.deepEqual(await setup(() => []).forge.listChecks('g/p', 'none'), []);
  });

  it('getCommitDate', async () => {
    const { forge, calls } = setup(() => ({ committed_date: '2026-10-30T09:00:00.000+00:00' }));
    assert.equal(await forge.getCommitDate('g/p', 'abc'), '2026-10-30T09:00:00.000+00:00');
    assert.equal(calls[0]!.path, `${P}/repository/commits/abc`);
  });

  it('mergePullRequest squashes pinned to expectSha, returns the squash sha and deletes the branch', async () => {
    let merged = false;
    const { forge, calls } = setup((m, path) => {
      if (m === 'PUT') merged = true;
      if (path === P) return { squash_option: 'default_on' };
      return m === 'DELETE' ? new Response(null, { status: 204 }) : merged ? fx('mr_merged') : fx('mr');
    });
    const r = await forge.mergePullRequest('g/p', 196, { method: 'squash', deleteBranch: true, expectSha: 'abc123' });
    assert.deepEqual(r, { mergeSha: 'def456' });
    assert.deepEqual(calls.map((c) => [c.method, c.path]), [
      ['GET', `${P}/merge_requests/196`], ['GET', P], ['PUT', `${P}/merge_requests/196/merge`], ['GET', `${P}/merge_requests/196`],
      ['DELETE', `${P}/repository/branches/bauherr%2F7-1`],
    ]);
    assert.deepEqual(calls[2]!.body, { squash: true, sha: 'abc123' });
  });

  it('merge: a moved head (409) and a not-mergeable MR (405) surface as GitlabError; delete failure is reported', async () => {
    for (const status of [409, 405]) {
      const { forge } = setup((m, path) => (m === 'PUT' ? new Response('nope', { status }) : path === P ? {} : fx('mr')));
      await assert.rejects(forge.mergePullRequest('g/p', 196, { method: 'squash', expectSha: 'old' }), (e) => e instanceof GitlabError && e.status === status);
    }
    let merged = false;
    const { forge } = setup((m, path) => {
      if (m === 'PUT') merged = true;
      if (path === P) return {};
      return m === 'DELETE' ? new Response('boom', { status: 403 }) : merged ? fx('mr_merged') : fx('mr');
    });
    const r = await forge.mergePullRequest('g/p', 196, { method: 'squash', deleteBranch: true });
    assert.equal(r.mergeSha, 'def456');
    assert.match(r.branchDeleteError ?? '', /403/);
  });

  it('merge: polls until an asynchronous merge completes', async () => {
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

  it('merge: a fast-forward merge without merge/squash sha falls back to the MR head sha', async () => {
    const ff = { ...fx('mr_merged'), squash_commit_sha: null, merge_commit_sha: null };
    const { forge } = setup(() => ff);
    assert.equal((await forge.mergePullRequest('g/p', 196, { method: 'squash' })).mergeSha, 'abc123');
  });

  it('merge: a merge that never completes is a MergePendingError; an already merged MR is not re-PUT', async () => {
    const { forge, calls } = setup((_m, path) => (path === P ? {} : fx('mr')));
    await assert.rejects(forge.mergePullRequest('g/p', 196, { method: 'squash' }), MergePendingError);
    const merged = setup(() => fx('mr_merged'));
    assert.equal((await merged.forge.mergePullRequest('g/p', 196, { method: 'squash' })).mergeSha, 'def456');
    assert.ok(!merged.calls.some((c) => c.method === 'PUT'));
    assert.ok(calls.some((c) => c.method === 'PUT'));
  });

  it('merge: squash follows the project squash_option never', async () => {
    let merged = false;
    const { forge, calls } = setup((m, path) => {
      if (m === 'PUT') merged = true;
      return path === P ? { squash_option: 'never' } : merged ? fx('mr_merged') : fx('mr');
    });
    await forge.mergePullRequest('g/p', 196, { method: 'squash' });
    assert.deepEqual(calls.find((c) => c.method === 'PUT')!.body, { squash: false });
  });

  it('listChecks: failed pipeline without jobs is red, failed bridge is red, running pipeline without jobs is pending', async () => {
    const run = (status: string, bridges: unknown[] = []) => setup((_m, path) => (path.includes('/jobs') ? [] : path.includes('/bridges') ? bridges : [{ id: 5, status }])).forge.listChecks('g/p', 's');
    assert.deepEqual((await run('failed')).map((c) => [c.name, c.status, c.conclusion]), [['pipeline', 'completed', 'failure']]);
    assert.deepEqual((await run('canceled')).map((c) => [c.status, c.conclusion]), [['completed', 'cancelled']]);
    assert.deepEqual((await run('running')).map((c) => [c.status, c.conclusion]), [['in_progress', null]]);
    assert.deepEqual(await run('success'), []);
    assert.deepEqual((await run('failed', [{ id: 9, name: 'child', status: 'failed' }])).map((c) => [c.name, c.conclusion]), [['child', 'failure']]);
  });

  it('pagination refuses a Link to another origin and sends no token there', async () => {
    const { ts, calls } = setup(() => json([], { headers: { link: '<https://evil.test/x?page=2>; rel="next"' } }));
    await assert.rejects(ts.list(), /another origin/);
    assert.equal(calls.length, 1);
  });

  it('a null source_project_id (deleted fork) is an unknown head repo, not an error', async () => {
    const { forge } = setup(() => [{ ...fx('mr_fork'), source_project_id: null }]);
    const [pr] = await forge.listPullRequests('g/p', 'all');
    assert.equal(pr!.headRepo, '');
  });
});
