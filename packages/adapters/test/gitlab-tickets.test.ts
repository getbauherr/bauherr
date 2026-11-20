import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GitlabError } from '../src/index.js';
import { text } from '../src/wire.js';
import { fx, setup, API, P } from './gitlab-setup.js';
import { json } from './helpers.js';

void describe('gitlab tickets', () => {
  void it('capabilities, get maps issue, relations and close reason', async () => {
    const { b, ts, calls } = setup(() => fx('issue'));
    assert.deepEqual(b.capabilities, {
      attachments: false,
      nativeSubTickets: false,
      nativeBlocking: false,
      webhooks: false,
    });
    const t = await ts.get('7');
    assert.deepEqual(
      calls.map((c) => [c.method, c.path, c.token]),
      [['GET', `${P}/issues/7`, 'tok']],
    );
    assert.deepEqual(t, {
      id: '7',
      number: 7,
      url: 'https://gitlab.test/g/p/-/issues/7',
      title: 'Dark theme',
      state: 'closed',
      labels: ['bauherr:stage:build', 'bauherr:close-reason:not_planned'],
      assignee: 'bauherr-bot',
      assignees: ['bauherr-bot', 'sebastian'],
      updatedAt: '2026-10-30T10:00:00Z',
      body: 'Body text',
      parent: '1',
      blockedBy: ['3'],
      links: ['https://gitlab.test/g/p/-/merge_requests/2'],
      closeReason: 'not_planned',
      author: 'carol',
      createdAt: '2026-10-30T08:00:00Z',
      authorTrusted: false,
      authorIsBot: false,
    });
  });

  void it('list sends state and labels, follows Link pagination', async () => {
    const { ts, calls } = setup((_m, path) =>
      path.includes('page=2')
        ? fx('issues_page2')
        : json(fx('issues_page1'), { headers: { link: `<${API}${P}/issues?page=2>; rel="next"` } }),
    );
    const l = await ts.list({ state: 'open', labels: ['a', 'b'] });
    assert.deepEqual(
      l.map((x) => [x.id, x.state]),
      [
        ['1', 'open'],
        ['2', 'closed'],
        ['3', 'open'],
      ],
    );
    const q = new URL(API + calls[0]!.path).searchParams;
    assert.deepEqual([q.get('state'), q.get('labels'), q.get('per_page')], ['opened', 'a,b', '100']);
  });

  void it('poll: updated_after only with a cursor, cursor = last updatedAt', async () => {
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

  void it('create posts title/description/labels then reads the issue back', async () => {
    const { ts, calls } = setup((m) => (m === 'POST' ? { iid: 7 } : fx('issue')));
    await ts.create({ title: 'T', body: 'B', labels: ['a', 'b'] });
    assert.deepEqual(
      calls.map((c) => [c.method, c.path]),
      [
        ['POST', `${P}/issues`],
        ['GET', `${P}/issues/7`],
      ],
    );
    assert.deepEqual(calls[0]!.body, { title: 'T', description: 'B', labels: 'a,b' });
  });

  void it('comments: system notes dropped, since filters on updated_at, create/update shape', async () => {
    const { ts, calls } = setup((m) =>
      m === 'GET'
        ? fx('notes')
        : { id: 12, body: 'x', author: { username: 'bauherr-bot' }, created_at: '2026-10-30T09:10:00.000Z' },
    );
    assert.deepEqual(
      (await ts.listComments('7')).map((c) => [c.id, c.author, c.createdAt]),
      [
        ['12', 'bauherr-bot', '2026-10-30T09:10:00Z'],
        ['13', 'sebastian', '2026-10-30T09:20:00Z'],
      ],
    );
    assert.deepEqual(
      (await ts.listComments('7', '2026-10-30T09:40:00Z')).map((c) => c.id),
      ['13'],
    );
    await ts.comment('7', 'hi');
    await ts.updateComment('7', '12', 'edit');
    assert.deepEqual(
      calls.slice(2).map((c) => [c.method, c.path, c.body]),
      [
        ['POST', `${P}/issues/7/notes`, { body: 'hi' }],
        ['PUT', `${P}/issues/7/notes/12`, { body: 'edit' }],
      ],
    );
  });

  void it('labels: add_labels / remove_labels (unknown labels are no error)', async () => {
    const { ts, calls } = setup(() => fx('issue'));
    await ts.addLabels('7', ['a', 'b']);
    await ts.removeLabels('7', ['gone', 'c']);
    assert.deepEqual(
      calls.map((c) => [c.method, c.path, c.body]),
      [
        ['PUT', `${P}/issues/7`, { add_labels: 'a,b' }],
        ['PUT', `${P}/issues/7`, { remove_labels: 'gone,c' }],
      ],
    );
  });

  void it('claim resolves the user id, keeps other assignees and verifies it stuck', async () => {
    const { ts, calls } = setup((m, path) =>
      path.startsWith('/users')
        ? fx('users')
        : m === 'GET'
          ? { assignees: [{ id: 6, username: 'sebastian' }] }
          : {
              assignees: [
                { id: 6, username: 'sebastian' },
                { id: 5, username: 'Bauherr-Bot' },
              ],
            },
    );
    await ts.claim('7', 'bauherr-bot');
    assert.deepEqual(
      calls.map((c) => [c.method, c.path, c.body]),
      [
        ['GET', '/users?username=bauherr-bot', undefined],
        ['GET', `${P}/issues/7`, undefined],
        ['PUT', `${P}/issues/7`, { assignee_ids: [6, 5] }],
      ],
    );
  });

  void it('claim throws when the user is unknown or the assignee did not stick', async () => {
    await assert.rejects(setup((_m, path) => (path.startsWith('/users') ? [] : {})).ts.claim('7', 'nobody'), {
      status: 422,
    });
    const notApplied = setup((_m, path) => (path.startsWith('/users') ? fx('users') : { assignees: [] }));
    await assert.rejects(notApplied.ts.claim('7', 'bauherr-bot'), { status: 422 });
  });

  void it('latestRelease skips pre-releases', async () => {
    const { forge } = setup(() => [
      { tag_name: 'v1.1.0-rc.2', _links: { self: 'u2' } },
      { tag_name: 'v1.0.0', _links: { self: 'u1' } },
    ]);
    assert.equal((await forge.latestRelease('g/p'))?.tag, 'v1.0.0');
  });

  void it(
    'marks an X.Y.Z-rc.N release as pre-release (GitLab has no flag); tagSha ' +
      'reads the tag commit, null when the tag is gone',
    async () => {
      const { forge, calls } = setup((_m, path) => {
        if (path.endsWith('/tags/v1.1.0-rc.1')) return { name: 'v1.1.0-rc.1', commit: { id: 'c9' } };
        if (path.includes('/tags/')) return new Response('{}', { status: 404 });
        return [
          { tag_name: 'v1.1.0-rc.1', _links: { self: 'u2' }, commit: { id: 'c9' } },
          { tag_name: 'v1.0.0', _links: { self: 'u1' }, commit: { id: 'c1' } },
        ];
      });
      assert.deepEqual(
        (await forge.listReleases('g/p')).map((r) => [r.tag, r.prerelease]),
        [
          ['v1.1.0-rc.1', true],
          ['v1.0.0', false],
        ],
      );
      assert.equal(await forge.tagSha('g/p', 'v1.1.0-rc.1'), 'c9');
      assert.equal(await forge.tagSha('g/p', 'v9.9.9'), null);
      assert.equal(calls.at(-2)!.path, `${P}/repository/tags/v1.1.0-rc.1`);
    },
  );

  void it('listReleases maps every release; isAncestor holds when the merge base is the base commit', async () => {
    const { forge, calls } = setup((_m, path) => {
      if (path.includes('/releases')) return [{ tag_name: 'v1.0.0', _links: { self: 'u1' }, commit: { id: 'c1' } }];
      if (path.includes('/repository/commits/')) return { id: 'aaa' };
      return { id: path.endsWith('&refs[]=bbb') ? 'zzz' : 'aaa' };
    });
    assert.deepEqual(
      (await forge.listReleases('g/p')).map((r) => [r.tag, r.sha]),
      [['v1.0.0', 'c1']],
    );
    assert.equal(await forge.isAncestor('g/p', 'aaa', 'hhh'), true);
    assert.equal(await forge.isAncestor('g/p', 'aaa', 'bbb'), false);
    assert.ok(calls.some((c) => c.path.startsWith(`${P}/repository/merge_base?`)));
  });

  void it('release, unassign, userExists', async () => {
    const { ts, calls } = setup((_m, path) =>
      path.startsWith('/users') ? (path.endsWith('ghost') ? [] : fx('users')) : fx('issue'),
    );
    await ts.release('7');
    await ts.unassign('7', ['Sebastian']);
    await ts.unassign('7', []);
    assert.equal(await ts.userExists('bauherr-bot'), true);
    assert.equal(await ts.userExists('ghost'), false);
    assert.deepEqual(
      calls.filter((c) => c.method === 'PUT').map((c) => c.body),
      [{ assignee_ids: [] }, { assignee_ids: [5] }],
    );
    assert.equal(calls.length, 5);
  });

  void it('close adds the reason label; reopen drops it and only reopens a closed issue', async () => {
    const { ts, calls } = setup((m) => (m === 'GET' ? fx('issue') : {}));
    await ts.close('7', 'duplicate');
    await ts.reopen('7');
    const opened = setup((m) => (m === 'GET' ? { state: 'opened' } : {}));
    await opened.ts.reopen('7');
    assert.deepEqual(calls[0]!.body, { state_event: 'close', add_labels: 'bauherr:close-reason:duplicate' });
    assert.deepEqual(calls[2]!.body, {
      state_event: 'reopen',
      remove_labels: 'bauherr:close-reason:completed,bauherr:close-reason:not_planned,bauherr:close-reason:duplicate',
    });
    assert.equal('state_event' in (opened.calls[1]!.body ?? {}), false);
  });

  void it('relations live in the description: addSubTicket, addBlockedBy, addLink', async () => {
    const issues: Record<string, string> = { 1: 'parent', 2: 'child', 3: 'blocker' };
    const { ts, calls } = setup((m, path, body) => {
      const id = /issues\/(\d)/.exec(path)![1]!;
      if (m === 'PUT') issues[id] = text(body?.description);
      return { iid: Number(id), state: 'opened', description: issues[id] };
    });
    await ts.addSubTicket('1', '2');
    await ts.addBlockedBy('2', '3');
    await ts.addLink('2', 'https://x/y');
    assert.equal(
      issues[2],
      'child\n\n<!-- bauherr:relations -->\nParent: #1\nBlocked by: #3\nLink: https://x/y\n<!-- /bauherr:relations -->',
    );
    await assert.rejects(ts.addSubTicket('1', '2'), /one parent/);
    await assert.rejects(ts.addBlockedBy('2', '3'), /already blocked/);
    assert.ok(calls.every((c) => c.path.startsWith(`${P}/issues/`)));
  });

  void it('listSubTickets searches the description then filters exactly; frontier drops blocked ones', async () => {
    const rel = (parent: string, blocked: string[] = []) => {
      const blockedBy = blocked.map((b) => `Blocked by: #${b}`).join('\n');
      return `x\n\n<!-- bauherr:relations -->\nParent: #${parent}\n${blockedBy}\n<!-- /bauherr:relations -->`;
    };
    const issue = (iid: number, state: string, description: string) => ({
      iid,
      state,
      description,
      labels: [],
      assignees: [],
      web_url: '',
      title: '',
      created_at: '2026-10-30T08:00:00Z',
      updated_at: '2026-10-30T09:00:00Z',
    });
    const all: Record<string, unknown> = {
      2: issue(2, 'opened', rel('1')),
      3: issue(3, 'opened', rel('1', ['4'])),
      4: issue(4, 'opened', ''),
      5: issue(5, 'closed', rel('1')),
      6: issue(6, 'opened', rel('1', ['5'])),
      10: issue(10, 'opened', rel('10')),
      11: issue(11, 'opened', rel('11')),
    };
    const { ts, calls } = setup((_m, path) => {
      if (path.includes('/issues?')) return [all[2], all[3], all[5], all[6], issue(11, 'opened', rel('11'))];
      return all[/issues\/(\d+)/.exec(path)![1]!];
    });
    assert.deepEqual(
      (await ts.listSubTickets('1')).map((s) => s.id),
      ['2', '3', '5', '6'],
    );
    const q = new URL(API + calls[0]!.path).searchParams;
    assert.deepEqual([q.get('search'), q.get('in'), q.get('state')], ['Parent: #1', 'description', 'all']);
    assert.deepEqual(
      (await ts.frontier('1')).map((s) => s.id),
      ['2', '6'],
    );
  });

  void it('429 is retried after Retry-After, then succeeds; exhausted retries throw GitlabError', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const { ts } = setup(
      () => (n++ < 2 ? new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }) : fx('issue')),
      sleeps,
    );
    assert.equal((await ts.get('7')).id, '7');
    assert.deepEqual(sleeps, [7000, 7000]);
    const dead = setup(() => new Response('no', { status: 429, headers: { 'retry-after': '1' } }), []);
    await assert.rejects(dead.ts.get('7'), (e) => e instanceof GitlabError && e.status === 429);
    const huge = setup(() => new Response('no', { status: 429, headers: { 'retry-after': '99999' } }));
    await assert.rejects(huge.ts.get('7'), /rate limited for 99999000 ms/);
  });
});
