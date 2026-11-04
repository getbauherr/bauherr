import assert from 'node:assert/strict';
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  appAuth, closeReasonLabel, Conflict, FakeBackend, GithubBackend, githubWebhooks, setStage, Http, parseRelations, patAuth, renderRelations, stageLabel, stageOf,
} from '../src/index.js';

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe('body convention', () => {
  it('renders, parses and strips', () => {
    const stored = renderRelations('text', { parent: '1', blockedBy: ['2', '3'], links: ['https://x/y'] });
    assert.match(stored, /<!-- bauherr:relations -->\nParent: #1\nBlocked by: #2\nBlocked by: #3\nLink: https:\/\/x\/y\n<!-- \/bauherr:relations -->$/);
    assert.deepEqual(parseRelations(stored), { body: 'text', relations: { parent: '1', blockedBy: ['2', '3'], links: ['https://x/y'] } });
  });
  it('replaces rather than duplicates; empty relations remove the block', () => {
    const once = renderRelations('t', { parent: '1', blockedBy: [], links: [] });
    assert.equal(renderRelations(once, { parent: '2', blockedBy: [], links: [] }).match(/<!-- bauherr:relations -->/g)?.length, 1);
    assert.equal(renderRelations(once, { parent: null, blockedBy: [], links: [] }), 't');
    assert.deepEqual(parseRelations('plain'), { body: 'plain', relations: { parent: null, blockedBy: [], links: [] } });
  });
});

describe('stage helpers', () => {
  it('labels', () => {
    assert.equal(stageLabel('plan'), 'bauherr:stage:plan');
    assert.equal(closeReasonLabel('duplicate'), 'bauherr:close-reason:duplicate');
    assert.equal(stageOf(['x', 'bauherr:stage:build']), 'build');
    assert.equal(stageOf(['x']), null);
  });
  it('the later stage wins when a Ticket carries two stage labels', () => {
    assert.equal(stageOf(['bauherr:stage:release', 'bauherr:stage:review']), 'release');
    assert.equal(stageOf(['bauherr:stage:review', 'bauherr:stage:release']), 'release');
  });
  it('setStage adds before it removes: a failed add keeps the old label', async () => {
    const b = new FakeBackend();
    const ts = b.tickets('a/b');
    const { number } = await ts.create({ title: 't', labels: ['bauherr:stage:review'] });
    b.failNext('addLabels');
    await assert.rejects(setStage(ts, String(number), 'release'));
    assert.deepEqual((await ts.get(String(number))).labels, ['bauherr:stage:review']);
    await setStage(ts, String(number), 'release');
    assert.deepEqual((await ts.get(String(number))).labels, ['bauherr:stage:release']);
  });
});

describe('http', () => {
  it('backs off on 429 / 403 with Retry-After, then succeeds', async () => {
    const sleeps: number[] = [];
    const responses = [
      new Response('slow', { status: 429, headers: { 'retry-after': '2' } }),
      new Response('abuse', { status: 403, headers: { 'retry-after': '5' } }),
      json({ ok: true }),
    ];
    const h = new Http({ auth: patAuth('t'), fetch: async () => responses.shift()!, sleep: async (ms) => void sleeps.push(ms) });
    assert.deepEqual(await h.json('GET', '/x'), { ok: true });
    assert.deepEqual(sleeps, [2000, 5000]);
  });
  it('plain 403 (no rate limit) throws immediately; retries are bounded', async () => {
    let calls = 0;
    const h = new Http({ auth: patAuth('t'), fetch: async () => (calls++, new Response('no', { status: 403 })), sleep: async () => {} });
    await assert.rejects(h.json('GET', '/x'), /403/);
    assert.equal(calls, 1);
    calls = 0;
    const h2 = new Http({ auth: patAuth('t'), fetch: async () => (calls++, new Response('', { status: 429, headers: { 'retry-after': '1' } })), sleep: async () => {}, maxRetries: 2 });
    await assert.rejects(h2.json('GET', '/x'), /429/);
    assert.equal(calls, 3);
  });
  it('follows Link rel=next', async () => {
    const urls: string[] = [];
    const h = new Http({
      auth: patAuth('t'), baseUrl: 'https://api.test',
      fetch: async (u) => {
        urls.push(String(u));
        return String(u).endsWith('/p1')
          ? json([1], { headers: { link: '<https://api.test/p2?after=abc>; rel="next", <https://api.test/p9>; rel="last"' } })
          : json([2]);
      },
    });
    assert.deepEqual(await h.paginate('/p1'), [1, 2]);
    assert.deepEqual(urls, ['https://api.test/p1', 'https://api.test/p2?after=abc']);
  });
});

describe('github poll request shape', () => {
  const run = async (cursor: string | null) => {
    const urls: string[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u) => {
        urls.push(String(u));
        return json([
          { number: 1, html_url: 'u', title: 't', state: 'open', labels: [], assignee: null, updated_at: '2026-10-29T10:00:00Z' },
          { number: 2, html_url: 'u', title: 'pr', state: 'open', labels: [], assignee: null, updated_at: '2026-10-29T11:00:00Z', pull_request: {} },
        ]);
      },
    });
    const r = await b.tickets('o/r').poll(cursor);
    return { url: new URL(urls[0]!), r };
  };
  it('omits since for null cursor, filters PRs', async () => {
    const { url, r } = await run(null);
    assert.equal(url.searchParams.has('since'), false);
    assert.deepEqual(['all', 'updated', 'asc'], [url.searchParams.get('state'), url.searchParams.get('sort'), url.searchParams.get('direction')]);
    assert.deepEqual(r.changes.map((c) => c.id), ['1']);
    assert.equal(r.next, '2026-10-29T10:00:00Z');
  });
  it('sends since in UTC with trailing Z', async () => {
    assert.equal((await run('2026-10-29T12:58:00.000+00:00')).url.searchParams.get('since'), '2026-10-29T12:58:00Z');
    assert.equal((await run('2026-10-29T12:58:00')).url.searchParams.get('since')?.endsWith('Z'), true);
  });
});

describe('webhooks.verify', () => {
  const { verify } = githubWebhooks(new Http({ auth: patAuth('t') }));
  const sig = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  it('accepts valid, rejects tampered / missing', () => {
    assert.equal(verify('{"a":1}', sig('{"a":1}', 's'), 's'), true);
    assert.equal(verify('{"a":2}', sig('{"a":1}', 's'), 's'), false);
    assert.equal(verify('{"a":1}', sig('{"a":1}', 'x'), 's'), false);
    assert.equal(verify('{"a":1}', undefined, 's'), false);
    assert.equal(verify('{"a":1}', 'sha256=short', 's'), false);
  });
});

describe('appAuth (fake key, fake GitHub)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  it('signs an RS256 JWT, mints an installation token and caches it until near expiry', async () => {
    let clock = Date.parse('2026-10-29T12:00:00Z');
    const calls: { url: string; auth: string }[] = [];
    const auth = appAuth({
      appId: 42, installationId: 7, privateKeyPem: pem, now: () => clock,
      fetch: async (u, init) => {
        calls.push({ url: String(u), auth: String((init?.headers as Record<string, string>).authorization) });
        return json({ token: `ghs_${calls.length}`, expires_at: new Date(clock + 3600_000).toISOString() }, { status: 201 });
      },
    });
    assert.equal(auth.kind, 'app');
    assert.equal(await auth.token(), 'ghs_1');
    clock += 30 * 60_000;
    assert.equal(await auth.token(), 'ghs_1');
    clock += 26 * 60_000; // inside the 5 min refresh window
    assert.equal(await auth.token(), 'ghs_2');
    assert.equal(calls[0]!.url, 'https://api.github.com/app/installations/7/access_tokens');
    const [h, p, s] = calls[0]!.auth.replace('Bearer ', '').split('.') as [string, string, string];
    assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(claims.iss, '42');
    assert.ok(claims.exp - claims.iat <= 600);
    assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')));
  });
});

describe('github mergePullRequest', () => {
  const run = async (headRepo: string, del: Response = new Response(null, { status: 204 })) => {
    const calls: { method: string; url: string; body: any }[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        const method = String(init?.method);
        calls.push({ method, url: new URL(String(u)).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === 'PUT') return json({ sha: 'm1', merged: true });
        if (method === 'DELETE') return del;
        return json({ number: 7, html_url: 'u', title: 't', body: '', state: 'open', head: { ref: 'bauherr/7', sha: 'h', repo: { full_name: headRepo } }, base: { ref: 'main', repo: { full_name: 'o/r' } } });
      },
    });
    const res = await b.forge.mergePullRequest('o/r', 7, { method: 'squash', deleteBranch: true, expectSha: 'h' });
    return { calls, res };
  };
  it('PUTs a squash merge pinned to the head sha, then deletes a same-repo branch', async () => {
    const { calls, res } = await run('o/r');
    assert.deepEqual(res, { mergeSha: 'm1' });
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET /repos/o/r/pulls/7', 'PUT /repos/o/r/pulls/7/merge', 'DELETE /repos/o/r/git/refs/heads/bauherr/7']);
    assert.deepEqual(calls[1]!.body, { merge_method: 'squash', sha: 'h' });
  });
  it('never deletes a fork head branch', async () => {
    const { calls } = await run('evil/r');
    assert.ok(!calls.some((c) => c.method === 'DELETE'));
  });
  it('reports a failed delete without failing the merge, and ignores 404', async () => {
    assert.match((await run('o/r', new Response('boom', { status: 500 }))).res.branchDeleteError ?? '', /500/);
    assert.equal((await run('o/r', new Response('gone', { status: 404 }))).res.branchDeleteError, undefined);
  });
});

describe('github pull request mergeable', () => {
  const get = async (extra: object) => {
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async () => json({ number: 7, html_url: 'u', title: 't', body: '', state: 'open', head: { ref: 'f', sha: 'h', repo: { full_name: 'o/r' } }, base: { ref: 'main', repo: { full_name: 'o/r' } }, ...extra }),
    });
    return (await b.forge.getPullRequest('o/r', 7)).mergeable;
  };
  it('maps mergeable false, mergeable_state dirty, true and null', async () => {
    assert.equal(await get({ mergeable: false }), false);
    assert.equal(await get({ mergeable: null, mergeable_state: 'dirty' }), false);
    assert.equal(await get({ mergeable: true, mergeable_state: 'clean' }), true);
    assert.equal(await get({ mergeable: null }), undefined);
  });
});

describe('github reopen', () => {
  it('PATCHes the issue state to open', async () => {
    const calls: { method: string; url: string; body: any }[] = [];
    const b = new GithubBackend({ auth: patAuth('t'), fetch: async (u, init) => { calls.push({ method: String(init?.method), url: new URL(String(u)).pathname, body: JSON.parse(String(init?.body)) }); return json({}); } });
    await b.tickets('o/r').reopen('7');
    assert.deepEqual(calls, [{ method: 'PATCH', url: '/repos/o/r/issues/7', body: { state: 'open' } }]);
  });
});

describe('github listChecks', () => {
  it('maps commit statuses to checks next to the check runs', async () => {
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u) => json(String(u).includes('/status') ? { statuses: [{ context: 'ci/a', state: 'failure', created_at: 'T2' }, { context: 'ci/b', state: 'pending', created_at: 'T3' }, { context: 'ci/c', state: 'success', created_at: 'T4' }] } : { check_runs: [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', started_at: 'T1', html_url: 'https://gh/run/1' }] }),
    });
    assert.deepEqual(await b.forge.listChecks('o/r', 'h'), [
      { id: 1, name: 'build', status: 'completed', conclusion: 'success', startedAt: 'T1', url: 'https://gh/run/1' },
      { name: 'ci/a', status: 'completed', conclusion: 'failure', startedAt: 'T2' },
      { name: 'ci/b', status: 'in_progress', conclusion: null, startedAt: 'T3' },
      { name: 'ci/c', status: 'completed', conclusion: 'success', startedAt: 'T4' },
    ]);
  });
});

describe('github rerunFailed', () => {
  it('re-runs the failed jobs of each Actions run once; checks without a run id re-run nothing', async () => {
    const calls: string[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => json(init?.method === 'POST' ? (calls.push(new URL(String(u)).pathname), {}) : String(u).includes('/status') ? { statuses: [] } : { check_runs: [{ id: 1, name: 'a', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/77/job/1' }, { id: 2, name: 'b', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/77/job/2' }] }),
    });
    const checks = await b.forge.listChecks('o/r', 'h');
    assert.deepEqual(checks.map((c) => c.runId), [77, 77]);
    assert.equal(await b.forge.rerunFailed('o/r', checks), true);
    assert.deepEqual(calls, ['/repos/o/r/actions/runs/77/rerun-failed-jobs']);
    assert.equal(await b.forge.rerunFailed('o/r', [{ name: 'ci/a', status: 'completed', conclusion: 'failure' }]), false);
    assert.equal(calls.length, 1);
  });
});

describe('github file requests', () => {
  type Call = { method: string; url: string; body: any };
  const setup = (reply: (c: Call) => Response) => {
    const calls: Call[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        const url = new URL(String(u));
        const c = { method: String(init?.method), url: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined };
        calls.push(c);
        return reply(c);
      },
    });
    return { calls, f: b.forge };
  };
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  it('listFiles resolves the commit, requests the recursive tree, keeps blobs and reports truncation', async () => {
    const { calls, f } = setup((c) =>
      c.url.includes('/commits/') ? json({ sha: 'c1', commit: { tree: { sha: 't1' } } }) : json({ truncated: true, tree: [{ type: 'blob', path: 'a b/x.md' }, { type: 'tree', path: 'a b' }] }));
    assert.deepEqual(await f.listFiles('o/r', 'feat/x'), { commit: 'c1', paths: ['a b/x.md'], truncated: true });
    assert.deepEqual(calls.map((c) => c.url), ['/repos/o/r/commits/feat%2Fx', '/repos/o/r/git/trees/t1?recursive=1']);
  });

  it('getFile encodes each path segment, pins the ref and decodes base64', async () => {
    const { calls, f } = setup(() => json({ encoding: 'base64', content: b64('héllo'), sha: 's1' }));
    assert.deepEqual(await f.getFile('o/r', 'dir x/a#b.md', 'c1'), { content: 'héllo', sha: 's1' });
    assert.equal(calls[0]!.url, '/repos/o/r/contents/dir%20x/a%23b.md?ref=c1');
  });

  it('getFile falls back to the blob API for files over 1 MB', async () => {
    const { calls, f } = setup((c) => (c.url.includes('/git/blobs/') ? json({ content: b64('big') }) : json({ encoding: 'none', content: '', sha: 's2' })));
    assert.equal((await f.getFile('o/r', 'big.md')).content, 'big');
    assert.equal(calls[1]!.url, '/repos/o/r/git/blobs/s2');
  });

  it('putFile PUTs base64 content with branch and sha', async () => {
    const { calls, f } = setup(() => json({ content: { sha: 'n1' } }));
    assert.deepEqual(await f.putFile('o/r', { branch: 'b', path: 'd e/f.md', content: 'héllo', message: 'm', expectSha: 'old' }), { sha: 'n1' });
    assert.deepEqual(calls[0], { method: 'PUT', url: '/repos/o/r/contents/d%20e/f.md', body: { message: 'm', content: b64('héllo'), branch: 'b', sha: 'old' } });
  });

  it('putFile maps 409 and 422 to Conflict, other errors pass through', async () => {
    for (const status of [409, 422]) {
      await assert.rejects(setup(() => new Response('x', { status })).f.putFile('o/r', { branch: 'b', path: 'p', content: 'c', message: 'm' }), Conflict);
    }
    await assert.rejects(setup(() => new Response('x', { status: 500 })).f.putFile('o/r', { branch: 'b', path: 'p', content: 'c', message: 'm' }), /500/);
  });

  it("expectSha '' pre-checks existence: exists is a Conflict, 404 proceeds, no sha is sent", async () => {
    const exists = setup(() => json({}));
    await assert.rejects(exists.f.putFile('o/r', { branch: 'b', path: 'p', content: 'c', message: 'm', expectSha: '' }), Conflict);
    assert.deepEqual(exists.calls.map((c) => c.method), ['GET']);
    assert.equal(exists.calls[0]!.url, '/repos/o/r/contents/p?ref=b');
    const fresh = setup((c) => (c.method === 'GET' ? new Response('nf', { status: 404 }) : json({ content: { sha: 'n' } })));
    await fresh.f.putFile('o/r', { branch: 'b', path: 'p', content: 'c', message: 'm', expectSha: '' });
    assert.deepEqual(fresh.calls.map((c) => c.method), ['GET', 'PUT']);
    assert.equal('sha' in fresh.calls[1]!.body, false);
  });
});
