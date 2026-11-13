import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { FakeBackend, PlankaError, PlankaTicketSource, withTickets, type PlankaOptions } from '../src/index.js';

const board = () => JSON.parse(readFileSync(new URL('../../test/fixtures/planka/board.json', import.meta.url), 'utf8'));
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
const B = '1700000000000000001';
const L = { backlog: '1700000000000000011', planning: '1700000000000000012', building: '1700000000000000013', done: '1700000000000000014' };
const ME = '1700000000000000201';

type Call = { method: string; path: string; body: any; auth: string | null };

/** Stateful stand-in for the Planka 2.x endpoints the adapter uses; every call is recorded. */
function setup(o: Partial<PlankaOptions> = {}, hook?: (method: string, path: string) => Response | undefined) {
  const state = board();
  const inc = state.included;
  const calls: Call[] = [];
  let id = 1700000000009000000n;
  let tick = Date.parse('2026-11-01T00:00:00Z');
  const nextId = () => String(id++);
  const touch = (c: any) => (c.updatedAt = new Date((tick += 1000)).toISOString());
  const card = (cid: string) => inc.cards.find((c: any) => c.id === cid);
  const handle = (method: string, path: string, body: any): unknown => {
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === `/boards/${B}`) return state;
    if (method === 'GET' && path === '/users/me') return { item: inc.users[0] };
    if ((m = /^\/lists\/(\d+)\/cards$/.exec(path)) && method === 'POST') {
      const c = { id: nextId(), listId: m[1], creatorUserId: ME, createdAt: new Date(tick += 1000).toISOString(), updatedAt: null, name: body.name, description: body.description };
      inc.cards.push(c);
      return { item: c };
    }
    if ((m = /^\/cards\/(\d+)$/.exec(path)) && method === 'PATCH') {
      const c = card(m[1]!);
      Object.assign(c, body);
      touch(c);
      return { item: c };
    }
    if ((m = /^\/cards\/(\d+)\/comments$/.exec(path))) {
      if (method === 'POST') {
        const c = { id: nextId(), cardId: m[1], userId: ME, text: body.text, createdAt: new Date(tick += 1000).toISOString(), updatedAt: null };
        (state.comments ??= []).push(c);
        return { item: c };
      }
      return { items: (state.comments ?? []).filter((c: any) => c.cardId === m![1]), included: { users: inc.users } };
    }
    if ((m = /^\/comments\/(\d+)$/.exec(path)) && method === 'PATCH') {
      const c = state.comments.find((x: any) => x.id === m![1]);
      c.text = body.text;
      return { item: c };
    }
    if (path === `/boards/${B}/labels` && method === 'POST') {
      const l = { id: nextId(), ...body };
      inc.labels.push(l);
      return { item: l };
    }
    if ((m = /^\/cards\/(\d+)\/card-labels$/.exec(path)) && method === 'POST') {
      inc.cardLabels.push({ id: nextId(), cardId: m[1], labelId: body.labelId });
      return { item: {} };
    }
    if ((m = /^\/cards\/(\d+)\/card-labels\/labelId:(\d+)$/.exec(path)) && method === 'DELETE') {
      inc.cardLabels = inc.cardLabels.filter((x: any) => !(x.cardId === m![1] && x.labelId === m![2]));
      return { item: {} };
    }
    if ((m = /^\/cards\/(\d+)\/card-memberships$/.exec(path)) && method === 'POST') {
      inc.cardMemberships.push({ id: nextId(), cardId: m[1], userId: body.userId });
      return { item: {} };
    }
    if ((m = /^\/cards\/(\d+)\/card-memberships\/userId:(\d+)$/.exec(path)) && method === 'DELETE') {
      inc.cardMemberships = inc.cardMemberships.filter((x: any) => !(x.cardId === m![1] && x.userId === m![2]));
      return { item: {} };
    }
    return new Response('not found', { status: 404 });
  };
  const src = new PlankaTicketSource({
    baseUrl: 'https://planka.test/', token: 'tok-secret', boardId: B, sleep: async () => {},
    fetch: async (u, init) => {
      const path = String(u).slice('https://planka.test/api'.length);
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body, auth: new Headers(init?.headers).get('authorization') });
      const r = hook?.(method, path) ?? handle(method, path, body);
      return r instanceof Response ? r : json(r);
    },
    ...o,
  });
  return { src, calls, state, inc, writes: () => calls.filter((c) => c.method !== 'GET') };
}

describe('planka tickets', () => {
  it('get maps card, footer, relations, members and closed list', async () => {
    const { src, calls } = setup();
    const t = await src.get('1');
    assert.equal(calls[0]!.auth, 'Bearer tok-secret');
    assert.deepEqual(t, {
      id: '1', number: 1, url: 'https://planka.test/cards/1700000000000000101', title: 'Dark theme', state: 'open',
      labels: ['bauherr:stage:build'], assignee: 'bauherr-bot', assignees: ['bauherr-bot', 'carol'],
      updatedAt: '2026-10-30T10:00:00Z', body: 'Body text', parent: null, blockedBy: ['3'], links: ['https://example.com/a'],
      closeReason: null, author: 'bauherr-bot',
    });
    const done = setup();
    done.inc.cards[0].listId = L.done;
    done.inc.cardLabels.push({ id: '9', cardId: '1700000000000000101', labelId: '1700000000000000302' });
    const c = await done.src.get('1');
    assert.deepEqual([c.state, c.closeReason], ['closed', 'completed']);
  });

  it('numbers an unnumbered card once and keeps the user body', async () => {
    const { src, writes, inc } = setup();
    const l = await src.list({ state: 'all' });
    assert.deepEqual(l.map((t) => [t.id, t.title, t.body]), [['1', 'Dark theme', 'Body text'], ['2', 'Export to CSV', 'Written by hand in Planka']]);
    assert.match(inc.cards[1].description, /Number: 2/);
    assert.equal(writes().length, 1);
    await src.list();
    assert.equal(writes().length, 1);
  });

  it('list filters by state and labels', async () => {
    const { src } = setup();
    assert.deepEqual((await src.list({ labels: ['feature'] })).map((t) => t.id), ['2']);
    assert.deepEqual((await src.list({ state: 'closed' })).map((t) => t.id), []);
  });

  it('concurrent creates get distinct numbers', async () => {
    const { src } = setup();
    const made = await Promise.all(['a', 'b', 'c'].map((x) => src.create({ title: x, body: x })));
    assert.deepEqual(made.map((t) => t.number).sort(), [3, 4, 5]);
    assert.deepEqual(made.map((t) => t.body).sort(), ['a', 'b', 'c']);
  });

  it('create puts the card on the stage list and labels it, creating the board label once', async () => {
    const { src, writes, inc } = setup({ lists: { plan: 'Planning' } });
    const t = await src.create({ title: 'x', labels: ['bauherr:stage:plan'] });
    assert.deepEqual(t.labels, ['bauherr:stage:plan']);
    assert.equal(inc.cards.at(-1).listId, L.planning);
    await src.addLabels(t.id, ['bauherr:stage:plan']);
    assert.equal(writes().filter((w) => w.path === `/boards/${B}/labels`).length, 1);
    await src.create({ title: 'y', labels: ['bauherr:stage:plan'] });
    assert.equal(writes().filter((w) => w.path === `/boards/${B}/labels`).length, 1);
  });

  it('a stage label moves the card; other labels do not; removal does not move it back', async () => {
    const { src, inc } = setup({ lists: { plan: 'Planning', build: 'Building' } });
    await src.addLabels('2', ['feature2']);
    assert.equal(inc.cards[1].listId, L.backlog);
    await src.addLabels('2', ['bauherr:stage:plan']);
    assert.equal(inc.cards[1].listId, L.planning);
    await src.removeLabels('2', ['bauherr:stage:plan', 'bauherr:never-there']);
    assert.equal(inc.cards[1].listId, L.planning);
    assert.deepEqual((await src.get('2')).labels, ['feature', 'feature2']);
  });

  it('a mapped stage naming a missing list throws before anything is written', async () => {
    const { src, writes } = setup({ lists: { plan: 'Nope' } });
    await assert.rejects(src.addLabels('1', ['bauherr:stage:plan']), /no list "Nope"/);
    assert.deepEqual(writes().filter((w) => w.path.includes('card-labels')), []);
  });

  it('labelEvents: footer log with actor, order and the existing entry', async () => {
    const { src } = setup();
    await src.addLabels('2', ['bauherr:a']);
    await src.removeLabels('2', ['bauherr:a']);
    const e = await src.labelEvents('2');
    assert.deepEqual(e.map((x) => [x.label, x.action, x.actor]), [['bauherr:a', 'labeled', 'bauherr-bot'], ['bauherr:a', 'unlabeled', 'bauherr-bot']]);
    assert.deepEqual((await src.labelEvents('1')).map((x) => [x.label, x.actor, x.at]), [['bauherr:stage:build', 'carol', '2026-10-30T09:00:00Z']]);
  });

  it('poll: null cursor sees all, cursor sees only newer or equal, at-least-once, cursor advances', async () => {
    const { src } = setup();
    const first = await src.poll(null);
    assert.deepEqual(first.changes.map((c) => c.id), ['1', '2'].sort((a, b) => first.changes.find((c) => c.id === a)!.updatedAt.localeCompare(first.changes.find((c) => c.id === b)!.updatedAt)));
    assert.equal(first.next, first.changes.at(-1)!.updatedAt);
    const same = await src.poll(first.next);
    assert.deepEqual(same.changes.map((c) => c.updatedAt), [first.next]);
    await src.comment('1', 'a comment does not change the card');
    assert.equal((await src.poll(first.next)).changes.length, 1);
    await src.update('1', { title: 'Dark theme 2' });
    const again = await src.poll(first.next);
    assert.ok(again.changes.some((c) => c.title === 'Dark theme 2'));
    assert.ok(again.next! > first.next!);
    assert.equal((await src.poll(again.next!)).next, again.next);
  });

  it('update keeps footer and relations; replaces title and body', async () => {
    const { src } = setup();
    await src.update('1', { title: 'T', body: 'New body' });
    const t = await src.get('1');
    assert.deepEqual([t.title, t.body, t.number, t.blockedBy, t.links], ['T', 'New body', 1, ['3'], ['https://example.com/a']]);
  });

  it('comments: create, update, list with since', async () => {
    const { src } = setup();
    const c = await src.comment('1', 'first');
    assert.deepEqual([c.body, c.author], ['first', 'bauherr-bot']);
    const u = await src.updateComment('1', c.id, 'edited');
    assert.equal(u.body, 'edited');
    const l = await src.listComments('1');
    assert.deepEqual(l.map((x) => [x.body, x.author]), [['edited', 'bauherr-bot']]);
    assert.deepEqual(await src.listComments('1', '2099-01-01T00:00:00Z'), []);
  });

  it('claim, release and unassign set card members; unknown login throws', async () => {
    const { src } = setup();
    await src.release('1');
    assert.equal((await src.get('1')).assignee, null);
    await src.claim('1', 'CAROL');
    await src.claim('1', 'carol');
    assert.deepEqual((await src.get('1')).assignees, ['carol']);
    await src.claim('1', 'bauherr-bot');
    await src.unassign('1', ['carol']);
    assert.deepEqual((await src.get('1')).assignees, ['bauherr-bot']);
    await assert.rejects(src.claim('1', 'nobody'));
    assert.deepEqual([await src.userExists('Carol'), await src.userExists('nobody'), await src.whoami()], [true, false, 'bauherr-bot']);
  });

  it('close moves to the closed list with a reason label; reopen returns it to the stage list', async () => {
    const { src, inc } = setup({ lists: { build: 'Building' } });
    await src.close('1', 'not_planned');
    let t = await src.get('1');
    assert.deepEqual([t.state, t.closeReason, inc.cards[0].listId], ['closed', 'not_planned', L.done]);
    await src.close('1', 'duplicate');
    t = await src.get('1');
    assert.deepEqual(t.labels.filter((l) => l.includes('close-reason')), ['bauherr:close-reason:duplicate']);
    await src.reopen('1');
    await src.reopen('1');
    t = await src.get('1');
    assert.deepEqual([t.state, t.closeReason, inc.cards[0].listId, t.labels], ['open', null, L.building, ['bauherr:stage:build']]);
  });

  it('reopen without a stage list goes to the first open list; a missing closed list throws', async () => {
    const { src, inc } = setup();
    await src.close('2', 'completed');
    await src.reopen('2');
    assert.equal(inc.cards[1].listId, L.backlog);
    const bad = setup({ closedList: 'Shipped' });
    await assert.rejects(bad.src.close('2', 'completed'), /no list "Shipped"/);
  });

  it('relations: sub-tickets, one parent, blockers, links, frontier', async () => {
    const { src } = setup();
    const p = await src.create({ title: 'p' });
    const [a, b, c] = [await src.create({ title: 'a' }), await src.create({ title: 'b' }), await src.create({ title: 'c' })];
    for (const x of [a, b, c]) await src.addSubTicket(p.id, x.id);
    await assert.rejects(src.addSubTicket(a.id, c.id));
    assert.deepEqual((await src.listSubTickets(p.id)).map((s) => s.id), [a.id, b.id, c.id]);
    await src.addBlockedBy(b.id, a.id);
    await assert.rejects(src.addBlockedBy(b.id, a.id));
    await src.addLink(b.id, 'https://example.com/b');
    const g = await src.get(b.id);
    assert.deepEqual([g.parent, g.blockedBy, g.links, g.body], [p.id, [a.id], ['https://example.com/b'], '']);
    assert.deepEqual((await src.frontier(p.id)).map((s) => s.id), [a.id, c.id]);
    await src.close(a.id, 'completed');
    await src.close(c.id, 'not_planned');
    assert.deepEqual((await src.frontier(p.id)).map((s) => s.id), [b.id]);
  });

  it('an unknown ticket number is a 404 PlankaError that does not leak the token', async () => {
    const { src } = setup();
    const e = await src.get('99').catch((x) => x);
    assert.ok(e instanceof PlankaError && e.status === 404);
    assert.ok(!e.message.includes('tok-secret'));
    const denied = setup({}, () => new Response('nope', { status: 401 }));
    const e2 = await denied.src.get('1').catch((x) => x);
    assert.ok(e2 instanceof PlankaError && e2.status === 401 && !e2.message.includes('tok-secret'));
  });

  it('retries a 429 honouring Retry-After, gives up after maxRetries', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const ok = setup({ sleep: async (ms) => void sleeps.push(ms) }, (m, p) => (m === 'GET' && p === `/boards/${B}` && n++ < 2 ? new Response('slow', { status: 429, headers: { 'retry-after': '2' } }) : undefined));
    await ok.src.get('1');
    assert.deepEqual(sleeps, [2000, 2000]);
    const dead = setup({ maxRetries: 1 }, () => new Response('slow', { status: 429, headers: { 'retry-after': '1' } }));
    await assert.rejects(dead.src.get('1'), (e: PlankaError) => e.status === 429);
  });

  it('withTickets serves tickets from Planka and keeps the forge of the backend', async () => {
    const { src } = setup();
    const fake = new FakeBackend();
    const b = withTickets(fake, src);
    assert.equal(b.forge, fake.forge);
    assert.equal(b.tickets('any'), src);
    assert.deepEqual([b.capabilities.nativeSubTickets, b.capabilities.nativeBlocking], [false, false]);
    assert.deepEqual(src.capabilities, { attachments: false, nativeSubTickets: false, nativeBlocking: false, webhooks: false });
  });
});
