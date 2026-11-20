import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeBackend, GithubBackend, GitlabBackend, closingIssues, gitlabPat, patAuth } from '../src/index.js';

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

void describe('closingIssues', () => {
  void it('reads every closing keyword, case-insensitive', () => {
    const words = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
    words.push('CLOSES', 'Fixes');
    for (const word of words) {
      assert.deepEqual(closingIssues(`${word} #12`), [12], word);
    }
  });
  void it('accepts a colon, several issues, duplicates and prose around them', () => {
    assert.deepEqual(closingIssues('Fixes: #3\nand closes #1, resolves #3.'), [1, 3]);
    assert.deepEqual(closingIssues('(fixes #9)'), [9]);
  });
  void it('ignores other repositories, plain references and glued words', () => {
    assert.deepEqual(closingIssues('closes other/repo#4'), []);
    assert.deepEqual(closingIssues('closes https://github.com/o/r/issues/5'), []);
    assert.deepEqual(closingIssues('see #6, refs #7, prefixes #8, unfixed #9'), []);
    assert.deepEqual(closingIssues('closes #12abc'), []);
    assert.deepEqual(closingIssues(''), []);
  });
});

void describe('github mirror fields', () => {
  const issue = (association: string, type = 'User') => ({
    number: 1,
    html_url: 'u',
    title: 't',
    state: 'closed',
    labels: [],
    assignee: null,
    assignees: [{ login: 'a' }],
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    closed_at: '2026-10-02T09:00:00Z',
    user: { login: 'jo', type },
    author_association: association,
  });
  const backend = (body: unknown) => new GithubBackend({ auth: patAuth('t'), fetch: async () => json(body) });

  void it('maps author, trust, bot, dates and assignees of an issue', async () => {
    const { changes } = await backend([issue('MEMBER')])
      .tickets('o/r')
      .poll(null);
    assert.deepEqual(changes[0], {
      id: '1',
      number: 1,
      url: 'u',
      title: 't',
      state: 'closed',
      labels: [],
      assignee: null,
      assignees: ['a'],
      updatedAt: '2026-10-02T10:00:00Z',
      createdAt: '2026-10-01T10:00:00Z',
      closedAt: '2026-10-02T09:00:00Z',
      author: 'jo',
      authorTrusted: true,
      authorIsBot: false,
    });
  });
  void it('trusts OWNER, MEMBER and COLLABORATOR only', async () => {
    const cases = [
      ['OWNER', true],
      ['COLLABORATOR', true],
      ['CONTRIBUTOR', false],
      ['NONE', false],
    ] as const;
    for (const [association, trusted] of cases) {
      const { changes } = await backend([issue(association)])
        .tickets('o/r')
        .poll(null);
      assert.equal(changes[0]!.authorTrusted, trusted, association);
    }
  });
  void it('flags a bot author', async () => {
    const { changes } = await backend([issue('NONE', 'Bot')])
      .tickets('o/r')
      .poll(null);
    assert.equal(changes[0]!.authorIsBot, true);
  });
  void it('maps a pull request with its closing issues and pages the open list', async () => {
    const urls: string[] = [];
    const pull = {
      number: 5,
      html_url: 'u',
      title: 'p',
      body: 'Fixes #2 and closes o/x#9',
      state: 'open',
      draft: false,
      head: { ref: 'h', sha: 's', repo: { full_name: 'o/r' } },
      base: { ref: 'main', repo: { full_name: 'o/r' } },
      user: { login: 'jo', type: 'User' },
      author_association: 'OWNER',
      labels: [{ name: 'x' }],
      assignees: [{ login: 'a' }],
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
      closed_at: null,
    };
    const b = new GithubBackend({ auth: patAuth('t'), fetch: async (u) => (urls.push(urlOf(u)), json([pull])) });
    const [p] = await b.forge.listOpenPullRequests('o/r', 2, 30);
    assert.deepEqual(
      [p!.author, p!.authorTrusted, p!.authorIsBot, p!.createdAt, p!.updatedAt, p!.closedAt],
      ['jo', true, false, '2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z', undefined],
    );
    assert.deepEqual([p!.labels, p!.assignees, p!.closes], [['x'], ['a'], [2]]);
    const q = new URL(urls[0]!).searchParams;
    assert.deepEqual(
      [q.get('state'), q.get('sort'), q.get('direction'), q.get('per_page'), q.get('page')],
      ['open', 'updated', 'desc', '30', '2'],
    );
  });
  void it('reads the update time of a comment', async () => {
    const b = backend([
      {
        id: 1,
        user: { login: 'jo' },
        body: 'x',
        created_at: '2026-10-01T10:00:00Z',
        updated_at: '2026-10-03T10:00:00Z',
      },
    ]);
    assert.equal((await b.tickets('o/r').listComments('1'))[0]!.updatedAt, '2026-10-03T10:00:00Z');
  });
});

void describe('gitlab mirror fields', () => {
  const issue = {
    id: 1,
    iid: 1,
    title: 't',
    state: 'opened',
    labels: [],
    assignees: [{ username: 'a' }],
    web_url: 'u',
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-02T10:00:00.000Z',
    closed_at: null,
    author: { id: 7, username: 'jo' },
  };
  const setup = (levels: Record<number, number>, extra: unknown = issue) => {
    const paths: string[] = [];
    const b = new GitlabBackend({
      auth: gitlabPat('t'),
      baseUrl: 'https://gitlab.test',
      sleep: async () => {},
      fetch: async (u) => {
        const path = urlOf(u).slice('https://gitlab.test/api/v4'.length);
        paths.push(path);
        const member = /members\/all\/(\d+)/.exec(path);
        const level = member ? levels[Number(member[1])] : undefined;
        if (member) return level === undefined ? new Response('no', { status: 404 }) : json({ access_level: level });
        return json([extra]);
      },
    });
    return { b, paths };
  };

  void it('trusts an author with at least Reporter access and asks once per author', async () => {
    const { b, paths } = setup({ 7: 20 });
    const { changes } = await b.tickets('g/p').poll(null);
    assert.equal(changes[0]!.authorTrusted, true);
    await b.tickets('g/p').poll(null);
    assert.equal(paths.filter((p) => p.includes('/members/all/')).length, 1);
  });
  void it('does not trust a Guest or a non-member', async () => {
    assert.equal((await setup({ 7: 10 }).b.tickets('g/p').poll(null)).changes[0]!.authorTrusted, false);
    assert.equal((await setup({}).b.tickets('g/p').poll(null)).changes[0]!.authorTrusted, false);
  });
  void it('maps the dates, the author and project bots', async () => {
    const bot = { id: 8, username: 'project_5_bot_abc' };
    const { b } = setup({}, { ...issue, closed_at: '2026-10-03T10:00:00.000Z', author: bot });
    const [t] = (await b.tickets('g/p').poll(null)).changes;
    assert.deepEqual(
      [t!.createdAt, t!.closedAt, t!.author, t!.authorIsBot, t!.assignees],
      ['2026-10-01T10:00:00Z', '2026-10-03T10:00:00Z', 'project_5_bot_abc', true, ['a']],
    );
  });
  void it('maps a merge request and pages the open list', async () => {
    const mr = {
      id: 9,
      iid: 3,
      title: 'm',
      description: 'Closes #4',
      state: 'opened',
      draft: false,
      source_branch: 'h',
      target_branch: 'main',
      sha: 's',
      source_project_id: 1,
      target_project_id: 1,
      web_url: 'u',
      author: { id: 7, username: 'jo' },
      labels: ['x'],
      assignees: [{ username: 'a' }],
      created_at: '2026-10-01T10:00:00.000Z',
      updated_at: '2026-10-02T10:00:00.000Z',
    };
    const { b, paths } = setup({ 7: 30 }, mr);
    const [p] = await b.forge.listOpenPullRequests('g/p', 3, 20);
    assert.deepEqual(
      [p!.author, p!.authorTrusted, p!.updatedAt, p!.labels, p!.assignees, p!.closes],
      ['jo', true, '2026-10-02T10:00:00Z', ['x'], ['a'], [4]],
    );
    const q = new URL(`https://x${paths[0]}`).searchParams;
    assert.deepEqual(
      [q.get('state'), q.get('order_by'), q.get('sort'), q.get('per_page'), q.get('page')],
      ['opened', 'updated_at', 'desc', '20', '3'],
    );
  });
});

void describe('fake mirror fields', () => {
  void it('takes trust and bots from its fixture and trusts everyone by default', async () => {
    const open = new FakeBackend({ native: true });
    const ts = open.tickets('o/r');
    assert.equal((await ts.get((await ts.create({ title: 'a', author: 'x' })).id)).authorTrusted, true);
    const strict = new FakeBackend({ native: true, trusted: ['owner'], bots: ['robot'] });
    const st = strict.tickets('o/r');
    const made = [];
    for (const author of ['owner', 'stranger', 'robot']) made.push(await st.create({ title: author, author }));
    assert.deepEqual(
      made.map((t) => [t.authorTrusted, t.authorIsBot]),
      [
        [true, false],
        [false, false],
        [false, true],
      ],
    );
  });
  void it('stamps creation, closing and the comment edit time', async () => {
    const f = new FakeBackend({ native: true });
    const ts = f.tickets('o/r');
    const t = await ts.create({ title: 'a' });
    assert.equal(t.createdAt, t.updatedAt);
    assert.equal(t.closedAt, undefined);
    const comment = await ts.comment(t.id, 'one');
    const edited = await ts.updateComment(t.id, comment.id, 'two');
    assert.ok(edited.updatedAt > edited.createdAt);
    assert.deepEqual(
      (await ts.listComments(t.id, edited.updatedAt)).map((c) => c.body),
      ['two'],
    );
    assert.deepEqual(await ts.listComments(t.id, `${edited.updatedAt}x`), []);
    await ts.close(t.id, 'completed');
    assert.ok((await ts.get(t.id)).closedAt);
    await ts.reopen(t.id);
    assert.equal((await ts.get(t.id)).closedAt, undefined);
  });
  void it('pages the open pull requests, newest update first, with closing issues', async () => {
    const f = new FakeBackend({ native: true });
    for (const n of [1, 2, 3]) {
      await f.forge.createBranch('o/r', `b${n}`);
      await f.forge.openPullRequest('o/r', { title: `p${n}`, body: `Closes #${n}`, head: `b${n}`, base: 'main' });
    }
    f.close('o/r', 3);
    f.setPullRequest('o/r', 1, { title: 'touched' });
    assert.deepEqual(
      (await f.forge.listOpenPullRequests('o/r', 1, 1)).map((p) => p.number),
      [1],
    );
    assert.deepEqual(
      (await f.forge.listOpenPullRequests('o/r', 2, 1)).map((p) => [p.number, p.closes]),
      [[2, [2]]],
    );
    assert.deepEqual(await f.forge.listOpenPullRequests('o/r', 3, 1), []);
  });
  void it('numbers issues and pull requests from one sequence per repository', async () => {
    const f = new FakeBackend({ native: true });
    const issue = await f.tickets('o/r').create({ title: 'a' });
    await f.forge.createBranch('o/r', 'b');
    const pull = await f.forge.openPullRequest('o/r', { title: 'p', head: 'b', base: 'main' });
    assert.deepEqual([issue.number, pull.number], [1, 2]);
    assert.equal((await f.tickets('o/other').create({ title: 'x' })).number, 1);
  });
  void it('hides a ticket from lists and polls until it is shown again', async () => {
    const f = new FakeBackend({ native: true });
    const ts = f.tickets('o/r');
    const t = await ts.create({ title: 'a' });
    f.hideTicket('o/r', t.number);
    assert.deepEqual([(await ts.list()).length, (await ts.poll(null)).changes.length], [0, 0]);
    await assert.rejects(ts.get(t.id));
    f.hideTicket('o/r', t.number, false);
    assert.equal((await ts.list()).length, 1);
  });
});
